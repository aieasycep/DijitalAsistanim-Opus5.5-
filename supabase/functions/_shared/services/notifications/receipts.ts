/**
 * JOB-19 `push_receipts` (INTEGRATION_PLAN §9.6): polls Expo receipts for tickets older than 15 min
 * (≤ 1,000 ids per call; Expo keeps receipts for 24 h). Enqueued every 5 min by `da_push_receipts`
 * (payload `{}`) and 15 min after each send with the same bucket key.
 *
 * | Receipt error | Action |
 * |---|---|
 * | `DeviceNotRegistered` | token disabled (`device_not_registered`) |
 * | `MessageTooBig` | error log (renderer bug) |
 * | `MessageRateExceeded` | token backed off for 1 h |
 * | `InvalidCredentials` / `MismatchSenderId` | System Health `push` degraded |
 * Tickets older than 24 h without a receipt are closed as `receipt_error` / `Unknown`.
 */
import { z } from 'zod';
import { JobError, type JobContext, type JobResult } from '../../jobs/types.ts';
import type { ExpoPushClient } from './expo-push.ts';
import type { NotificationsRepo } from './model.ts';

export const PushReceiptsPayload = z.object({
  ticket_ids: z.array(z.string().min(1).max(100)).max(1000).optional(),
});
export type PushReceiptsPayload = z.infer<typeof PushReceiptsPayload>;

export const RECEIPT_MIN_AGE_MS = 15 * 60_000;
export const RECEIPT_MAX_AGE_MS = 24 * 3_600_000;
export const RATE_BACKOFF_MS = 3_600_000;

export async function processPushReceipts(
  deps: { readonly repo: NotificationsRepo; readonly expo: ExpoPushClient | null },
  ctx: JobContext<PushReceiptsPayload>,
): Promise<JobResult> {
  if (deps.expo === null)
    throw new JobError('EXTERNAL_CREDENTIAL_REQUIRED', false, null, 'EXPO_ACCESS_TOKEN');
  const now = ctx.now();
  const pending = await deps.repo.pendingTickets(
    new Date(now.getTime() - RECEIPT_MIN_AGE_MS),
    1000,
    ctx.payload.ticket_ids,
  );
  const stale = pending.filter((t) => now.getTime() - Date.parse(t.sent_at) > RECEIPT_MAX_AGE_MS);
  const fresh = pending.filter((t) => now.getTime() - Date.parse(t.sent_at) <= RECEIPT_MAX_AGE_MS);
  for (const t of stale) await deps.repo.resolveTicket(t.id, 'receipt_error', 'Unknown', now);

  const receipts =
    fresh.length === 0 ? {} : await deps.expo.receipts(fresh.map((t) => t.expo_ticket_id));
  let ok = 0;
  let errors = 0;
  let disabled = 0;
  const credentialProblems = new Set<string>();
  for (const ticket of fresh) {
    const receipt = receipts[ticket.expo_ticket_id];
    if (receipt === undefined) continue;
    if (receipt.status === 'ok') {
      await deps.repo.resolveTicket(ticket.id, 'receipt_ok', null, now);
      ok++;
      continue;
    }
    errors++;
    await deps.repo.resolveTicket(ticket.id, 'receipt_error', receipt.error, now);
    switch (receipt.error) {
      case 'DeviceNotRegistered':
        if (ticket.push_token_id !== null) {
          await deps.repo.disableToken(ticket.push_token_id, 'device_not_registered');
          disabled++;
        }
        break;
      case 'MessageRateExceeded':
        if (ticket.push_token_id !== null) {
          await deps.repo.backoffToken(
            ticket.push_token_id,
            new Date(now.getTime() + RATE_BACKOFF_MS),
          );
        }
        break;
      case 'MessageTooBig':
        ctx.log.error('push_message_too_big', { ticket_id: ticket.id });
        break;
      case 'InvalidCredentials':
      case 'MismatchSenderId':
        credentialProblems.add(receipt.error);
        break;
      case 'Unknown':
        break;
    }
  }
  if (credentialProblems.size > 0) {
    await deps.repo.recordPushHealth('degraded', {
      receipt_errors: [...credentialProblems].sort(),
    });
    ctx.log.error('push_credentials_rejected', {
      errors: [...credentialProblems].sort().join(','),
    });
  }
  return {
    checked: fresh.length,
    ok,
    errors,
    tokens_disabled: disabled,
    unknown: stale.length,
    awaiting: fresh.length - ok - errors,
  };
}
