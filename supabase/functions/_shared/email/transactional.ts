/**
 * JOB-31 `transactional_email` (API_CONTRACTS §11): support replies (ADM-03), admin invites
 * (ADM-19) and security notices (ADM-00) over the email API. The payload never carries an address:
 * the recipient is resolved at send time (`support_tickets.contact_email`, the admin's
 * `admin_users.email`; other recipient types are resolved by the resolvers a caller registers).
 * Invite tokens arrive sealed (`seal.ts`). The job result holds the provider message id only.
 *
 * Failures: a missing credential or template input is final (`failed`,
 * `EXTERNAL_CREDENTIAL_REQUIRED` / `…_MISSING`); provider throttling and 5xx are retried (5
 * attempts, 60 s → 1 h), rejected recipients are final.
 */
import { z } from 'zod';
import type { TokenKeyring } from '../crypto/token-cipher.ts';
import type { DbClient } from '../db/clients.ts';
import type { RawEnv } from '../env.ts';
import { defineJob } from '../jobs/registry.ts';
import { type JobDefinition, JobError } from '../jobs/types.ts';
import { createEmailProvider, emailConfig, type EmailProvider } from './provider.ts';
import { openEmailParam } from './seal.ts';
import {
  type EmailLocale,
  type RenderedEmail,
  renderAdminInvite,
  renderSecurityRecovery,
  renderSupportReply,
} from './templates.ts';
import { EmailSendError } from './types.ts';

const Uuid = z.uuid();

export const RecipientType = z.enum(['deletion_request', 'support_ticket', 'admin_user']);
export type RecipientType = z.infer<typeof RecipientType>;

export const TransactionalEmailPayload = z.object({
  template_key: z.string().max(80),
  recipient_ref: z.object({ type: RecipientType, id: Uuid }),
  locale: z.enum(['tr', 'en']),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type TransactionalEmailPayload = z.infer<typeof TransactionalEmailPayload>;

/** Resolves the address of one recipient reference (service role); `null` when it is gone. */
export type RecipientResolver = (id: string) => Promise<string | null>;

export interface TransactionalEmailDeps {
  readonly system: DbClient;
  readonly raw: RawEnv;
  readonly keyring: () => Promise<TokenKeyring>;
  /** Overrides the provider built from the env (tests). */
  readonly provider?: EmailProvider | null;
  /** Extra resolvers (e.g. `deletion_request`, registered by the privacy flows). */
  readonly resolvers?: Partial<Record<RecipientType, RecipientResolver>>;
  readonly fetch?: typeof fetch;
}

async function single<T>(
  query: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error !== null) throw new JobError('DB_ERROR', true, null, 'recipient lookup failed');
  return (data as T | null) ?? null;
}

function builtInResolvers(system: DbClient): Partial<Record<RecipientType, RecipientResolver>> {
  return {
    async support_ticket(id) {
      const row = await single<{ contact_email: string | null }>(
        system.from('support_tickets').select('contact_email').eq('id', id).maybeSingle(),
      );
      return row?.contact_email ?? null;
    },
    async admin_user(id) {
      const row = await single<{ email: string | null }>(
        system.from('admin_users').select('email').eq('user_id', id).maybeSingle(),
      );
      return row?.email ?? null;
    },
  };
}

/** `destek@mail.x` + `DA-2026-000123` → `destek+DA-2026-000123@mail.x` (PUB-08 reply routing). */
export function plusAddress(address: string | null, tag: string): string | null {
  if (address === null) return null;
  const at = address.lastIndexOf('@');
  if (at <= 0) return address;
  return `${address.slice(0, at)}+${tag}@${address.slice(at + 1)}`;
}

function param(payload: TransactionalEmailPayload, name: string): string {
  const value = payload.params[name];
  if (value === undefined || value === '')
    throw new JobError('TEMPLATE_PARAM_MISSING', false, null, name);
  return String(value);
}

interface Prepared {
  readonly email: RenderedEmail;
  readonly replyTo: string | null;
}

async function prepare(
  deps: TransactionalEmailDeps,
  payload: TransactionalEmailPayload,
  replyTo: string | null,
  now: Date,
): Promise<Prepared> {
  const locale = payload.locale as EmailLocale;
  switch (payload.template_key) {
    case 'admin_invite': {
      const origin = deps.raw.ADMIN_ORIGIN?.trim().replace(/\/+$/, '');
      if (origin === undefined || origin === '') {
        throw new JobError('EXTERNAL_CREDENTIAL_REQUIRED', false, null, 'ADMIN_ORIGIN');
      }
      const token = await openEmailParam(
        await deps.keyring(),
        param(payload, 'invite_token_sealed'),
        `admin_invite|${payload.recipient_ref.id}`,
      ).catch(() => {
        throw new JobError('TEMPLATE_PARAM_INVALID', false, null, 'invite_token_sealed');
      });
      const admin = await single<{ display_name: string | null }>(
        deps.system
          .from('admin_users')
          .select('display_name')
          .eq('user_id', payload.recipient_ref.id)
          .maybeSingle(),
      );
      return {
        email: renderAdminInvite(locale, {
          name: admin?.display_name ?? '',
          url: `${origin}/invite?token=${encodeURIComponent(token)}`,
        }),
        replyTo,
      };
    }
    case 'support_reply': {
      const noteId = param(payload, 'note_id');
      const reference = param(payload, 'reference');
      const note = await single<{ body: string; ticket_id: string }>(
        deps.system.from('support_notes').select('body,ticket_id').eq('id', noteId).maybeSingle(),
      );
      if (note === null || note.ticket_id !== payload.recipient_ref.id) {
        throw new JobError('TEMPLATE_PARAM_INVALID', false, null, 'note_id');
      }
      return {
        email: renderSupportReply(locale, { reference, body: note.body }),
        replyTo: plusAddress(replyTo, reference),
      };
    }
    case 'admin_security_recovery_used':
      return {
        email: renderSecurityRecovery(locale, {
          time: now.toLocaleString(locale === 'en' ? 'en-US' : 'tr-TR', {
            timeZone: 'Europe/Istanbul',
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        }),
        replyTo,
      };
    default:
      throw new JobError('TEMPLATE_UNKNOWN', false, null, payload.template_key.slice(0, 80));
  }
}

export function transactionalEmailJob(
  deps: TransactionalEmailDeps,
): JobDefinition<TransactionalEmailPayload> {
  const resolvers = { ...builtInResolvers(deps.system), ...(deps.resolvers ?? {}) };
  return defineJob({
    type: 'transactional_email',
    payload: TransactionalEmailPayload,
    timeoutMs: 15_000,
    async handler(ctx) {
      const config = emailConfig(deps.raw);
      if (!config.configured) {
        throw new JobError('EXTERNAL_CREDENTIAL_REQUIRED', false, null, config.missing.join(','));
      }
      const provider =
        deps.provider ??
        createEmailProvider(config.config, deps.fetch === undefined ? {} : { fetch: deps.fetch });
      const resolver = resolvers[ctx.payload.recipient_ref.type];
      if (resolver === undefined) throw new JobError('RECIPIENT_UNSUPPORTED', false);
      const to = await resolver(ctx.payload.recipient_ref.id);
      if (to === null) throw new JobError('RECIPIENT_MISSING', false);
      const prepared = await prepare(deps, ctx.payload, config.config.replyTo, ctx.now());
      try {
        const sent = await provider.send({
          to,
          subject: prepared.email.subject,
          text: prepared.email.text,
          html: prepared.email.html,
          replyTo: prepared.replyTo,
          tag: ctx.payload.template_key,
          metadata: { job_id: ctx.job.id },
        });
        ctx.log.info('transactional_email_sent', {
          template_key: ctx.payload.template_key,
          provider: provider.id,
        });
        return {
          message_id: sent.messageId,
          template_key: ctx.payload.template_key,
          provider: provider.id,
        };
      } catch (error) {
        if (error instanceof EmailSendError) {
          throw new JobError(
            error.retryable ? 'PROVIDER_UNAVAILABLE' : 'EMAIL_REJECTED',
            error.retryable,
          );
        }
        throw error;
      }
    },
  });
}
