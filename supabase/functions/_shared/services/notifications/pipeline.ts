/**
 * JOB-18 `notification` (M§35, M§86, M§96, M§132; ADR-10; IMPLEMENTATION_PLAN T-6.07/T-6.08).
 *
 * 1. Resolve the spec: a documented `build`, a trigger (fresh data; skipped when the item is gone)
 *    or the admin test push.
 * 2. `decide()` (domain decision engine): relevance → urgency → category → quiet hours (R-13) →
 *    dedupe → rolling caps (R-14) → detail mode / device.
 * 3. Persist the `notifications` ledger row with its decision and reason. A deferral (quiet hours,
 *    snooze, not yet due) keeps the row `scheduled` and re-enqueues the same payload at the new time.
 * 4. Send through Expo in batches of ≤ 100 with the title and body rendered per platform detail mode
 *    (iOS capped at `title_only` while `lock_screen_private`), payload exactly `{type, entity_id,
 *    deeplink}`, Android channel (R-12) and iOS interruption level.
 * 5. Store `push_tickets`; `DeviceNotRegistered` disables the token at once; receipts are polled
 *    15 minutes later (JOB-19).
 * Retries never send twice: a row that already has tickets is completed without a new send.
 */
import {
  type CandidateKind,
  decide,
  isWithinQuietHours,
  type NotificationCandidate,
  type NotificationDetail,
  type SentRecord,
} from '@da/domain';
import { toHex } from '../../crypto/encoding.ts';
import { JobError, type JobContext, type JobResult, type Json } from '../../jobs/types.ts';
import { type NotificationJobPayload, specFromBuild } from './create.ts';
import type { ExpoMessage, ExpoPushClient, ExpoTicket } from './expo-push.ts';
import type {
  NotificationInsert,
  NotificationRow,
  NotificationsRepo,
  NotificationSpec,
  PushTarget,
  UserNotificationState,
} from './model.ts';
import { deliveryOf, renderNotification } from './render.ts';
import { adminTestSpec } from './triggers/test-push.ts';
import { runTrigger, type TriggerRepo } from './triggers/index.ts';
import type { TriggerContext, TriggerOutcome } from './triggers/types.ts';

export interface NotificationPipelineDeps {
  readonly repo: NotificationsRepo;
  readonly triggers: TriggerRepo;
  /** `null` when `EXPO_ACCESS_TOKEN` is not configured (EXTERNAL_CREDENTIAL_REQUIRED). */
  readonly expo: ExpoPushClient | null;
}

const DAY_MS = 86_400_000;
export const RECEIPT_DELAY_MS = 15 * 60_000;

/** `push_receipts:{5-min UTC bucket}` — the same key the `da_push_receipts` cron job uses. */
export function receiptsJobKey(at: Date): string {
  const d = new Date(Math.floor(at.getTime() / 300_000) * 300_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `push_receipts:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

async function sha1Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))));
}

function recordsFrom(
  rows: Awaited<ReturnType<NotificationsRepo['recentSent']>>,
  state: UserNotificationState,
): SentRecord[] {
  const p = state.prefs;
  return rows
    .filter((r) => !r.is_test)
    .map((r) => {
      const kind: CandidateKind = r.dedupe_key.startsWith('reminder:')
        ? 'user_reminder'
        : 'standard';
      return {
        category: r.category,
        kind,
        sentAt: r.sent_at,
        bypassedQuietHours:
          r.category === 'critical_email' &&
          p.quiet_hours_enabled &&
          isWithinQuietHours(p.quiet_start, p.quiet_end, r.sent_at, state.timeZone, p.quiet_days),
      };
    });
}

function candidateOf(spec: NotificationSpec): NotificationCandidate {
  return {
    category: spec.category,
    kind: spec.kind,
    dedupeKey: spec.dedupeKey,
    urgency: spec.urgency,
    relevant: spec.relevant,
    entitled: spec.entitled,
    scheduledFor: spec.scheduledFor,
    validUntil: spec.validUntil,
    vip: spec.vip,
  };
}

function ledger(
  spec: NotificationSpec,
  userId: string,
  mode: NotificationDetail,
  jobId: string,
  correlationId: string,
): Omit<NotificationInsert, 'decision' | 'suppression_reason' | 'scheduled_for'> {
  const delivery = deliveryOf(spec);
  const data = renderNotification(spec, 'generic', 'tr').data;
  return {
    user_id: userId,
    category: spec.category,
    dedupe_key: spec.dedupeKey,
    priority: spec.priority,
    detail_mode: mode,
    title_rendered: null,
    body_rendered: null,
    data,
    entity_type: spec.entityType,
    entity_id: spec.entityId,
    interruption_level: delivery.interruption,
    android_channel: delivery.channelId,
    sent_at: null,
    failed_at: null,
    error_code: null,
    job_id: jobId,
    correlation_id: correlationId,
    is_test: spec.isTest,
  };
}

async function resolve(
  ctx: JobContext<NotificationJobPayload>,
  tctx: TriggerContext,
): Promise<TriggerOutcome> {
  const payload = ctx.payload;
  if (payload.build !== undefined) return { kind: 'spec', spec: specFromBuild(payload.build) };
  if (payload.kind === 'test') return { kind: 'spec', spec: adminTestSpec(tctx, ctx.job.id) };
  if (payload.trigger !== undefined) return await runTrigger(payload.trigger, tctx);
  return { kind: 'skip', reason: 'no_payload_form' };
}

function interruption(level: string): ExpoMessage['interruptionLevel'] {
  return level === 'time_sensitive' ? 'time-sensitive' : level === 'passive' ? 'passive' : 'active';
}

async function messagesFor(
  spec: NotificationSpec,
  targets: readonly PushTarget[],
  detail: Readonly<Record<'ios' | 'android', NotificationDetail>>,
  locale: 'tr' | 'en',
): Promise<ExpoMessage[]> {
  const delivery = deliveryOf(spec);
  const collapseId = await sha1Hex(spec.dedupeKey);
  return targets.map((target) => {
    const rendered = renderNotification(spec, detail[target.platform], locale);
    return {
      to: target.token,
      title: rendered.title,
      body: rendered.body,
      data: rendered.data,
      sound: spec.sound ? 'default' : null,
      channelId: delivery.channelId,
      categoryId: spec.kind === 'user_reminder' ? 'da_reminder' : spec.category,
      priority: delivery.priority,
      interruptionLevel: interruption(delivery.interruption),
      relevanceScore: delivery.relevanceScore,
      threadId: spec.category,
      collapseId,
      ttl: delivery.ttl,
    };
  });
}

export async function processNotification(
  deps: NotificationPipelineDeps,
  ctx: JobContext<NotificationJobPayload>,
): Promise<JobResult> {
  const payload = ctx.payload;
  const now = ctx.now();
  const userId = payload.user_id ?? ctx.job.user_id;
  if (userId === undefined || userId === null) {
    throw new JobError('POISON_PAYLOAD', false, null, 'missing_user');
  }
  const repo = deps.repo;

  let row: NotificationRow | null = null;
  if (payload.notification_id !== undefined) {
    row = await repo.getNotification(userId, payload.notification_id);
    if (row === null) return { skipped: 'notification_missing' };
    if (row.decision !== 'scheduled') return { skipped: 'already_decided', decision: row.decision };
  }

  const state = await repo.userState(userId);
  const tctx: TriggerContext = {
    repo: deps.triggers,
    userId,
    payload,
    now,
    timeZone: state.timeZone,
    locale: state.locale,
    isPro: state.isPro,
    jobKey: ctx.job.idempotency_key,
  };
  const outcome = await resolve(ctx, tctx);
  if (outcome.kind === 'skip') {
    if (row !== null) {
      await repo.updateNotification(row.id, {
        decision: 'suppressed',
        suppression_reason: 'low_relevance',
      });
    }
    if (outcome.after !== undefined) await outcome.after(now);
    return { skipped: outcome.reason };
  }
  const spec = outcome.spec;

  let dedupeKeyExists = false;
  if (row === null) {
    const found = await repo.findByDedupe(userId, spec.dedupeKey);
    if (found !== null) {
      if (found.job_id === ctx.job.id && found.decision === 'scheduled') row = found;
      else dedupeKeyExists = true;
    }
  }

  const targets = await repo.activeTargets(userId, spec.installationRowId, now);
  const exemptFromCaps = spec.userTest || spec.kind === 'admin_test';
  const recent = exemptFromCaps
    ? []
    : recordsFrom(await repo.recentSent(userId, new Date(now.getTime() - DAY_MS)), state);
  const decision = decide(
    candidateOf(spec),
    {
      dedupeKeyExists,
      recent,
      hasActiveDevice: targets.length > 0,
      osPermission: state.osPermission,
    },
    {
      prefs: state.prefs,
      timeZone: state.timeZone,
      now,
      isPro: state.isPro,
      categoryCaps: await repo.categoryCaps(),
    },
  );
  const base = ledger(spec, userId, decision.detailMode, ctx.job.id, ctx.correlationId);
  const drop = async (reason: string) => {
    if (outcome.onDropped !== undefined) await outcome.onDropped(reason, now);
  };

  if (decision.outcome === 'suppress') {
    const reason = decision.reason ?? 'low_relevance';
    if (reason === 'deduplicated') {
      await repo.insertNotification({
        ...base,
        dedupe_key: `${spec.dedupeKey}#dup:${ctx.job.id}`,
        decision: 'deduplicated',
        suppression_reason: 'deduplicated',
        scheduled_for: now.toISOString(),
      });
    } else if (row !== null) {
      await repo.updateNotification(row.id, {
        decision: 'suppressed',
        suppression_reason: reason,
        detail_mode: decision.detailMode,
      });
    } else {
      const inserted = await repo.insertNotification({
        ...base,
        decision: 'suppressed',
        suppression_reason: reason,
        scheduled_for: now.toISOString(),
      });
      if (inserted === null) return { decision: 'deduplicated', reason: 'deduplicated' };
    }
    await drop(reason);
    return { decision: decision.ledgerDecision, reason };
  }

  if (decision.outcome === 'schedule') {
    const at = decision.scheduleAt ?? now;
    if (row === null) {
      row = await repo.insertNotification({
        ...base,
        decision: 'scheduled',
        suppression_reason: null,
        scheduled_for: at.toISOString(),
      });
      if (row === null) return { decision: 'deduplicated', reason: 'deduplicated' };
    }
    const next: Record<string, Json> = {
      ...(payload as unknown as Record<string, Json>),
      user_id: userId,
      notification_id: row.id,
    };
    const jobId = await ctx.enqueue({
      type: 'notification',
      idempotencyKey: `notif:${row.id}:${Math.floor(at.getTime() / 1000)}`,
      payload: next,
      userId,
      runAfter: at,
      priority: 50,
      maxAttempts: 5,
    });
    await repo.updateNotification(row.id, {
      scheduled_for: at.toISOString(),
      job_id: jobId,
      detail_mode: decision.detailMode,
    });
    return {
      decision: 'scheduled',
      deferred_until: at.toISOString(),
      decided_by: decision.decidedBy,
    };
  }

  // send
  if (row === null) {
    row = await repo.insertNotification({
      ...base,
      decision: 'scheduled',
      suppression_reason: null,
      scheduled_for: now.toISOString(),
    });
    if (row === null) return { decision: 'deduplicated', reason: 'deduplicated' };
  }
  const current: NotificationRow = row;
  if (deps.expo === null) {
    await repo.updateNotification(current.id, {
      decision: 'failed',
      error_code: 'EXTERNAL_CREDENTIAL_REQUIRED',
      failed_at: now.toISOString(),
    });
    await drop('external_credential_required');
    throw new JobError('EXTERNAL_CREDENTIAL_REQUIRED', false, null, 'EXPO_ACCESS_TOKEN');
  }
  const ledgerText = renderNotification(spec, decision.detailMode, state.locale);
  if ((await repo.ticketCount(current.id)) > 0) {
    await repo.updateNotification(current.id, {
      decision: 'sent',
      sent_at: now.toISOString(),
      title_rendered: ledgerText.title,
      body_rendered: ledgerText.body,
      detail_mode: decision.detailMode,
    });
    if (outcome.onSent !== undefined) await outcome.onSent(now);
    return { decision: 'sent', resumed: true };
  }

  const messages = await messagesFor(spec, targets, decision.detail, state.locale);
  let tickets: ExpoTicket[];
  try {
    tickets = await deps.expo.send(messages);
  } catch (error) {
    const final =
      !(error instanceof JobError) || !error.retryable || ctx.job.attempts >= ctx.job.max_attempts;
    if (final) {
      await repo.updateNotification(current.id, {
        decision: 'failed',
        error_code: error instanceof JobError ? error.code.slice(0, 120) : 'PROVIDER_UNAVAILABLE',
        failed_at: now.toISOString(),
      });
      await drop('push_failed');
    }
    throw error;
  }

  const sentAt = now.toISOString();
  await repo.insertTickets(
    tickets.map((ticket, i) => ({
      user_id: userId,
      notification_id: current.id,
      push_token_id: targets[i]?.tokenId ?? '',
      expo_ticket_id: ticket.status === 'ok' ? ticket.id : null,
      status: ticket.status === 'ok' ? 'pending_receipt' : 'error',
      error_code: ticket.status === 'ok' ? null : ticket.error,
      sent_at: sentAt,
    })),
  );
  let disabled = 0;
  for (const [i, ticket] of tickets.entries()) {
    const target = targets[i];
    if (
      ticket.status === 'error' &&
      ticket.error === 'DeviceNotRegistered' &&
      target !== undefined
    ) {
      await repo.disableToken(target.tokenId, 'device_not_registered');
      disabled++;
    }
  }
  const accepted = tickets.filter((t) => t.status === 'ok').length;
  if (accepted > 0) {
    await repo.updateNotification(current.id, {
      decision: 'sent',
      sent_at: sentAt,
      title_rendered: ledgerText.title,
      body_rendered: ledgerText.body,
      detail_mode: decision.detailMode,
    });
    await ctx.enqueue({
      type: 'push_receipts',
      idempotencyKey: receiptsJobKey(new Date(now.getTime() + RECEIPT_DELAY_MS)),
      payload: {},
      runAfter: new Date(now.getTime() + RECEIPT_DELAY_MS),
      priority: 150,
      maxAttempts: 4,
    });
    if (outcome.onSent !== undefined) await outcome.onSent(now);
  } else {
    const first = tickets[0];
    await repo.updateNotification(current.id, {
      decision: 'failed',
      error_code: first !== undefined && first.status === 'error' ? first.error : 'Unknown',
      failed_at: sentAt,
    });
    await drop('push_rejected');
  }
  return {
    decision: accepted > 0 ? 'sent' : 'failed',
    notification_id: current.id,
    tickets: tickets.length,
    accepted,
    tokens_disabled: disabled,
    bypassed_quiet_hours: decision.bypassedQuietHours,
  };
}
