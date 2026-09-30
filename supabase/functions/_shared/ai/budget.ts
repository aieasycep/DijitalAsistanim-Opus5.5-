/**
 * Per-user AI budget (API_CONTRACTS §4.3, AI_PIPELINE_PLAN §8.9, IMPLEMENTATION_PLAN T-3.09).
 * `private.ai_budget_reserve` holds the estimated cost (and units) before a call; `private.
 * ai_budget_settle` books the actual cost after it, in `ai_usage_daily` for the user's local day.
 * A refused reservation means `ai_budget_exhausted`: the caller degrades to its T0 path
 * (background) or answers `QUOTA_EXCEEDED` (interactive).
 */
import type { AiFeature } from '@da/domain';
import { AppError } from '../errors.ts';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import type { NormalizedUsage } from './types.ts';

export type BudgetLevel = 'l0' | 'l1' | 'l2';
export type BudgetRefusal = 'units_exhausted' | 'hard_cap_day' | 'hard_cap_month';

export interface Reservation {
  readonly allow: boolean;
  readonly level: BudgetLevel;
  readonly reason: BudgetRefusal | null;
  readonly reservationId: string | null;
}

export interface ReserveInput {
  readonly userId: string;
  readonly feature: AiFeature;
  readonly estCostMicros: number;
  readonly units: number;
}

export interface SettleInput {
  readonly reservationId: string;
  readonly aiRequestId: string | null;
  readonly actualCostMicros: number;
  readonly units: number;
  readonly usage: NormalizedUsage;
}

export interface BudgetGate {
  reserve(input: ReserveInput): Promise<Reservation>;
  settle(input: SettleInput): Promise<void>;
}

const LIMIT_KEY: Readonly<Record<BudgetRefusal, string>> = {
  units_exhausted: 'ai_daily_budget_units',
  hard_cap_day: 'ai_hard_cap_usd_day',
  hard_cap_month: 'ai_hard_cap_usd_month',
};

/** `QUOTA_EXCEEDED` for interactive routes (§4.3). */
export function budgetExceededError(reservation: Reservation): AppError {
  const reason = reservation.reason ?? 'hard_cap_day';
  return new AppError('QUOTA_EXCEEDED', {
    details: { limit_key: LIMIT_KEY[reason], upgrade_available: true },
  });
}

function parseReservation(raw: unknown): Reservation {
  const r = (raw ?? {}) as {
    allow?: unknown;
    level?: unknown;
    reason?: unknown;
    reservation_id?: unknown;
  };
  const level = r.level === 'l1' || r.level === 'l2' ? r.level : 'l0';
  const reason =
    r.reason === 'units_exhausted' || r.reason === 'hard_cap_day' || r.reason === 'hard_cap_month'
      ? r.reason
      : null;
  return {
    allow: r.allow === true,
    level,
    reason,
    reservationId: typeof r.reservation_id === 'string' ? r.reservation_id : null,
  };
}

export function supabaseBudgetGate(client: DbClient): BudgetGate {
  return {
    async reserve(input) {
      const raw = await rpc<unknown>(client, DB_FN.aiBudgetReserve, {
        p_user: input.userId,
        p_feature: input.feature,
        p_est_cost_micros: Math.max(0, Math.round(input.estCostMicros)),
        p_units: Math.max(0, Math.round(input.units)),
      });
      return parseReservation(raw);
    },
    async settle(input) {
      await rpc<null>(client, DB_FN.aiBudgetSettle, {
        p_reservation_id: input.reservationId,
        p_ai_request_id: input.aiRequestId,
        p_actual_cost_micros: Math.max(0, Math.round(input.actualCostMicros)),
        p_units: Math.max(0, Math.round(input.units)),
        p_tokens: {
          input: input.usage.inputTokens,
          output: input.usage.outputTokens,
          cache_read: input.usage.cacheReadTokens,
          cache_write: input.usage.cacheWriteTokens + input.usage.cacheWrite1hTokens,
        },
      });
    },
  };
}

// ── Organisation ceiling (T-5.17, AI_PIPELINE_PLAN §8.10 L3) ────────────────

/** Result of `private.ai_org_budget_evaluate` (spend of the UTC day against the org ceiling). */
export interface OrgBudgetState {
  readonly status: 'ok' | 'disabled' | 'not_configured';
  readonly spentMicros: number;
  readonly ceilingMicros: number | null;
  readonly pct: number;
  readonly tripped: boolean;
  readonly alerts: readonly number[];
}

export function parseOrgBudgetState(raw: unknown): OrgBudgetState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status =
    r.status === 'ok' || r.status === 'disabled' || r.status === 'not_configured'
      ? r.status
      : 'not_configured';
  return {
    status,
    spentMicros: Number(r.spent_micros ?? 0),
    ceilingMicros: r.ceiling_micros === undefined ? null : Number(r.ceiling_micros),
    pct: Number(r.pct ?? 0),
    tripped: r.tripped === true,
    alerts: Array.isArray(r.alerts) ? r.alerts.map(Number) : [],
  };
}

export type OrgBudgetEvaluator = () => Promise<OrgBudgetState>;

export function supabaseOrgBudgetEvaluator(client: DbClient): OrgBudgetEvaluator {
  return async () =>
    parseOrgBudgetState(
      await rpc<unknown>(client, DB_FN.aiOrgBudgetEvaluate, { p_now: new Date().toISOString() }),
    );
}

/**
 * Evaluates the org ceiling after settlements, at most once per `intervalMs` per isolate (the
 * scheduler evaluates it every 5 minutes as well). The trip itself (`ai.model.large.enabled=false`)
 * happens in SQL and is audited; flag caches pick it up within their TTL.
 */
export function withOrgBudgetGuard(
  gate: BudgetGate,
  evaluate: OrgBudgetEvaluator,
  options: { intervalMs?: number; now?: () => number; onTrip?: (s: OrgBudgetState) => void } = {},
): BudgetGate & { lastState(): OrgBudgetState | null } {
  const interval = options.intervalMs ?? 60_000;
  const now = options.now ?? Date.now;
  let lastAt = -Infinity;
  let last: OrgBudgetState | null = null;
  let inflight: Promise<void> | null = null;
  const check = (): Promise<void> => {
    if (inflight !== null) return inflight;
    if (now() - lastAt < interval) return Promise.resolve();
    lastAt = now();
    inflight = evaluate()
      .then((state) => {
        last = state;
        if (state.tripped) options.onTrip?.(state);
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return {
    reserve: (input) => gate.reserve(input),
    async settle(input) {
      await gate.settle(input);
      await check();
    },
    lastState: () => last,
  };
}
