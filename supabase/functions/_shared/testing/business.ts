/**
 * In-memory fakes of the business repositories with the semantics of their SQL counterparts
 * (migrations 20260924002200 / 2210 / 2220): the plan-limit gate over the seeded `plan_limits`,
 * the RevenueCat ledger and mirror, and the referral lifecycle including the capped reward.
 */
import type { RevenueCatClient, RevenueCatCustomerData } from '../services/billing/revenuecat.ts';
import type { BillingEventRecord, BillingLedger } from '../services/billing/repo.ts';
import type {
  AnalyticsRow,
  ApplyMirrorResult,
  BillingRepo,
  BillingSyncContext,
  MirrorState,
} from '../services/billing/sync.ts';
import type { EntitlementGate, GateKey, PlanLimitState } from '../services/entitlements/gate.ts';
import type {
  ApplyContextRow,
  DecideInput,
  DecideResult,
  EvaluationContextRow,
  ReferralRepo,
  ReferralStatusValue,
} from '../services/referrals/repo.ts';
import type { AuditEntry } from '../services/audit.ts';
import type { EnqueueInput, Json } from '../jobs/types.ts';
import { AppError } from '../errors.ts';

/** The migration 0009 seed (R-22); tests read limits from here, never from literals in code. */
export const SEED_PLAN_LIMITS: Readonly<Record<'free' | 'pro', Readonly<Record<string, unknown>>>> =
  {
    free: {
      max_mail_accounts: 1,
      max_calendar_accounts: 1,
      max_calendars: 1,
      vip_max: 5,
      priority_rules_max: 10,
      ai_daily_budget_units: 50,
      email_analysis_daily: 150,
      reply_drafts_daily: 5,
      assistant_messages_daily: 10,
      transcribe_seconds_daily: 60,
      captures_daily: 0,
      meeting_preps_daily: 0,
      semantic_search_daily: 0,
      meeting_prep: false,
      memory_search: false,
      voice_briefing: false,
      android_ni: false,
      midday_evening: false,
      advanced_planning: false,
      follow_up_commitments: false,
      capture: false,
      vip: false,
    },
    pro: {
      max_mail_accounts: 10,
      max_calendar_accounts: 10,
      max_calendars: 30,
      vip_max: 100,
      priority_rules_max: 200,
      ai_daily_budget_units: 600,
      email_analysis_daily: 1500,
      reply_drafts_daily: 60,
      assistant_messages_daily: 200,
      transcribe_seconds_daily: 1800,
      captures_daily: 50,
      meeting_preps_daily: 30,
      semantic_search_daily: 300,
      meeting_prep: true,
      memory_search: true,
      voice_briefing: true,
      android_ni: true,
      midday_evening: true,
      advanced_planning: true,
      follow_up_commitments: true,
      capture: true,
      vip: true,
    },
  };

export interface MemoryGate extends EntitlementGate {
  readonly plans: Map<string, 'free' | 'pro'>;
  /** Current usage per `${userId}:${key}`. */
  readonly used: Map<string, number>;
  readonly checks: { userId: string; key: string; increment: number }[];
}

/** `public.check_plan_limit` over the seed: Free unless `plans` says Pro. */
export function memoryEntitlementGate(resetsAt = '2026-09-24T21:00:00.000Z'): MemoryGate {
  const plans = new Map<string, 'free' | 'pro'>();
  const used = new Map<string, number>();
  const checks: MemoryGate['checks'] = [];
  return {
    plans,
    used,
    checks,
    check(userId: string, key: GateKey, increment = 1): Promise<PlanLimitState> {
      checks.push({ userId, key, increment });
      const plan = plans.get(userId) ?? 'free';
      const value = SEED_PLAN_LIMITS[plan][key];
      if (typeof value === 'boolean') {
        return Promise.resolve({
          key,
          allowed: value,
          plan,
          limit: null,
          used: null,
          resets_at: null,
        });
      }
      if (value === undefined) throw new AppError('VALIDATION_FAILED', { details: { key } });
      const limit = value as number | null;
      const current = used.get(`${userId}:${key}`) ?? 0;
      return Promise.resolve({
        key,
        allowed: limit === null || current + increment <= limit,
        plan,
        limit,
        used: current,
        resets_at: key.endsWith('_daily') || key === 'ai_daily_budget_units' ? resetsAt : null,
      });
    },
  };
}

// ── Billing ─────────────────────────────────────────────────────────────────

export interface MemoryBilling extends BillingRepo {
  readonly users: Set<string>;
  readonly sandboxAllowed: Set<string>;
  readonly events: Map<string, { event_type: string; environment: string; status: string }>;
  readonly mirrors: Map<string, MirrorState & { synced_at: string; environment: string | null }>;
  readonly jobs: EnqueueInput[];
  readonly analyticsRows: AnalyticsRow[];
  readonly audits: AuditEntry[];
  /** Effective entitlement from grants (by user) on top of the mirror. */
  readonly grantActive: Set<string>;
}

export function memoryBillingRepo(): MemoryBilling {
  const users = new Set<string>();
  const sandboxAllowed = new Set<string>();
  const events: MemoryBilling['events'] = new Map();
  const mirrors: MemoryBilling['mirrors'] = new Map();
  const jobs: EnqueueInput[] = [];
  const analyticsRows: AnalyticsRow[] = [];
  const audits: AuditEntry[] = [];
  const grantActive = new Set<string>();
  const effective = (userId: string) => ({
    is_active: (mirrors.get(userId)?.is_active ?? false) || grantActive.has(userId),
    active_until: mirrors.get(userId)?.expires_at ?? null,
  });
  return {
    users,
    sandboxAllowed,
    events,
    mirrors,
    jobs,
    analyticsRows,
    audits,
    grantActive,
    context(appUserId, eventId): Promise<BillingSyncContext> {
      const event = eventId === null ? undefined : events.get(eventId);
      const mirror = mirrors.get(appUserId);
      return Promise.resolve({
        user_id: users.has(appUserId) ? appUserId : null,
        sandbox_allowed: sandboxAllowed.has(appUserId),
        locale: 'tr-TR',
        event:
          event === undefined || eventId === null
            ? null
            : {
                event_id: eventId,
                event_type: event.event_type,
                environment: event.environment,
                process_status: event.status,
              },
        mirror:
          mirror === undefined
            ? null
            : { is_active: mirror.is_active, status: mirror.status, synced_at: mirror.synced_at },
      });
    },
    markEvent(eventId, status) {
      const event = events.get(eventId);
      if (event !== undefined) event.status = status;
      return Promise.resolve();
    },
    applyMirror(userId, _rc, snapshot, eventId): Promise<ApplyMirrorResult> {
      const old = mirrors.get(userId);
      if (old !== undefined && Date.parse(old.synced_at) > Date.parse(snapshot.fetched_at)) {
        return Promise.resolve({
          skipped: 'stale_snapshot',
          previous: null,
          current: null,
          event_type: null,
          effective_before: null,
          effective_after: null,
        });
      }
      const before = effective(userId);
      const current = {
        is_active: snapshot.is_active,
        status: snapshot.status,
        will_renew: snapshot.will_renew,
        period_type: snapshot.period_type,
        expires_at: snapshot.expires_at,
        product_id: snapshot.product_id,
        store: snapshot.store,
        original_purchased_at: snapshot.original_purchased_at,
        environment: snapshot.environment,
        synced_at: snapshot.fetched_at,
      };
      mirrors.set(userId, current);
      const event = eventId === null ? undefined : events.get(eventId);
      if (event !== undefined) event.status = 'processed';
      return Promise.resolve({
        skipped: null,
        previous: old ?? null,
        current,
        event_type: event?.event_type ?? null,
        effective_before: before,
        effective_after: effective(userId),
      });
    },
    enqueue(input) {
      if (!jobs.some((j) => j.idempotencyKey === input.idempotencyKey)) jobs.push(input);
      return Promise.resolve(crypto.randomUUID());
    },
    analytics(row) {
      analyticsRows.push(row);
      return Promise.resolve();
    },
    audit(entry) {
      audits.push(entry);
      return Promise.resolve();
    },
  };
}

/** `public.record_billing_event` semantics: dedupe on event id, one job per id and event. */
export function memoryBillingLedger(): BillingLedger & {
  readonly rows: BillingEventRecord[];
  readonly jobKeys: string[];
} {
  const rows: BillingEventRecord[] = [];
  const jobKeys: string[] = [];
  return {
    rows,
    jobKeys,
    record(event) {
      if (rows.some((r) => r.eventId === event.eventId))
        return Promise.resolve({ inserted: false, jobs: [] });
      rows.push(event);
      const jobs = event.syncIds.map((id) => {
        jobKeys.push(`billing_sync:${id}:${event.eventId}`);
        return crypto.randomUUID();
      });
      return Promise.resolve({ inserted: true, jobs });
    },
  };
}

/** A RevenueCat client answering from a per-user map (or throwing a configured error). */
export function stubRevenueCat(
  customers: Map<string, RevenueCatCustomerData>,
  failure: { error: AppError | null } = { error: null },
): RevenueCatClient & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchCustomer(appUserId) {
      calls.push(appUserId);
      if (failure.error !== null) return Promise.reject(failure.error);
      return Promise.resolve(
        customers.get(appUserId) ?? {
          found: false,
          entitlementId: 'entl_pro',
          customer: null,
          subscriptions: [],
          productIdentifiers: {},
        },
      );
    },
  };
}

/** A REST v2 customer with an active (or lapsed) Pro subscription. */
export function rcCustomer(
  appUserId: string,
  options: {
    active: boolean;
    expiresAt: Date;
    status?: string;
    environment?: 'production' | 'sandbox';
    store?: string;
    autoRenewal?: string;
    product?: string;
  },
): RevenueCatCustomerData {
  const product = options.product ?? 'da_pro_monthly';
  return {
    found: true,
    entitlementId: 'entl_pro',
    customer: {
      id: appUserId,
      active_entitlements: {
        items: options.active
          ? [{ entitlement_id: 'entl_pro', expires_at: options.expiresAt.getTime() }]
          : [],
      },
    },
    subscriptions: [
      {
        id: `sub_${appUserId.slice(0, 8)}`,
        product_id: 'prod_rc_1',
        starts_at: options.expiresAt.getTime() - 40 * 24 * 3600 * 1000,
        current_period_starts_at: options.expiresAt.getTime() - 30 * 24 * 3600 * 1000,
        current_period_ends_at: options.expiresAt.getTime(),
        gives_access: options.active,
        auto_renewal_status: options.autoRenewal ?? 'will_renew',
        status: options.status ?? (options.active ? 'active' : 'expired'),
        environment: options.environment ?? 'production',
        store: options.store ?? 'app_store',
        ownership: 'purchased',
        entitlements: { items: [{ id: 'entl_pro' }] },
      },
    ],
    productIdentifiers: { prod_rc_1: product },
  };
}

// ── Referrals ───────────────────────────────────────────────────────────────

export interface FakeReferralUser {
  created_at: string;
  email: string | null;
  apple_sub: string | null;
  display_name: string | null;
  device_hashes: string[];
  installation_ids: string[];
  provider_emails: string[];
  onboarding_completed_at: string | null;
  account_connected_at: string | null;
  first_briefing_at: string | null;
  cap: number;
}

export interface FakeReferral {
  id: string;
  referrer_id: string | null;
  referee_id: string | null;
  code: string;
  status: ReferralStatusValue;
  applied_at: string;
  device_hash: string | null;
  email_hash: string | null;
  risk_signals: Record<string, Json>;
  qualification: Record<string, Json>;
  reject_reason: string | null;
  risk_score: number;
}

export interface MemoryReferrals extends ReferralRepo {
  readonly users: Map<string, FakeReferralUser>;
  readonly codes: Map<string, { code: string; disabled: boolean }>;
  readonly referrals: FakeReferral[];
  readonly credits: {
    referral_id: string;
    user_id: string;
    side: 'referrer' | 'referee';
    days: number;
    created_at: string;
  }[];
  readonly grants: { user_id: string; key: string; days: number }[];
  readonly jobs: EnqueueInput[];
  readonly settings: Record<string, unknown>;
  readonly tombstones: Set<string>;
  otherAccountsSharing: number;
  addUser(id: string, user?: Partial<FakeReferralUser>): FakeReferralUser;
}

export function memoryReferralRepo(now: () => Date = () => new Date()): MemoryReferrals {
  const users = new Map<string, FakeReferralUser>();
  const codes = new Map<string, { code: string; disabled: boolean }>();
  const referrals: FakeReferral[] = [];
  const credits: MemoryReferrals['credits'] = [];
  const grants: MemoryReferrals['grants'] = [];
  const jobs: EnqueueInput[] = [];
  const settings: Record<string, unknown> = {};
  const tombstones = new Set<string>();
  const days = () =>
    typeof settings['referral.reward_days'] === 'number'
      ? (settings['referral.reward_days'] as number)
      : 14;
  const yearAgo = () => now().getTime() - 365 * 24 * 3600 * 1000;
  const ownerOf = (code: string) =>
    [...codes.entries()].find(([, c]) => c.code === code.toUpperCase() && !c.disabled)?.[0] ?? null;
  const party = (id: string | null) => (id === null ? undefined : users.get(id));

  function credit(r: FakeReferral, side: 'referrer' | 'referee'): void {
    const userId = side === 'referrer' ? r.referrer_id : r.referee_id;
    if (userId === null || credits.some((c) => c.referral_id === r.id && c.side === side)) return;
    credits.push({
      referral_id: r.id,
      user_id: userId,
      side,
      days: days(),
      created_at: now().toISOString(),
    });
    grants.push({ user_id: userId, key: `referral:${r.id}:${side}`, days: days() });
  }

  function rewardWithCap(r: FakeReferral): DecideResult {
    const sidesOf = () =>
      credits
        .filter((c) => c.referral_id === r.id)
        .map((c) => c.side)
        .sort();
    if (r.status === 'rewarded') {
      return {
        status: 'rewarded',
        replayed: true,
        days: days(),
        sides: sidesOf(),
        referrer_id: r.referrer_id,
        referee_id: r.referee_id,
      };
    }
    const cap = party(r.referrer_id)?.cap ?? 6;
    const used = credits.filter(
      (c) =>
        c.user_id === r.referrer_id &&
        c.side === 'referrer' &&
        Date.parse(c.created_at) > yearAgo(),
    ).length;
    const withheld =
      r.referrer_id === null ? 'referrer_deleted' : used >= cap ? 'cap_reached' : null;
    if (withheld === null) credit(r, 'referrer');
    credit(r, 'referee');
    r.status = 'rewarded';
    if (withheld !== null) r.risk_signals = { ...r.risk_signals, referrer_withheld: withheld };
    return {
      status: 'rewarded',
      days: days(),
      sides: sidesOf(),
      referrer_id: r.referrer_id,
      referee_id: r.referee_id,
      referrer_withheld: withheld,
    };
  }

  const repo: MemoryReferrals = {
    users,
    codes,
    referrals,
    credits,
    grants,
    jobs,
    settings,
    tombstones,
    otherAccountsSharing: 0,
    addUser(id, user = {}) {
      const row: FakeReferralUser = {
        created_at: now().toISOString(),
        email: null,
        apple_sub: null,
        display_name: null,
        device_hashes: [],
        installation_ids: [],
        provider_emails: [],
        onboarding_completed_at: null,
        account_connected_at: null,
        first_briefing_at: null,
        cap: 6,
        ...user,
      };
      users.set(id, row);
      return row;
    },
    ensureCode(userId, candidate) {
      const existing = codes.get(userId);
      if (existing !== undefined) return Promise.resolve(existing.code);
      if ([...codes.values()].some((c) => c.code === candidate)) return Promise.resolve(null);
      codes.set(userId, { code: candidate, disabled: false });
      return Promise.resolve(candidate);
    },
    overview(userId) {
      const mine = referrals
        .filter((r) => r.referrer_id === userId)
        .sort((a, b) => Date.parse(b.applied_at) - Date.parse(a.applied_at));
      const referredBy = referrals.find((r) => r.referee_id === userId);
      return Promise.resolve({
        code: codes.get(userId)?.code ?? null,
        reward_days: days(),
        cap_per_year: users.get(userId)?.cap ?? 6,
        rewarded_this_year: credits.filter(
          (c) =>
            c.user_id === userId && c.side === 'referrer' && Date.parse(c.created_at) > yearAgo(),
        ).length,
        earned_days_total: credits
          .filter((c) => c.user_id === userId)
          .reduce((n, c) => n + c.days, 0),
        referrals: mine.map((r) => {
          const u = party(r.referee_id);
          return {
            id: r.id,
            status: r.status,
            created_at: r.applied_at,
            initial: (u?.display_name ?? u?.email ?? '').charAt(0).toUpperCase() || null,
          };
        }),
        referred_by: referredBy === undefined ? null : { status: referredBy.status },
      });
    },
    applyContext(refereeId, code): Promise<ApplyContextRow> {
      const ownerId = ownerOf(code);
      const referee = users.get(refereeId);
      const owner = ownerId === null ? undefined : users.get(ownerId);
      return Promise.resolve({
        code_owner: ownerId,
        settings,
        referee:
          referee === undefined
            ? null
            : {
                user_id: refereeId,
                created_at: referee.created_at,
                email: referee.email,
                apple_sub: referee.apple_sub,
                has_referral: referrals.some((r) => r.referee_id === refereeId),
                device_hashes: referee.device_hashes,
                installation_device_hash: null,
                onboarding_completed_at: referee.onboarding_completed_at,
                account_connected_at: referee.account_connected_at,
                first_briefing_at: referee.first_briefing_at,
              },
        owner:
          owner === undefined || ownerId === null
            ? null
            : {
                user_id: ownerId,
                email: owner.email,
                apple_sub: owner.apple_sub,
                device_hashes: owner.device_hashes,
              },
      });
    },
    apply(input) {
      if (referrals.some((r) => r.referee_id === input.refereeId)) {
        return Promise.reject(new AppError('REFERRAL_ALREADY_APPLIED'));
      }
      if (ownerOf(input.code) !== input.referrerId)
        return Promise.reject(new AppError('REFERRAL_CODE_INVALID'));
      const row: FakeReferral = {
        id: crypto.randomUUID(),
        referrer_id: input.referrerId,
        referee_id: input.refereeId,
        code: input.code,
        status: 'pending',
        applied_at: now().toISOString(),
        device_hash: input.deviceHash,
        email_hash: input.emailHash,
        risk_signals: { ...input.signals, source: input.source },
        qualification: {},
        reject_reason: null,
        risk_score: 0,
      };
      referrals.push(row);
      jobs.push({
        type: 'referral_evaluate',
        idempotencyKey: `referral_evaluate:${row.id}:apply`,
        payload: { referral_id: row.id },
        userId: input.refereeId,
        runAfter: new Date(Math.max(now().getTime(), input.runAfter.getTime())),
      });
      return Promise.resolve({
        referral_id: row.id,
        status: 'pending',
        applied_at: row.applied_at,
      });
    },
    evaluationContext(referralId): Promise<EvaluationContextRow> {
      const r = referrals.find((x) => x.id === referralId);
      if (r === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      const referee = party(r.referee_id);
      const referrer = party(r.referrer_id);
      return Promise.resolve({
        referral: {
          id: r.id,
          status: r.status,
          applied_at: r.applied_at,
          referrer_id: r.referrer_id,
          referee_id: r.referee_id,
          referee_email_hash: r.email_hash,
          referee_device_hash: r.device_hash,
          risk_signals: r.risk_signals,
        },
        referee:
          referee === undefined || r.referee_id === null
            ? null
            : {
                user_id: r.referee_id,
                created_at: referee.created_at,
                email: referee.email,
                apple_sub: referee.apple_sub,
                installation_ids: referee.installation_ids,
                device_hashes: referee.device_hashes,
                provider_emails: referee.provider_emails,
                onboarding_completed_at: referee.onboarding_completed_at,
                account_connected_at: referee.account_connected_at,
                first_briefing_at: referee.first_briefing_at,
              },
        referrer:
          referrer === undefined || r.referrer_id === null
            ? null
            : {
                user_id: r.referrer_id,
                email: referrer.email,
                apple_sub: referrer.apple_sub,
                device_hashes: referrer.device_hashes,
                provider_emails: referrer.provider_emails,
              },
        siblings: referrals
          .filter(
            (x) =>
              x.referrer_id === r.referrer_id &&
              x.id !== r.id &&
              x.status !== 'rejected' &&
              x.referee_id !== null,
          )
          .map((x) => ({
            user_id: x.referee_id ?? '',
            email_hash: x.email_hash,
            device_hash: x.device_hash,
          })),
        // Mirrors 20260924002700: legs rejected as a loop stay in the walk.
        edges: referrals
          .filter(
            (x) =>
              (x.status !== 'rejected' || x.reject_reason === 'loop') &&
              x.referrer_id !== null &&
              x.referee_id !== null &&
              x.id !== r.id,
          )
          .map((x) => ({ referrer_id: x.referrer_id ?? '', referee_id: x.referee_id ?? '' })),
        referrer_applied_at: referrals
          .filter(
            (x) =>
              x.referrer_id === r.referrer_id &&
              Math.abs(Date.parse(x.applied_at) - Date.parse(r.applied_at)) <= 24 * 3600 * 1000,
          )
          .map((x) => x.applied_at),
        referrer_rewarded_at: credits
          .filter(
            (c) =>
              c.user_id === r.referrer_id &&
              c.side === 'referrer' &&
              Date.parse(c.created_at) > yearAgo(),
          )
          .map((c) => c.created_at),
        other_accounts_sharing: repo.otherAccountsSharing,
        settings,
        rewards_per_year: referrer?.cap ?? 6,
      });
    },
    tombstoneMatch(signals) {
      return Promise.resolve(signals.some((s) => tombstones.has(`${s.kind}:${s.hash}`)));
    },
    decide(input: DecideInput): Promise<DecideResult> {
      const r = referrals.find((x) => x.id === input.referralId);
      if (r === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      if ((r.status === 'qualified' || r.status === 'rewarded') && input.decision === 'qualify') {
        return Promise.resolve(rewardWithCap(r));
      }
      if (r.status !== 'pending') return Promise.resolve({ status: r.status, changed: false });
      r.risk_score = input.riskScore ?? 0;
      r.risk_signals = { ...r.risk_signals, assessment: input.assessment ?? {} };
      if (input.qualification !== undefined && input.qualification !== null)
        r.qualification = input.qualification;
      switch (input.decision) {
        case 'wait':
          return Promise.resolve({ status: 'pending', changed: false });
        case 'reject':
          r.status = 'rejected';
          r.reject_reason = input.rejectReason ?? null;
          return Promise.resolve({
            status: 'rejected',
            changed: true,
            reject_reason: r.reject_reason,
          });
        case 'flag':
          r.status = 'flagged';
          return Promise.resolve({ status: 'flagged', changed: true });
        case 'qualify':
          r.status = 'qualified';
          return Promise.resolve({ ...rewardWithCap(r), changed: true });
      }
    },
    enqueue(input) {
      if (!jobs.some((j) => j.idempotencyKey === input.idempotencyKey)) jobs.push(input);
      return Promise.resolve(crypto.randomUUID());
    },
  };
  return repo;
}
