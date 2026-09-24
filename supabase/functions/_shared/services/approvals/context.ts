/**
 * Shared pieces of the approval services: dependencies, ownership and destination checks, the
 * payload hash and the approval-state error (API_CONTRACTS §6, API-APR-01..05).
 */
import { type Capability, matchQuote, type Provider, routeForSource } from '@da/domain';
import type { ApprovalPayload } from '@da/validation';
import { sha256Hex } from '../../crypto/hmac.ts';
import { AppError, fieldError } from '../../errors.ts';
import { canonicalJson } from '../../idempotency.ts';
import type { EnqueueInput } from '../../jobs/types.ts';
import type { ServerLocale } from '../../i18n/catalog.ts';
import type { AuditWriter } from '../audit.ts';
import type { CardContext } from './exact-change.ts';
import type {
  AccountInfo,
  ApprovalOriginValue,
  ApprovalRow,
  ApprovalsRepo,
  ApprovalUserContext,
  CalendarEventInfo,
  CalendarInfo,
  InstallationInfo,
} from './model.ts';
import { accountUsable } from './view.ts';

/** Reads the provider's current etag / changeKey and organizer flag of an event (one GET). */
export type EventPreconditionReader = (input: {
  userId: string;
  account: AccountInfo;
  calendar: CalendarInfo;
  event: CalendarEventInfo;
}) => Promise<{ etag: string | null; isOrganizer: boolean } | null>;

export interface ApprovalServiceDeps {
  readonly repo: ApprovalsRepo;
  readonly audit: AuditWriter;
  readonly now: () => Date;
  readonly locale: ServerLocale;
  readonly correlationId: string | null;
  /** Enqueues follow-up jobs (approval-expiry push, insight refresh). */
  readonly enqueue: (input: EnqueueInput) => Promise<string>;
  /** Wakes the worker right after an approve (best effort). */
  readonly pokeWorker: (reason: string) => Promise<void>;
  readonly eventPrecondition?: EventPreconditionReader;
}

export interface ResolvedContext {
  readonly user: ApprovalUserContext;
  readonly account: AccountInfo | null;
  readonly calendar: CalendarInfo | null;
  readonly event: CalendarEventInfo | null;
  readonly installation: InstallationInfo | null;
  readonly precondition: string | null;
  readonly hasCapability: boolean | null;
}

/** sha256 of the canonical payload JSON (`approval_actions.payload_hash`). */
export function payloadHashHex(payload: ApprovalPayload): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

/** `APPROVAL_STATE_CONFLICT` with the current status, version and key (§2.6). */
export function stateConflict(row: ApprovalRow, extra: Record<string, unknown> = {}): AppError {
  return new AppError('APPROVAL_STATE_CONFLICT', {
    details: {
      status: row.status,
      payload_version: row.payload_version,
      idempotency_key: row.idempotency_key,
      ...extra,
    },
  });
}

export async function requireApproval(
  deps: ApprovalServiceDeps,
  userId: string,
  id: string,
): Promise<ApprovalRow> {
  const row = await deps.repo.get(userId, id);
  if (row === null) throw new AppError('NOT_FOUND');
  return row;
}

async function requireAccount(
  deps: ApprovalServiceDeps,
  userId: string,
  accountId: string,
): Promise<AccountInfo> {
  const account = await deps.repo.account(userId, accountId);
  if (account === null) throw new AppError('NOT_FOUND', { details: { resource: 'account' } });
  return account;
}

/** Account health for a write (API-APR-01/03): reauth and admin-consent states stop the write. */
export function assertAccountWritable(account: AccountInfo): void {
  if (account.status === 'admin_consent_required') {
    throw new AppError('PROVIDER_ADMIN_CONSENT_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  if (!accountUsable(account)) {
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
}

async function requireInstallation(
  deps: ApprovalServiceDeps,
  userId: string,
  installationId: string,
  path: string,
): Promise<InstallationInfo> {
  const installation = await deps.repo.installationByClientId(userId, installationId);
  if (installation === null) throw fieldError(path, 'unknown_installation');
  return installation;
}

async function requireOwned(
  deps: ApprovalServiceDeps,
  userId: string,
  type: Parameters<ApprovalsRepo['owns']>[1],
  id: string,
  path: string,
): Promise<void> {
  if (!(await deps.repo.owns(userId, type, id))) {
    throw new AppError('NOT_FOUND', { details: { resource: path } });
  }
}

const NON_ORGANIZER_ALLOWED = new Set(['description']);

/**
 * Resolves and checks every id a payload references (ownership, destination health, data-source
 * toggle, organizer rule, device installation) and reads the capability state.
 */
export async function resolveContext(
  deps: ApprovalServiceDeps,
  userId: string,
  payload: ApprovalPayload,
): Promise<ResolvedContext> {
  const user = await deps.repo.userContext(userId);
  let account: AccountInfo | null = null;
  let calendar: CalendarInfo | null = null;
  let event: CalendarEventInfo | null = null;
  let installation: InstallationInfo | null = null;
  let precondition: string | null = null;
  let capability: Capability | null = null;
  const now = deps.now();

  switch (payload.action_type) {
    case 'email_send': {
      account = await requireAccount(deps, userId, payload.connected_account_id);
      if (account.provider !== payload.provider && account.provider !== 'demo') {
        throw fieldError('payload.provider', 'provider_mismatch');
      }
      await requireOwned(deps, userId, 'email_thread', payload.thread.email_thread_id, 'thread');
      await requireOwned(
        deps,
        userId,
        'email_message',
        payload.thread.reply_to_message_id,
        'message',
      );
      capability = 'mail_send';
      break;
    }
    case 'calendar_create':
    case 'calendar_update': {
      if (payload.target.kind === 'provider') {
        account = await requireAccount(deps, userId, payload.target.connected_account_id);
        calendar = await deps.repo.calendar(userId, payload.target.calendar_id);
        if (calendar === null || calendar.connected_account_id !== account.id) {
          throw new AppError('NOT_FOUND', { details: { resource: 'calendar' } });
        }
        if (account.data_source_toggles.calendar_write_with_approval === false) {
          throw new AppError('DATA_SOURCE_DISABLED', {
            details: { account_id: account.id, toggle: 'calendar_write_with_approval' },
          });
        }
        if (!calendar.can_write)
          throw fieldError('payload.target.calendar_id', 'calendar_read_only');
        capability = 'calendar_write';
      } else {
        installation = await requireInstallation(
          deps,
          userId,
          payload.target.installation_id,
          'payload.target.installation_id',
        );
      }
      if (payload.action_type === 'calendar_update') {
        event = await deps.repo.calendarEvent(userId, payload.calendar_event_id);
        if (event === null)
          throw new AppError('NOT_FOUND', { details: { resource: 'calendar_event' } });
        if (event.provider_deleted_at !== null || event.status === 'cancelled') {
          throw new AppError('SOURCE_GONE', { details: { provider: event.provider } });
        }
        if (
          payload.target.kind === 'provider' &&
          (event.connected_account_id !== payload.target.connected_account_id ||
            event.calendar_id !== payload.target.calendar_id)
        ) {
          throw fieldError('payload.calendar_event_id', 'event_not_in_calendar');
        }
        let organizer = event.organizer_self;
        precondition = event.etag;
        if (account !== null && calendar !== null && deps.eventPrecondition !== undefined) {
          const fresh = await deps.eventPrecondition({ userId, account, calendar, event });
          if (fresh === null)
            throw new AppError('SOURCE_GONE', { details: { provider: event.provider } });
          precondition = fresh.etag;
          organizer = fresh.isOrganizer;
        }
        const changed = Object.entries(payload.changes)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k);
        if (!organizer && changed.some((k) => !NON_ORGANIZER_ALLOWED.has(k))) {
          throw new AppError('VALIDATION_FAILED', {
            details: { reason: 'not_organizer', alternative: 'propose_new_time_email' },
            fieldErrors: [
              {
                path: 'payload.changes',
                code: 'not_organizer',
                message_key: 'validation.not_organizer',
              },
            ],
          });
        }
      } else if (payload.time.kind === 'timed' && Date.parse(payload.time.end) <= now.getTime()) {
        throw fieldError('payload.time.end', 'in_past');
      }
      break;
    }
    case 'task_create': {
      if (payload.target.kind === 'provider') {
        account = await requireAccount(deps, userId, payload.target.connected_account_id);
        capability = 'tasks_write';
      } else if (payload.target.kind === 'device') {
        installation = await requireInstallation(
          deps,
          userId,
          payload.target.installation_id,
          'payload.target.installation_id',
        );
      }
      if (payload.related_person !== undefined) {
        await requireOwned(deps, userId, 'contact', payload.related_person.contact_id, 'contact');
      }
      break;
    }
    case 'reminder_create': {
      if (Date.parse(payload.fire_at) <= now.getTime() + 60_000) {
        throw fieldError('payload.fire_at', 'too_soon');
      }
      if (payload.destination.kind === 'device') {
        installation = await requireInstallation(
          deps,
          userId,
          payload.destination.installation_id,
          'payload.destination.installation_id',
        );
      }
      if (payload.subject !== undefined) {
        await requireOwned(deps, userId, payload.subject.type, payload.subject.id, 'subject');
      }
      break;
    }
    case 'commitment_create': {
      if (payload.counterparty.contact_id !== undefined) {
        await requireOwned(deps, userId, 'contact', payload.counterparty.contact_id, 'contact');
      }
      const source = payload.source;
      if (source.source_type !== 'user_input') {
        if (source.source_id === null) throw fieldError('payload.source.source_id', 'required');
        await requireOwned(deps, userId, source.source_type, source.source_id, 'source');
        const text = await deps.repo.sourceText(userId, source.source_type, source.source_id);
        const verified = text !== null && matchQuote('s1', payload.evidence.quote, text).ok;
        if (!verified) {
          throw new AppError('VALIDATION_FAILED', {
            details: { reason: 'evidence_not_found' },
            fieldErrors: [
              {
                path: 'payload.evidence.quote',
                code: 'evidence_not_found',
                message_key: 'validation.evidence_not_found',
              },
            ],
          });
        }
      }
      break;
    }
  }

  let hasCapability: boolean | null = null;
  if (account !== null && capability !== null) {
    assertAccountWritable(account);
    hasCapability = await deps.repo.accountCan(account.id, capability);
  }
  return { user, account, calendar, event, installation, precondition, hasCapability };
}

export function cardContext(
  deps: ApprovalServiceDeps,
  resolved: ResolvedContext,
  origin: ApprovalOriginValue,
  source: CardContext['source'],
): CardContext {
  return {
    now: deps.now(),
    user: resolved.user,
    origin,
    account: resolved.account,
    calendar: resolved.calendar,
    event: resolved.event,
    installation: resolved.installation,
    precondition: resolved.precondition,
    source,
  };
}

/** In-app route of a source row ("Orijinalini aç"), when it has one. */
export function sourceRoute(type: CardContext['source'], id: string | null): string | null {
  if (type === null || id === null) return null;
  return routeForSource(type.type, id);
}

export function providerOrNull(value: string | null | undefined): Provider | null {
  if (value === null || value === undefined || value === 'in_app') return null;
  return value as Provider;
}
