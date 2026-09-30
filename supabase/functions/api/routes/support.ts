/**
 * API-SUP-01 `POST /support/tickets` and API-SUP-02 `POST /feedback` (both [IK]; M§62).
 *
 * Tickets go to `support_tickets` (`origin='app'`, `status='open'`, reference = `public_ref`); the
 * contact e-mail defaults to the verified auth e-mail. Feedback goes to `user_feedback`; with
 * `include_diagnostics` only the app version and platform are stored (content-free). Both tables are
 * system tables written with the service client and the verified user id.
 */
import { FeedbackBody, routes, SupportTicketBody } from '@da/validation';
import type { FeedbackType, TicketCategory, TicketStatus } from '@da/domain';
import { currentUser } from '../../_shared/auth/user.ts';
import type { DbClient } from '../../_shared/db/clients.ts';
import { fieldError, mapDbError } from '../../_shared/errors.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import type { RouteRegistrar } from '../deps.ts';

export interface TicketInsert {
  readonly user_id: string;
  readonly category: TicketCategory;
  readonly subject: string;
  readonly message: string;
  readonly contact_email: string | null;
  readonly platform: 'ios' | 'android' | null;
  readonly app_version: string | null;
}

export interface TicketView {
  readonly id: string;
  readonly reference: string;
  readonly status: TicketStatus;
}

export interface FeedbackInsert {
  readonly user_id: string;
  readonly type: FeedbackType;
  readonly rating: number | null;
  readonly message: string;
  readonly contact_email: string | null;
  readonly diagnostics_consent: boolean;
  readonly diagnostics: Record<string, string>;
  readonly platform: 'ios' | 'android' | null;
  readonly app_version: string | null;
}

export interface SupportRepo {
  insertTicket(row: TicketInsert): Promise<TicketView>;
  getTicket(userId: string, id: string): Promise<TicketView | null>;
  insertFeedback(row: FeedbackInsert): Promise<{ id: string }>;
}

/** `user_feedback.message` is NOT NULL (1..4000, DB §4.7): a rating-only submission stores this marker. */
export const RATING_ONLY_MESSAGE = '[rating_only]';
export const FEEDBACK_MESSAGE_MAX = 4000;

export const registerSupportRoutes: RouteRegistrar = (app, kit) => {
  const tickets = routes['POST /support/tickets'];
  mountRoute(
    app,
    tickets,
    ...kit.chain({ gate: true, rateLimit: 'support_ticket' }),
    parseJsonBody(tickets),
    validateRequest(tickets),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, SupportTicketBody);
      const repos = kit.deps.repos(auth);
      const client = c.get('client');
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: tickets.status,
          async execute() {
            const data = await repos.support.insertTicket({
              user_id: auth.userId,
              category: body.category,
              subject: body.subject,
              message: body.message,
              contact_email:
                body.contact_email ??
                (typeof auth.claims.email === 'string' ? auth.claims.email : null),
              platform: client.platform,
              app_version: client.version,
            });
            return { data, ref: { type: 'support_ticket', id: data.id } };
          },
          async replay(ref) {
            const ticket =
              ref.id === undefined ? null : await repos.support.getTicket(auth.userId, ref.id);
            if (ticket === null) throw new Error('support_ticket_replay_missing');
            return ticket;
          },
        },
      );
    },
  );

  const feedback = routes['POST /feedback'];
  mountRoute(
    app,
    feedback,
    ...kit.chain({ gate: true, rateLimit: 'feedback' }),
    parseJsonBody(feedback),
    validateRequest(feedback),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, FeedbackBody);
      const repos = kit.deps.repos(auth);
      const client = c.get('client');
      const message = body.message?.trim() ?? '';
      if (message.length > FEEDBACK_MESSAGE_MAX) throw fieldError('message', 'too_big');
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: feedback.status,
          async execute() {
            const diagnostics: Record<string, string> = {};
            if (body.include_diagnostics) {
              if (client.version !== null) diagnostics.app_version = client.version;
              if (client.platform !== null) diagnostics.platform = client.platform;
              if (client.build !== null) diagnostics.build = client.build;
            }
            const data = await repos.support.insertFeedback({
              user_id: auth.userId,
              type: body.type,
              rating: body.rating ?? null,
              message: message === '' ? RATING_ONLY_MESSAGE : message,
              contact_email: null,
              diagnostics_consent: body.include_diagnostics,
              diagnostics,
              platform: client.platform,
              app_version: client.version,
            });
            return { data, ref: { type: 'user_feedback', id: data.id } };
          },
          replay: (ref) => Promise.resolve({ id: ref.id ?? '' }),
        },
      );
    },
  );
};

export function supabaseSupportRepo(system: DbClient): SupportRepo {
  return {
    async insertTicket(row) {
      const { data, error } = await system
        .from('support_tickets')
        .insert({ ...row, origin: 'app', status: 'open' })
        .select('id,public_ref,status')
        .single();
      if (error !== null) throw mapDbError(error);
      const t = data as { id: string; public_ref: string; status: TicketStatus };
      return { id: t.id, reference: t.public_ref, status: t.status };
    },
    async getTicket(userId, id) {
      const { data, error } = await system
        .from('support_tickets')
        .select('id,public_ref,status')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      if (data === null) return null;
      const t = data as { id: string; public_ref: string; status: TicketStatus };
      return { id: t.id, reference: t.public_ref, status: t.status };
    },
    async insertFeedback(row) {
      const { data, error } = await system.from('user_feedback').insert(row).select('id').single();
      if (error !== null) throw mapDbError(error);
      return { id: (data as { id: string }).id };
    },
  };
}
