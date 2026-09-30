/**
 * `calendar_update` precondition (API-APR-01/03): one provider GET of the event for its current
 * etag / changeKey and organizer flag. When the provider cannot be reached through this function
 * (no adapter registered, credentials not configured) the last synced `calendar_events.etag` is
 * used; the write still sends `If-Match`, so a stale etag ends as `APPROVAL_STALE`, never as a
 * silent overwrite. Provider failures map to the API codes of §2.7 (e.g. 424 reauth).
 */
import { isProviderError } from '@da/domain';
import { isAppError } from '../../errors.ts';
import type { Logger } from '../../logging/logger.ts';
import { providerErrorToAppError } from '../../providers/errors.ts';
import type { EventPreconditionReader } from './context.ts';
import type { ExecuteRepo, ProviderSessions } from './execute/model.ts';

const FALLBACK_CODES = new Set(['FEATURE_DISABLED', 'EXTERNAL_CREDENTIAL_REQUIRED']);

export function providerEventPrecondition(input: {
  readonly sessions: ProviderSessions;
  readonly accounts: Pick<ExecuteRepo, 'accountRef'>;
  readonly log: Logger;
}): EventPreconditionReader {
  return async ({ userId, account, calendar, event }) => {
    const stored = { etag: event.etag, isOrganizer: event.organizer_self };
    const ref = await input.accounts.accountRef(userId, account.id);
    if (ref === null) return null;
    try {
      const session = await input.sessions.open(ref, {
        signal: AbortSignal.timeout(10_000),
        log: input.log,
        correlationId: crypto.randomUUID(),
      });
      const api = session.adapters.calendar;
      if (api === undefined) return stored;
      const current = await api.getEvent(
        session.ctx,
        calendar.provider_calendar_id,
        event.provider_event_id,
      );
      if (current === null || current.deleted || current.status === 'cancelled') return null;
      return { etag: current.etag, isOrganizer: current.userIsOrganizer };
    } catch (error) {
      if (isAppError(error) && FALLBACK_CODES.has(error.code)) return stored;
      if (isProviderError(error)) {
        if (error.code === 'not_found') return null;
        throw providerErrorToAppError(
          error,
          account.provider === 'microsoft' ? 'microsoft' : 'google',
          account.id,
        );
      }
      throw error;
    }
  };
}
