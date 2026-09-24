/**
 * API-DEV-04 `POST /notifications/test` (IMPLEMENTATION_PLAN T-6.07): a real push through the
 * decision engine and the renderer, to the installation that asked, so the user can check the
 * permission, the channel and the detail level (M§35).
 *
 * Refused up front with `409 STATE_CONFLICT` and `details.reason`: `no_active_device` (no active
 * token on that installation), `os_permission_denied`, `category_disabled`, `quiet_hours` (with
 * `details.quiet_end`; test pushes never bypass quiet hours, R-13). No `EXPO_ACCESS_TOKEN` →
 * `EXTERNAL_CREDENTIAL_REQUIRED`. Otherwise a `notifications` row (`decision='scheduled'`, ids only,
 * dedupe key `user_push_test:{installation_id}:{utc_minute}`) and the `notification` job are created;
 * a repeat within the same minute returns the same row and job.
 */
import { type NotificationCategory, quietWindowContaining } from '@da/domain';
import { AppError } from '../../errors.ts';
import type { EnqueueInput } from '../../jobs/types.ts';
import type { NotificationsRepo } from './model.ts';
import { deliveryOf } from './render.ts';
import { baseSpec } from './create.ts';

export interface TestPushDeps {
  readonly repo: NotificationsRepo;
  readonly installationRow: (
    userId: string,
    installationId: string,
  ) => Promise<{ id: string } | null>;
  readonly jobByKey: (key: string) => Promise<{ id: string; status: string } | null>;
  readonly enqueue: (input: EnqueueInput) => Promise<string>;
  readonly pushConfigured: boolean;
  readonly now: () => Date;
  readonly correlationId: string | null;
}

export interface TestPushResult {
  readonly notification_id: string;
  readonly job: { job_id: string; status: string; poll_after_ms: number };
  readonly deferred_until: string | null;
}

function conflict(reason: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError('STATE_CONFLICT', { details: { reason, ...extra } });
}

function utcMinute(now: Date): string {
  return now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

export async function sendUserTestPush(
  deps: TestPushDeps,
  input: { userId: string; installationId: string; category: NotificationCategory },
): Promise<TestPushResult> {
  if (!deps.pushConfigured) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'push', credential_keys: ['EXPO_ACCESS_TOKEN'] },
    });
  }
  const now = deps.now();
  const installation = await deps.installationRow(input.userId, input.installationId);
  if (installation === null) throw conflict('no_active_device');
  const targets = await deps.repo.activeTargets(input.userId, installation.id, now);
  if (targets.length === 0) throw conflict('no_active_device');
  const state = await deps.repo.userState(input.userId);
  if (state.osPermission === 'denied') throw conflict('os_permission_denied');
  if (!state.prefs[input.category]) throw conflict('category_disabled');
  const prefs = state.prefs;
  if (prefs.quiet_hours_enabled) {
    const window = quietWindowContaining(
      { start: prefs.quiet_start, end: prefs.quiet_end, days: prefs.quiet_days },
      now,
      state.timeZone,
    );
    if (window !== null) throw conflict('quiet_hours', { quiet_end: window.end.toISOString() });
  }

  const dedupeKey = `user_push_test:${input.installationId}:${utcMinute(now)}`;
  const spec = baseSpec({
    category: input.category,
    dedupeKey,
    template: 'account',
    variant: 'reauth_needed',
    urgency: 'urgent',
    isTest: true,
    userTest: true,
  });
  const delivery = deliveryOf(spec);
  let row = await deps.repo.insertNotification({
    user_id: input.userId,
    category: input.category,
    decision: 'scheduled',
    suppression_reason: null,
    dedupe_key: dedupeKey,
    priority: 90,
    detail_mode: prefs.detail_level,
    title_rendered: null,
    body_rendered: null,
    data: {
      type: input.category,
      entity_id: null,
      deeplink: 'dijitalasistan://settings/notifications',
    },
    entity_type: null,
    entity_id: null,
    interruption_level: delivery.interruption,
    android_channel: delivery.channelId,
    scheduled_for: now.toISOString(),
    sent_at: null,
    failed_at: null,
    error_code: null,
    job_id: null,
    correlation_id:
      deps.correlationId !== null && /^[0-9a-f-]{36}$/i.test(deps.correlationId)
        ? deps.correlationId
        : null,
    is_test: true,
  });
  row ??= await deps.repo.findByDedupe(input.userId, dedupeKey);
  if (row === null)
    throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'notification_ledger' } });

  const jobKey = dedupeKey;
  const jobId = await deps.enqueue({
    type: 'notification',
    idempotencyKey: jobKey,
    payload: {
      user_id: input.userId,
      notification_id: row.id,
      trigger: 'user_test',
      category: input.category,
      installation_id: installation.id,
    },
    userId: input.userId,
    priority: 5,
    maxAttempts: 3,
  });
  await deps.repo.updateNotification(row.id, { job_id: jobId });
  const job = await deps.jobByKey(jobKey);
  return {
    notification_id: row.id,
    job: { job_id: jobId, status: job?.status ?? 'queued', poll_after_ms: 1500 },
    deferred_until: null,
  };
}
