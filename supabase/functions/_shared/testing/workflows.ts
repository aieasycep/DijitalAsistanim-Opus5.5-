/**
 * In-memory fakes with the semantics of the SQL functions behind approvals, reminders, the
 * notification ledger and the job queue (migration 20260924002100, DATABASE_AND_RLS_PLAN §6.6):
 * `create_approval` (pending-origin uniqueness), `transition_approval` (legal edges, key binding,
 * expiry, device token hash, the `approval_execute` job), `edit_approval_payload`,
 * `start_device_execution`, `schedule_reminder` / `cancel_reminder`, and `(user_id, dedupe_key)`
 * uniqueness of `notifications`.
 */
import {
  type AccountStatus,
  type ApprovalStatus,
  type BusyInterval,
  type Capability,
  canTransition,
  type JobType,
  type NotificationCategory,
  type NotificationDetail,
  type Provider,
  type SourceType,
} from '@da/domain';
import { AppError } from '../errors.ts';
import type { EnqueueInput, JobContext, Json } from '../jobs/types.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import {
  type AccountInfo,
  type ApprovalRow,
  type ApprovalsRepo,
  type ApprovalUserContext,
  type CalendarEventInfo,
  type CalendarInfo,
  DuplicatePendingError,
  type InstallationInfo,
} from '../services/approvals/model.ts';
import type {
  NotificationInsert,
  NotificationRow,
  NotificationsRepo,
  PendingTicket,
  PushTarget,
  TicketInsert,
  UserNotificationState,
} from '../services/notifications/model.ts';
import { notificationPrefsFrom } from '../services/notifications/repo.ts';
import type { ReminderPrefs, ReminderRow, RemindersRepo } from '../services/reminders.ts';
import type {
  OverviewInsight,
  WidgetBriefingRow,
  WidgetEvent,
  WidgetSources,
} from '../services/widgets/snapshot.ts';

export interface FakeJobRow {
  id: string;
  type: string;
  key: string;
  status: string;
  payload: Json;
  userId: string | null;
  runAfter: string;
  lastErrorCode: string | null;
}

export function memoryQueue(now: () => Date) {
  const jobs = new Map<string, FakeJobRow>();
  return {
    jobs,
    enqueue(input: EnqueueInput): Promise<string> {
      const existing = jobs.get(input.idempotencyKey);
      if (existing !== undefined) return Promise.resolve(existing.id);
      const row: FakeJobRow = {
        id: crypto.randomUUID(),
        type: input.type,
        key: input.idempotencyKey,
        status: 'queued',
        payload: input.payload ?? {},
        userId: input.userId ?? null,
        runAfter: (input.runAfter ?? now()).toISOString(),
        lastErrorCode: null,
      };
      jobs.set(row.key, row);
      return Promise.resolve(row.id);
    },
    byKey(key: string): Promise<{ id: string; status: string } | null> {
      const row = jobs.get(key);
      return Promise.resolve(row === undefined ? null : { id: row.id, status: row.status });
    },
  };
}
export type MemoryQueue = ReturnType<typeof memoryQueue>;

/** A handler context for one attempt of a job; follow-up jobs land in `queue`. */
export function jobContext<P>(input: {
  readonly type: JobType;
  readonly key: string;
  readonly payload: P;
  readonly queue: MemoryQueue;
  readonly now: () => Date;
  readonly attempts?: number;
  readonly maxAttempts?: number;
  readonly userId?: string | null;
  /** Keeps the job id stable across attempts of a job that is not in `queue`. */
  readonly jobId?: string | undefined;
}): JobContext<P> {
  const correlationId = crypto.randomUUID();
  return {
    job: {
      id: input.queue.jobs.get(input.key)?.id ?? input.jobId ?? crypto.randomUUID(),
      type: input.type,
      status: 'running',
      user_id: input.userId ?? null,
      connected_account_id: null,
      payload: input.payload as Json,
      idempotency_key: input.key,
      attempts: input.attempts ?? 1,
      max_attempts: input.maxAttempts ?? 5,
      correlation_id: correlationId,
      lease_owner: 'test-worker',
      lease_expires_at: null,
      run_after: input.now().toISOString(),
    },
    payload: input.payload,
    signal: new AbortController().signal,
    log: createLogger({ fn: 'worker', sink: memorySink().sink }),
    correlationId,
    workerId: 'test-worker',
    enqueue: (job) => input.queue.enqueue(job),
    progress: () => Promise.resolve(),
    now: input.now,
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type StoredApproval = Mutable<ApprovalRow> & {
  device_token_hash: string | null;
};

export interface ApprovalEventRecord {
  readonly approval_id: string;
  readonly from: ApprovalStatus | null;
  readonly to: ApprovalStatus;
  readonly actor: string;
  readonly reason: string | null;
}

export function memoryApprovals(queue: MemoryQueue, now: () => Date) {
  const rows = new Map<string, StoredApproval>();
  const events: ApprovalEventRecord[] = [];
  const accounts = new Map<string, AccountInfo & { user_id: string; can: Capability[] }>();
  const calendars = new Map<string, CalendarInfo & { user_id: string }>();
  const calendarEvents = new Map<string, CalendarEventInfo & { user_id: string }>();
  const installations = new Map<string, InstallationInfo & { user_id: string }>();
  const owned = new Set<string>();
  const sourceTexts = new Map<string, string>();
  const planFeatures = new Set<string>();
  const replyDrafts = new Map<string, { status: string; subject?: string; body?: string }>();
  const feedback: { userId: string; approvalId: string; statement: string }[] = [];
  const context = new Map<string, ApprovalUserContext>();

  const conflict = (reason: string) =>
    new AppError('APPROVAL_STATE_CONFLICT', { details: { reason } });
  const save = (row: StoredApproval) => {
    rows.set(row.id, row);
    return { ...row };
  };
  const event = (
    row: ApprovalRow,
    from: ApprovalStatus | null,
    to: ApprovalStatus,
    actor: string,
    reason: string | null,
  ) => events.push({ approval_id: row.id, from, to, actor, reason });

  const repo: ApprovalsRepo = {
    get(userId, id) {
      const row = rows.get(id);
      return Promise.resolve(row === undefined || row.user_id !== userId ? null : { ...row });
    },
    create(userId, input, actor) {
      if (input.device_installation_id !== null) {
        const inst = [...installations.values()].find((i) => i.id === input.device_installation_id);
        if (inst?.user_id !== userId)
          throw new AppError('FORBIDDEN', { details: { reason: 'installation_mismatch' } });
      }
      if (input.origin_ref_id !== null && input.batch_id === null) {
        const dup = [...rows.values()].find(
          (r) =>
            r.user_id === userId &&
            r.status === 'pending' &&
            r.batch_id === null &&
            r.origin === input.origin &&
            r.origin_ref_id === input.origin_ref_id &&
            r.action_type === input.action_type,
        );
        if (dup !== undefined) return Promise.reject(new DuplicatePendingError(dup.id));
      }
      const row: StoredApproval = {
        id: input.id,
        user_id: userId,
        action_type: input.action_type,
        status: 'pending',
        payload: input.payload,
        payload_version: 1,
        what: input.what,
        why: input.why,
        change_summary: input.change_summary,
        side_effects: input.side_effects,
        destination_account_id: input.destination_account_id,
        destination_label: input.destination_label,
        idempotency_key: `approval:${input.id}:v1`,
        provider_idempotency_ref: null,
        origin: input.origin,
        origin_ref_id: input.origin_ref_id,
        requires_scope: input.requires_scope,
        approved_via: null,
        exact_change: input.exact_change,
        batch_id: input.batch_id,
        executor: input.executor,
        device_installation_id: input.device_installation_id,
        approval_expires_at: input.approval_expires_at,
        approved_at: null,
        rejected_at: null,
        rejection_reason: null,
        executing_at: null,
        executed_at: null,
        failed_at: null,
        attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
        result: null,
        source_type: input.source_type,
        source_id: input.source_id,
        source_provider: input.source_provider,
        source_timestamp: input.source_timestamp,
        confidence: input.confidence,
        created_at: now().toISOString(),
        device_token_hash: null,
      };
      event(row, null, 'pending', actor, 'proposed');
      return Promise.resolve(save(row));
    },
    async transition(input) {
      const row = rows.get(input.id);
      if (row === undefined) throw new AppError('NOT_FOUND');
      const from = row.status;
      if (
        from === input.to &&
        (input.idempotencyKey === null || input.idempotencyKey === row.idempotency_key)
      ) {
        return { ...row };
      }
      if (!canTransition(from, input.to)) throw conflict('illegal_transition');
      const next: StoredApproval = { ...row };
      let to = input.to;
      if (input.to === 'approved') {
        if (input.idempotencyKey !== row.idempotency_key) throw conflict('idempotency_mismatch');
        if (input.via === null || input.via === undefined) throw new AppError('VALIDATION_FAILED');
        if (Date.parse(row.approval_expires_at) <= now().getTime()) to = 'expired';
      } else if (
        input.to === 'executing' &&
        from === 'failed' &&
        input.idempotencyKey !== null &&
        input.idempotencyKey !== row.idempotency_key
      ) {
        throw conflict('idempotency_mismatch');
      } else if (
        (input.to === 'executed' || input.to === 'failed') &&
        row.executor === 'device' &&
        input.actor !== 'system' &&
        (input.deviceTokenHashHex ?? null) !== row.device_token_hash
      ) {
        throw new AppError('FORBIDDEN', { details: { reason: 'installation_mismatch' } });
      }
      const at = now().toISOString();
      next.status = to;
      if (to === 'approved') {
        next.approved_at = at;
        next.approved_via = input.via ?? null;
      }
      if (to === 'rejected') {
        next.rejected_at = at;
        next.rejection_reason = input.reason === 'user_cancel' ? 'user_cancel' : 'user_reject';
      }
      if (to === 'executing') {
        next.executing_at = at;
        next.attempt_count = row.attempt_count + 1;
      }
      if (to === 'executed') {
        next.executed_at = at;
        if (input.result) next.result = input.result;
        const ref = input.result?.provider_idempotency_ref;
        if (typeof ref === 'string') next.provider_idempotency_ref = ref;
      }
      if (to === 'failed') {
        next.failed_at = at;
        next.last_error_code = input.errorCode ?? 'UNKNOWN';
        next.last_error_message = input.errorMessage ?? null;
        if (input.result) next.result = input.result;
      }
      if (to === 'expired' && input.to === 'approved') next.last_error_code = 'APPROVAL_EXPIRED';
      event(next, from, to, to === 'expired' ? 'system' : input.actor, input.reason ?? null);
      const key = `approval_execute:${row.id}:v${row.payload_version}`;
      if (to === 'approved' && row.executor === 'server') {
        await queue.enqueue({
          type: 'approval_execute',
          idempotencyKey: key,
          payload: { approval_id: row.id },
          userId: row.user_id,
        });
      } else if (to === 'executing' && from === 'failed' && row.executor === 'server') {
        const job = queue.jobs.get(key);
        if (job !== undefined) job.status = 'queued';
      }
      return save(next);
    },
    edit(input) {
      const row = rows.get(input.id);
      if (row === undefined || row.user_id !== input.userId)
        return Promise.reject(new AppError('NOT_FOUND'));
      if (row.status !== 'pending') return Promise.reject(conflict('illegal_transition'));
      const version = row.payload_version + 1;
      const next: StoredApproval = {
        ...row,
        payload: input.payload,
        payload_version: version,
        idempotency_key: `approval:${row.id}:v${version}`,
        change_summary: input.changeSummary,
        exact_change: input.exactChange,
        what: input.what,
        side_effects: input.sideEffects,
        destination_label: input.destinationLabel,
        approval_expires_at: input.approvalExpiresAt,
        requires_scope: input.requiresScope,
      };
      event(next, 'pending', 'pending', 'user', 'edited');
      return Promise.resolve(save(next));
    },
    async startDeviceExecution(id, userId, installationRowId, tokenHashHex) {
      const row = rows.get(id);
      if (row === undefined || row.user_id !== userId) throw new AppError('NOT_FOUND');
      if (row.executor !== 'device' || row.device_installation_id !== installationRowId) {
        throw new AppError('FORBIDDEN', { details: { reason: 'installation_mismatch' } });
      }
      if (!['approved', 'failed', 'executing'].includes(row.status))
        throw conflict('illegal_transition');
      row.device_token_hash = tokenHashHex;
      if (row.status === 'executing') return { ...row };
      return await repo.transition({
        id,
        to: 'executing',
        actor: 'user',
        actorId: userId,
        idempotencyKey: row.idempotency_key,
        reason: row.status === 'failed' ? 'device_retry' : 'device_claim',
      });
    },
    setRequiresScope(userId, id, capability) {
      const row = rows.get(id);
      if (row !== undefined && row.user_id === userId)
        rows.set(id, { ...row, requires_scope: capability });
      return Promise.resolve();
    },
    deviceTokenHash(userId, id) {
      const row = rows.get(id);
      return Promise.resolve(
        row === undefined || row.user_id !== userId ? null : row.device_token_hash,
      );
    },
    async job(key) {
      return (await queue.byKey(key)) as { id: string; status: 'queued' } | null;
    },
    userContext(userId) {
      return Promise.resolve(
        context.get(userId) ?? {
          timeZone: 'Europe/Istanbul',
          locale: 'tr',
          isPro: false,
          learnFromInteractions: true,
          quietHours: { enabled: true, start: '22:30', end: '07:30', days: [1, 2, 3, 4, 5, 6, 7] },
        },
      );
    },
    planFeature(userId, key) {
      return Promise.resolve(planFeatures.has(`${userId}:${key}`));
    },
    account(userId, accountId) {
      const a = accounts.get(accountId);
      return Promise.resolve(a === undefined || a.user_id !== userId ? null : a);
    },
    accountCan(accountId, capability) {
      const a = accounts.get(accountId);
      return Promise.resolve(a !== undefined && a.can.includes(capability));
    },
    calendar(userId, calendarId) {
      const c = calendars.get(calendarId);
      return Promise.resolve(c === undefined || c.user_id !== userId ? null : c);
    },
    calendarEvent(userId, eventId) {
      const e = calendarEvents.get(eventId);
      return Promise.resolve(e === undefined || e.user_id !== userId ? null : e);
    },
    installationByClientId(userId, installationId) {
      const i = [...installations.values()].find(
        (x) => x.installation_id === installationId && x.user_id === userId,
      );
      return Promise.resolve(i ?? null);
    },
    installationById(userId, rowId) {
      const i = installations.get(rowId);
      return Promise.resolve(i === undefined || i.user_id !== userId ? null : i);
    },
    owns(userId, type, id) {
      return Promise.resolve(type === 'user_input' || owned.has(`${userId}:${type}:${id}`));
    },
    sourceText(userId, type, id) {
      return Promise.resolve(sourceTexts.get(`${userId}:${type}:${id}`) ?? null);
    },
    syncReplyDraft(_userId, draftId, draft) {
      replyDrafts.set(draftId, {
        status: replyDrafts.get(draftId)?.status ?? 'submitted',
        subject: draft.subject,
        body: draft.body,
      });
      return Promise.resolve();
    },
    replyDraftStatus(_userId, draftId, status) {
      replyDrafts.set(draftId, { ...(replyDrafts.get(draftId) ?? {}), status });
      return Promise.resolve();
    },
    recordRejectionFeedback({ userId, approval, statement }) {
      feedback.push({ userId, approvalId: approval.id, statement });
      return Promise.resolve();
    },
  };

  return {
    repo,
    rows,
    events,
    accounts,
    calendars,
    calendarEvents,
    installations,
    owned,
    sourceTexts,
    planFeatures,
    replyDrafts,
    feedback,
    context,
    addAccount(input: {
      id: string;
      userId: string;
      provider?: Provider;
      status?: AccountStatus;
      can?: Capability[];
      email?: string;
      toggles?: Record<string, boolean>;
    }) {
      accounts.set(input.id, {
        id: input.id,
        user_id: input.userId,
        provider: input.provider ?? 'google',
        account_email: input.email ?? 'yunus@example.com',
        display_label: null,
        status: input.status ?? 'healthy',
        capabilities_granted: input.can ?? ['calendar_read', 'calendar_write'],
        data_source_toggles: input.toggles ?? { calendar_write_with_approval: true },
        can: input.can ?? ['calendar_read', 'calendar_write'],
      });
    },
    own(userId: string, type: SourceType | 'contact', id: string) {
      owned.add(`${userId}:${type}:${id}`);
    },
  };
}
export type MemoryApprovals = ReturnType<typeof memoryApprovals>;

export function memoryNotifications(now: () => Date) {
  const rows = new Map<string, NotificationInsert & { id: string }>();
  const targets: (PushTarget & {
    userId: string;
    enabled: boolean;
    disabledReason: string | null;
  })[] = [];
  const tickets: (Mutable<TicketInsert> & { id: string; receipt_checked_at: string | null })[] = [];
  const backoffs = new Map<string, string>();
  const health: { status: string; detail: Record<string, Json> }[] = [];
  const states = new Map<
    string,
    Omit<Partial<UserNotificationState>, 'prefs'> & { prefs?: Record<string, unknown> }
  >();
  let caps: Partial<Record<NotificationCategory, number>> = {
    follow_up: 2,
    life_intel: 3,
    deadline: 3,
  };

  const toRow = (r: NotificationInsert & { id: string }): NotificationRow => ({
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    decision: r.decision,
    suppression_reason: r.suppression_reason,
    dedupe_key: r.dedupe_key,
    scheduled_for: r.scheduled_for,
    sent_at: r.sent_at,
    job_id: r.job_id,
    is_test: r.is_test,
  });

  const repo: NotificationsRepo = {
    getNotification(userId, id) {
      const r = rows.get(id);
      return Promise.resolve(r === undefined || r.user_id !== userId ? null : toRow(r));
    },
    findByDedupe(userId, key) {
      const r = [...rows.values()].find((x) => x.user_id === userId && x.dedupe_key === key);
      return Promise.resolve(r === undefined ? null : toRow(r));
    },
    insertNotification(row) {
      if (
        [...rows.values()].some((x) => x.user_id === row.user_id && x.dedupe_key === row.dedupe_key)
      ) {
        return Promise.resolve(null);
      }
      if (
        (row.decision === 'suppressed' || row.decision === 'deduplicated') &&
        row.suppression_reason === null
      ) {
        return Promise.reject(new AppError('VALIDATION_FAILED'));
      }
      const stored = { ...row, id: crypto.randomUUID() };
      rows.set(stored.id, stored);
      return Promise.resolve(toRow(stored));
    },
    updateNotification(id, patch) {
      const r = rows.get(id);
      if (r !== undefined) rows.set(id, { ...r, ...patch });
      return Promise.resolve();
    },
    userState(userId) {
      const s = states.get(userId) ?? {};
      return Promise.resolve({
        prefs: notificationPrefsFrom((s.prefs ?? null) as Record<string, unknown> | null),
        timeZone: s.timeZone ?? 'Europe/Istanbul',
        locale: s.locale ?? 'tr',
        isPro: s.isPro ?? false,
        osPermission: s.osPermission ?? 'granted',
      });
    },
    activeTargets(userId, installationRowId, at) {
      return Promise.resolve(
        targets
          .filter((t) => t.userId === userId && t.enabled)
          .filter((t) => installationRowId === null || t.installationRowId === installationRowId)
          .filter((t) => {
            const until = backoffs.get(t.tokenId);
            return until === undefined || Date.parse(until) <= at.getTime();
          })
          .map(({ tokenId, token, platform, installationRowId: inst }) => ({
            tokenId,
            token,
            platform,
            installationRowId: inst,
          })),
      );
    },
    recentSent(userId, since) {
      return Promise.resolve(
        [...rows.values()]
          .filter(
            (r) =>
              r.user_id === userId &&
              r.decision === 'sent' &&
              r.sent_at !== null &&
              Date.parse(r.sent_at) > since.getTime(),
          )
          .map((r) => ({
            category: r.category,
            sent_at: r.sent_at ?? '',
            dedupe_key: r.dedupe_key,
            is_test: r.is_test,
          })),
      );
    },
    categoryCaps: () => Promise.resolve(caps),
    ticketCount(notificationId) {
      return Promise.resolve(tickets.filter((t) => t.notification_id === notificationId).length);
    },
    insertTickets(list) {
      for (const t of list)
        tickets.push({ ...t, id: crypto.randomUUID(), receipt_checked_at: null });
      return Promise.resolve();
    },
    disableToken(tokenId, reason) {
      for (const t of targets) {
        if (t.tokenId === tokenId) {
          t.enabled = false;
          t.disabledReason = reason;
        }
      }
      return Promise.resolve();
    },
    backoffToken(tokenId, until) {
      backoffs.set(tokenId, until.toISOString());
      return Promise.resolve();
    },
    pendingTickets(sentBefore, limit, ids) {
      const list: PendingTicket[] = tickets
        .filter((t) => t.status === 'pending_receipt' && t.expo_ticket_id !== null)
        .filter((t) => Date.parse(t.sent_at) < sentBefore.getTime())
        .filter(
          (t) => ids === undefined || ids.length === 0 || ids.includes(t.expo_ticket_id ?? ''),
        )
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          expo_ticket_id: t.expo_ticket_id ?? '',
          push_token_id: t.push_token_id,
          sent_at: t.sent_at,
        }));
      return Promise.resolve(list);
    },
    resolveTicket(id, status, errorCode, checkedAt) {
      const t = tickets.find((x) => x.id === id);
      if (t !== undefined) {
        t.status = status;
        t.error_code = errorCode;
        t.receipt_checked_at = checkedAt.toISOString();
      }
      return Promise.resolve();
    },
    recordPushHealth(status, detail) {
      health.push({ status, detail });
      return Promise.resolve();
    },
  };

  return {
    repo,
    rows,
    targets,
    tickets,
    backoffs,
    health,
    states,
    setCaps(next: Partial<Record<NotificationCategory, number>>) {
      caps = next;
    },
    addTarget(
      userId: string,
      input: { platform?: 'ios' | 'android'; installationRowId?: string; token?: string } = {},
    ) {
      const target = {
        userId,
        tokenId: crypto.randomUUID(),
        token: input.token ?? `ExponentPushToken[${crypto.randomUUID().slice(0, 22)}]`,
        platform: input.platform ?? 'ios',
        installationRowId: input.installationRowId ?? crypto.randomUUID(),
        enabled: true,
        disabledReason: null,
      };
      targets.push(target);
      return target;
    },
    /** A `sent` ledger row in the past (caps and quiet-window tests). */
    addSent(
      userId: string,
      category: NotificationCategory,
      sentAt: Date,
      dedupeKey = crypto.randomUUID(),
    ) {
      const id = crypto.randomUUID();
      rows.set(id, {
        id,
        user_id: userId,
        category,
        decision: 'sent',
        suppression_reason: null,
        dedupe_key: dedupeKey,
        priority: 50,
        detail_mode: 'title_only',
        title_rendered: 't',
        body_rendered: 'b',
        data: { type: category, entity_id: null, deeplink: 'dijitalasistan://today' },
        entity_type: null,
        entity_id: null,
        interruption_level: 'active',
        android_channel: 'briefings',
        scheduled_for: sentAt.toISOString(),
        sent_at: sentAt.toISOString(),
        failed_at: null,
        error_code: null,
        job_id: null,
        correlation_id: null,
        is_test: false,
      });
    },
    now,
  };
}
export type MemoryNotifications = ReturnType<typeof memoryNotifications>;

export function memoryReminders(
  queue: MemoryQueue,
  notifications: MemoryNotifications,
  now: () => Date,
) {
  const rows = new Map<string, ReminderRow & { user_id: string; idempotency_key: string }>();
  const busy: BusyInterval[] = [];
  const owned = new Set<string>();
  let prefs: ReminderPrefs = {
    timeZone: 'Europe/Istanbul',
    morningTime: '08:00',
    eveningTime: '19:00',
    workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    quietHours: { enabled: true, start: '22:30', end: '07:30', days: [1, 2, 3, 4, 5, 6, 7] },
  };
  let calendar = true;
  const repo: RemindersRepo = {
    prefs: () => Promise.resolve(prefs),
    busy: () => Promise.resolve([...busy]),
    hasCalendar: () => Promise.resolve(calendar),
    owns: (userId, type, id) =>
      Promise.resolve(type === 'user_input' || owned.has(`${userId}:${type}:${id}`)),
    async schedule(userId, row) {
      const key = String(row.idempotency_key);
      const existing = [...rows.values()].find(
        (r) => r.user_id === userId && r.idempotency_key === key,
      );
      if (existing !== undefined) return { created: false, reminder: { ...existing } };
      const id = crypto.randomUUID();
      const stored = {
        id,
        user_id: userId,
        idempotency_key: key,
        title: String(row.title),
        preset: String(row.preset),
        remind_at: String(row.remind_at),
        channel: (row.channel as ReminderRow['channel']) ?? 'push',
        status: 'scheduled' as const,
        resolution_reason: (row.resolution_reason as string | null) ?? null,
        target_type: (row.target_type as string | null) ?? null,
        target_id: (row.target_id as string | null) ?? null,
        source_type: (row.source_type as SourceType | null) ?? 'user_input',
        source_id: (row.source_id as string | null) ?? userId,
        created_at: now().toISOString(),
      };
      rows.set(id, stored);
      if (stored.channel === 'push') {
        const notification = await notifications.repo.insertNotification({
          user_id: userId,
          category: (row.category as NotificationCategory) ?? 'deadline',
          decision: 'scheduled',
          suppression_reason: null,
          dedupe_key: `reminder:${id}`,
          priority: 70,
          detail_mode: 'title_only',
          title_rendered: null,
          body_rendered: null,
          data: { type: 'reminder', entity_id: id, deeplink: 'dijitalasistan://today' },
          entity_type: 'reminder',
          entity_id: id,
          interruption_level: 'time_sensitive',
          android_channel: 'reminders',
          scheduled_for: stored.remind_at,
          sent_at: null,
          failed_at: null,
          error_code: null,
          job_id: null,
          correlation_id: null,
          is_test: false,
        });
        await queue.enqueue({
          type: 'notification',
          idempotencyKey: `reminder:${id}`,
          payload: {
            user_id: userId,
            notification_id: notification?.id ?? null,
            trigger: 'reminder',
            reminder_id: id,
          },
          userId,
          runAfter: new Date(stored.remind_at),
        });
      }
      return { created: true, reminder: { ...stored } };
    },
    get(userId, id) {
      const r = rows.get(id);
      return Promise.resolve(r === undefined || r.user_id !== userId ? null : { ...r });
    },
    cancel(userId, id) {
      const r = rows.get(id);
      if (r === undefined || r.user_id !== userId) return Promise.reject(new AppError('NOT_FOUND'));
      if (r.status !== 'scheduled') return Promise.resolve({ ...r });
      const next = { ...r, status: 'cancelled' as const };
      rows.set(id, next);
      const job = queue.jobs.get(`reminder:${id}`);
      if (job !== undefined && job.status === 'queued') {
        job.status = 'failed';
        job.lastErrorCode = 'CANCELLED';
      }
      for (const n of notifications.rows.values()) {
        if (
          n.user_id === userId &&
          n.dedupe_key === `reminder:${id}` &&
          n.decision === 'scheduled'
        ) {
          notifications.rows.set(n.id, {
            ...n,
            decision: 'suppressed',
            suppression_reason: 'low_relevance',
          });
        }
      }
      return Promise.resolve(next);
    },
  };
  return {
    repo,
    rows,
    busy,
    owned,
    setPrefs(next: Partial<ReminderPrefs>) {
      prefs = { ...prefs, ...next };
    },
    setCalendar(value: boolean) {
      calendar = value;
    },
  };
}
export type MemoryReminders = ReturnType<typeof memoryReminders>;

/** Widget sources with configurable data (API-WDG-01 tests). */
export function memoryWidgets() {
  const state = {
    installations: new Set<string>(),
    prefs: {
      detail_level: 'title_only' as NotificationDetail,
      lock_screen_private: true,
      timezone: 'Europe/Istanbul',
      locale: 'tr-TR',
    },
    pro: false,
    priorities: [] as OverviewInsight[],
    followUps: [] as {
      insight_id: string;
      entity_id: string;
      title: string;
      due_at: string | null;
    }[],
    deadlines: [] as unknown[],
    events: [] as WidgetEvent[],
    preps: {} as Record<string, { ready: boolean; topics: number }>,
    briefing: null as WidgetBriefingRow | null,
    connected: 1,
    lastAnalysisAt: null as string | null,
  };
  const sources: WidgetSources = {
    installationBelongsToUser: (id) => Promise.resolve(state.installations.has(id)),
    preferences: () => Promise.resolve(state.prefs),
    isPro: () => Promise.resolve(state.pro),
    overview: () =>
      Promise.resolve({
        priorities: state.priorities,
        follow_ups: state.followUps,
        deadlines: state.deadlines,
      }),
    eventsBetween: () => Promise.resolve(state.events),
    preps: () => Promise.resolve(state.preps),
    briefing: () => Promise.resolve(state.briefing),
    sources: () =>
      Promise.resolve({ connected: state.connected, lastAnalysisAt: state.lastAnalysisAt }),
  };
  return { sources, state };
}
