/**
 * Ranking for Today and Flow (AI_PIPELINE_PLAN §7.6, "aciliyet → zaman"):
 *
 *   score = urgencyBase[urgency] (urgent 400, today 300, normal 200, low 100)
 *         + proximity(due_or_start)   ≤3 h +80, today +50, tomorrow +20
 *         + importance high +60 + vip +40 + learnedDelta (−60…+60, 0 when learning is off)
 *         − ageDecay(created_at)      −5 per day, floor −50
 *
 * Ties break on the earlier display time, then the insight kind order. Today shows the top 5.
 */
import type { InsightKind, Urgency } from '@da/domain';
import { localDate, localDateDiffDays } from '@da/domain';

export const TODAY_PRIORITY_LIMIT = 5;

const URGENCY_BASE: Readonly<Record<Urgency, number>> = {
  urgent: 400,
  today: 300,
  normal: 200,
  low: 100,
};

/** Tie-break order (§7.6); security is pinned in "Kişisel". */
export const KIND_ORDER: readonly InsightKind[] = [
  'reply_needed',
  'deadline',
  'meeting',
  'follow_up',
  'commitment',
  'conflict',
  'schedule_suggestion',
  'life_event',
  'security',
  'approval_pending',
  'digest',
];

export interface RankInput {
  readonly kind: InsightKind;
  readonly urgency: Urgency;
  readonly dueAt: string | null;
  readonly eventAt: string | null;
  readonly createdAt: string | null;
  readonly importanceHigh: boolean;
  readonly vip: boolean;
  /** Learned preference delta (−60…+60); 0 when learning is off. */
  readonly learnedDelta?: number;
}

export interface RankContext {
  readonly now: Date;
  readonly timeZone: string;
}

export function proximityBonus(at: string | null, ctx: RankContext): number {
  if (at === null) return 0;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return 0;
  const diff = t - ctx.now.getTime();
  if (diff >= -3_600_000 && diff <= 3 * 3_600_000) return 80;
  const days = localDateDiffDays(localDate(ctx.now, ctx.timeZone), localDate(new Date(t), ctx.timeZone));
  if (days === 0) return 50;
  if (days === 1) return 20;
  return 0;
}

export function ageDecay(createdAt: string | null, now: Date): number {
  if (createdAt === null) return 0;
  const days = Math.floor((now.getTime() - Date.parse(createdAt)) / 86_400_000);
  return days <= 0 ? 0 : Math.min(50, days * 5);
}

/** `insights.rank_score` (numeric(8,4)). */
export function rankScore(input: RankInput, ctx: RankContext): number {
  const at = [input.dueAt, input.eventAt]
    .filter((v): v is string => v !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const learned = Math.max(-60, Math.min(60, input.learnedDelta ?? 0));
  const score =
    URGENCY_BASE[input.urgency] +
    proximityBonus(at, ctx) +
    (input.importanceHigh ? 60 : 0) +
    (input.vip ? 40 : 0) +
    learned -
    ageDecay(input.createdAt, ctx.now);
  return Math.round(score * 10_000) / 10_000;
}

export interface Rankable {
  readonly kind: InsightKind;
  readonly rank_score: number;
  readonly due_at: string | null;
  readonly event_at: string | null;
  readonly source_timestamp: string;
}

function displayAt(r: Rankable): number {
  const times = [r.due_at, r.event_at]
    .filter((v): v is string => v !== null)
    .map((v) => Date.parse(v));
  return times.length > 0 ? Math.min(...times) : Date.parse(r.source_timestamp);
}

/** Descending score, then the earlier display time, then the kind order (stable). */
export function compareRanked(a: Rankable, b: Rankable): number {
  if (a.rank_score !== b.rank_score) return b.rank_score - a.rank_score;
  const at = displayAt(a) - displayAt(b);
  if (at !== 0) return at;
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
}

export function rankInsights<T extends Rankable>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => compareRanked(x.item, y.item) || x.index - y.index)
    .map((x) => x.item);
}

/** "Bugünün Öncelikleri": the top 5 ranked items that are not pinned to "Kişisel". */
export function todayPriorities<T extends Rankable>(items: readonly T[]): T[] {
  return rankInsights(items.filter((i) => i.kind !== 'security')).slice(0, TODAY_PRIORITY_LIMIT);
}
