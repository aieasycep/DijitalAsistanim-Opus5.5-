/**
 * Priority engine (AI_PIPELINE_PLAN §7; TEST_PLAN §2.1). Precedence, first tier that yields a
 * value wins, per dimension (importance, notify):
 *
 *   explicit_rule → learned_preference → deterministic_signal → ai_classification
 *
 * Every result carries its tier, a reason code (`^[a-z_]{3,48}$`, the `insights.reason_code`
 * check), the rule / learned preference id and a confidence, so source, AI confidence and
 * deterministic rules stay separable (M§14).
 */
import type {
  DecisionTier,
  InsightKind,
  MailCategory,
  RuleCondition,
  RuleOutcome,
  Urgency,
} from '../enums.ts';
import { MAIL_CATEGORY_VALUES, URGENCY_VALUES } from '../enums.ts';
import type { LearnedPreference, PriorityRule, RuleException } from '../entities/intelligence.ts';
import { foldTR, LB, normalizeTR, RB, escapeRegExp } from '../extract/normalize-tr.ts';
import {
  BULK_SIGNALS,
  detectSignals,
  emailDomain,
  INFORMATIONAL_SIGNALS,
  type SignalCode,
  type SignalInput,
} from './signals.ts';

export type Importance = 'high' | 'normal' | 'low' | 'muted';
export type NotifyLevel = 'always' | 'default' | 'never';

/** The item being prioritised. */
export interface PriorityItem extends SignalInput {
  readonly source: 'mail' | 'insight' | 'android_notification';
  readonly fromContactId?: string | null;
  /** Transient body text for `keyword` rules with `search_body` (never stored). */
  readonly bodyText?: string | null;
  /** Gmail/Graph category or `promotions` / `newsletter`, for `category` rules. */
  readonly category?: string | null;
  /** Android NI package name, for `android_app` rules. */
  readonly appPackage?: string | null;
  /** `List-Id` / bulk category key for learned list preferences. */
  readonly listKey?: string | null;
  /** `{insight_kind}:{source_key}` for learned insight-type preferences. */
  readonly insightKey?: string | null;
  readonly insightKind?: InsightKind | null;
}

export interface AiClassification {
  /** Raw model label; normalised with {@link normalizeAiCategory}. */
  readonly category: string;
  readonly confidence: number;
  readonly urgency?: Urgency | null;
  /** Short model reason (shown in "Neden önemli?" as AI reasoning). */
  readonly reasonCode?: string | null;
}

export interface VipMembership {
  readonly contactIds: readonly string[];
  readonly emails?: readonly string[];
  /** Contacts whose VIP row has `always_notify=false`. */
  readonly notifyOff?: readonly string[];
}

export interface PriorityContext {
  readonly rules: readonly PriorityRule[];
  readonly learned: readonly LearnedPreference[];
  readonly vip: VipMembership;
  /** VIP effects need Pro (M§44). */
  readonly isPro: boolean;
  /** `user_preferences.learn_from_interactions`. */
  readonly learnFromInteractions: boolean;
}

export interface PriorityResult {
  readonly category: MailCategory;
  readonly importance: Importance;
  readonly urgency: Urgency;
  readonly notify: boolean;
  readonly notify_level: NotifyLevel;
  readonly decision_tier: DecisionTier;
  readonly reason_code: string;
  readonly rule_id: string | null;
  /** The rule that decided the notify dimension (`always_notify` / `mute`), if any. */
  readonly notify_rule_id: string | null;
  readonly learned_preference_id: string | null;
  readonly confidence: number;
  /** A model call is still useful (false for T0-final items: bulk, informational baselines). */
  readonly ai_needed: boolean;
  /** Real-time triage (urgency keywords, awaiting-reply threads) instead of batch. */
  readonly realtime: boolean;
  readonly signals: readonly SignalCode[];
}

// ---------------------------------------------------------------------------------------------
// Explicit rules
// ---------------------------------------------------------------------------------------------

/** Specificity inside the explicit tier (TEST_PLAN note 16 + AI plan §7.2). */
const SPECIFICITY: Readonly<Record<RuleCondition | 'vip', number>> = {
  person: 0,
  sender: 1,
  domain: 2,
  vip: 3,
  keyword: 4,
  category: 5,
  android_app: 6,
};
const OUTCOME_ORDER: Readonly<Record<RuleOutcome, number>> = {
  always_important: 0,
  high: 1,
  always_notify: 2,
  low: 3,
  mute: 4,
};

/** Named rule presets (IMPLEMENTATION_PLAN T-1.07) mapped onto the DB condition/outcome pair. */
export const RULE_TEMPLATES = {
  sender_important: { condition_type: 'sender', outcome: 'always_important' },
  domain_important: { condition_type: 'domain', outcome: 'always_important' },
  vip_always_notify: { condition_type: 'person', outcome: 'always_notify' },
  keyword_high: { condition_type: 'keyword', outcome: 'high' },
  promotions_low: { condition_type: 'category', outcome: 'low' },
  mute_sender: { condition_type: 'sender', outcome: 'mute' },
  app_package: { condition_type: 'android_app', outcome: 'always_notify' },
} as const satisfies Record<string, { condition_type: RuleCondition; outcome: RuleOutcome }>;

export type RuleTemplate = keyof typeof RULE_TEMPLATES;

function keywordMatches(keyword: string, haystack: string): boolean {
  const k = foldTR(normalizeTR(keyword));
  if (k.length === 0) return false;
  return new RegExp(`${LB}${escapeRegExp(k)}${RB}`, 'u').test(haystack);
}

function conditionMatches(
  type: RuleCondition,
  value: Readonly<Record<string, unknown>>,
  item: PriorityItem,
): boolean {
  const from = item.fromEmail.trim().toLowerCase();
  switch (type) {
    case 'person':
      return typeof value.contact_id === 'string' && value.contact_id === item.fromContactId;
    case 'sender':
      return typeof value.address === 'string' && value.address.trim().toLowerCase() === from;
    case 'domain': {
      if (typeof value.domain !== 'string') return false;
      const d = value.domain.replace(/^@/, '').toLowerCase();
      const fd = emailDomain(from);
      return fd === d || fd.endsWith(`.${d}`);
    }
    case 'keyword': {
      if (!Array.isArray(value.keywords)) return false;
      const parts = [item.subject ?? ''];
      if (value.search_body === true && item.bodyText) parts.push(item.bodyText);
      const hay = foldTR(normalizeTR(parts.join('\n')));
      return value.keywords.some((k) => typeof k === 'string' && keywordMatches(k, hay));
    }
    case 'category': {
      if (typeof value.category !== 'string') return false;
      const c = value.category.toLowerCase();
      const labels = (item.labels ?? []).map((l) => l.toLowerCase());
      return (
        item.category?.toLowerCase() === c ||
        labels.includes(`category_${c}`) ||
        (c === 'promotions' && labels.includes('category_promotions')) ||
        (c === 'newsletter' && item.headers?.listUnsubscribe === true)
      );
    }
    case 'android_app':
      return typeof value.package === 'string' && value.package === item.appPackage;
  }
}

function ruleApplies(rule: PriorityRule, item: PriorityItem): boolean {
  if (!rule.enabled || rule.deleted_at !== null) return false;
  const scope = item.source === 'android_notification' ? 'android_notification' : 'mail';
  if (rule.applies_to !== 'all' && rule.applies_to !== scope) return false;
  const value = {
    ...(rule.condition_value as Readonly<Record<string, unknown>>),
    search_body: rule.search_body,
  };
  if (!conditionMatches(rule.condition_type, value, item)) return false;
  // exceptions are evaluated first ("Promosyon kategorisi hariç")
  return !rule.exceptions.some((ex: RuleException) =>
    conditionMatches(ex.condition_type, ex.condition_value, item),
  );
}

const IMPORTANCE_OUTCOMES: readonly RuleOutcome[] = ['always_important', 'high', 'low', 'mute'];
const NOTIFY_OUTCOMES: readonly RuleOutcome[] = ['always_notify', 'mute'];

function bestRule(
  rules: readonly PriorityRule[],
  outcomes: readonly RuleOutcome[],
): PriorityRule | null {
  const pool = rules.filter((r) => outcomes.includes(r.outcome));
  pool.sort(
    (a, b) =>
      SPECIFICITY[a.condition_type] - SPECIFICITY[b.condition_type] ||
      OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
      a.sort_order - b.sort_order,
  );
  return pool[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// AI label normalisation (UT-CLS-01..03, 08)
// ---------------------------------------------------------------------------------------------

const AI_ALIASES: Readonly<Record<string, MailCategory>> = {
  important: 'important',
  onemli: 'important',
  reply_needed: 'awaiting_my_reply',
  needs_reply: 'awaiting_my_reply',
  awaiting_my_reply: 'awaiting_my_reply',
  awaiting_their_reply: 'awaiting_their_reply',
  has_deadline: 'has_deadline',
  deadline: 'has_deadline',
  informational: 'informational',
  info: 'informational',
  fyi: 'informational',
  low_priority: 'low_priority',
  low: 'low_priority',
  promotion: 'low_priority',
  newsletter: 'low_priority',
};

export interface NormalizedAiCategory {
  readonly category: MailCategory;
  readonly normalization: 'exact' | 'alias' | 'fallback';
}

/** Maps model labels ("IMPORTANT", "important ", "Önemli", "reply_needed") onto `mail_category`. */
export function normalizeAiCategory(label: string): NormalizedAiCategory {
  const key = foldTR(normalizeTR(label)).replace(/[\s-]+/g, '_');
  if ((MAIL_CATEGORY_VALUES as readonly string[]).includes(key)) {
    return { category: key as MailCategory, normalization: 'exact' };
  }
  const alias = AI_ALIASES[key];
  if (alias) return { category: alias, normalization: 'alias' };
  return { category: 'informational', normalization: 'fallback' };
}

/** Clamps model confidence to [0, 1]; NaN → 0 (UT-CLS-08). */
export function clampAiConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Exclusive category precedence (UT-CLS-04). */
export const CATEGORY_PRECEDENCE: readonly MailCategory[] = [
  'awaiting_my_reply',
  'has_deadline',
  'important',
  'awaiting_their_reply',
  'informational',
  'low_priority',
];

/** Picks the single category for a set of flags (mutually exclusive categories). */
export function selectCategory(flags: readonly MailCategory[]): MailCategory {
  return CATEGORY_PRECEDENCE.find((c) => flags.includes(c)) ?? 'informational';
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

const urgencyRank = (u: Urgency): number => URGENCY_VALUES.indexOf(u);
function atLeast(u: Urgency, floor: Urgency): Urgency {
  return urgencyRank(u) <= urgencyRank(floor) ? u : floor;
}

function categoryForImportance(importance: Importance): MailCategory {
  if (importance === 'high') return 'important';
  if (importance === 'normal') return 'informational';
  return 'low_priority';
}

/** AI never promotes to `important` below this calibrated confidence (UT-PRI-14). */
export const AI_IMPORTANT_MIN_CONFIDENCE = 0.5;

function learnedMatch(
  prefs: readonly LearnedPreference[],
  item: PriorityItem,
): LearnedPreference | null {
  const from = item.fromEmail.trim().toLowerCase();
  const order = { contact: 0, sender: 1, domain: 2, category: 3, topic: 4, setting: 5 } as const;
  const hits = prefs.filter((p) => {
    if (!p.enabled || p.deleted_at !== null) return false;
    if (!(p.priority_override ?? p.effect.priority)) return false;
    switch (p.target_type) {
      case 'contact':
        return p.target_ref === item.fromContactId;
      case 'sender':
        return p.target_ref.toLowerCase() === from;
      case 'domain': {
        const d = p.target_ref.replace(/^@/, '').toLowerCase();
        const fd = emailDomain(from);
        return fd === d || fd.endsWith(`.${d}`);
      }
      case 'category':
        return p.target_ref === item.listKey || p.target_ref === item.insightKey;
      case 'topic':
      case 'setting':
        return false;
    }
  });
  hits.sort((a, b) => order[a.target_type] - order[b.target_type]);
  return hits[0] ?? null;
}

function isVip(item: PriorityItem, vip: VipMembership): boolean {
  const from = item.fromEmail.trim().toLowerCase();
  return (
    (item.fromContactId !== undefined &&
      item.fromContactId !== null &&
      vip.contactIds.includes(item.fromContactId)) ||
    (vip.emails ?? []).some((e) => e.trim().toLowerCase() === from)
  );
}

/**
 * `evaluatePriority({meta, rules, learned, vipIds, signals, ai?})`: resolves category, importance,
 * urgency and notify with tier precedence. Mute beats an AI "important"; VIP (Pro) raises urgency.
 */
export function evaluatePriority(
  item: PriorityItem,
  ctx: PriorityContext,
  ai?: AiClassification | null,
): PriorityResult {
  const signals = detectSignals(item);
  const has = (s: SignalCode): boolean => signals.includes(s);
  const bulk = signals.some((s) => BULK_SIGNALS.includes(s));
  const securityVerified = has('security_verified');
  const deadlineSoon = has('deadline_today') || has('deadline_tomorrow');
  const vip = ctx.isPro && isVip(item, ctx.vip);
  const realtime = !bulk && (has('urgency_keyword') || has('awaiting_my_reply'));

  let importance: Importance | null = null;
  let notifyLevel: NotifyLevel | null = null;
  let tier: DecisionTier | null = null;
  let reason = '';
  let ruleId: string | null = null;
  let learnedId: string | null = null;
  let confidence = 1;
  let category: MailCategory | null = null;
  let urgency: Urgency = 'normal';
  let aiNeeded = false;

  // 1. explicit rules (+ VIP, a user-declared choice)
  const matching = ctx.rules.filter((r) => ruleApplies(r, item));
  const impRule = bestRule(matching, IMPORTANCE_OUTCOMES);
  const vipBeatsRule =
    vip && (impRule === null || SPECIFICITY.vip < SPECIFICITY[impRule.condition_type]);
  if (vipBeatsRule) {
    importance = 'high';
    tier = 'explicit_rule';
    reason = 'vip';
    urgency = 'today';
  } else if (impRule) {
    importance = impRule.outcome === 'mute' ? 'muted' : impRule.outcome === 'low' ? 'low' : 'high';
    tier = 'explicit_rule';
    reason = `rule_${impRule.condition_type}_${impRule.outcome}`;
    ruleId = impRule.id;
    if (importance === 'muted') urgency = 'low';
  }
  const notifyRule = bestRule(matching, NOTIFY_OUTCOMES);
  if (notifyRule) notifyLevel = notifyRule.outcome === 'mute' ? 'never' : 'always';
  else if (vip && !(ctx.vip.notifyOff ?? []).includes(item.fromContactId ?? ''))
    notifyLevel = 'always';
  if (importance === 'muted') notifyLevel = 'never';

  // 2. learned preferences (never for security, VIP, replied-to senders, deadlines within 24 h)
  const learnedAllowed =
    ctx.learnFromInteractions &&
    !securityVerified &&
    item.insightKind !== 'security' &&
    !vip &&
    !item.repliedBefore &&
    !has('deadline_today');
  if (importance === null && learnedAllowed) {
    const pref = learnedMatch(ctx.learned, item);
    const p = pref ? (pref.priority_override ?? pref.effect.priority) : undefined;
    if (pref && p) {
      importance = p;
      tier = 'learned_preference';
      reason = `learned_${p}`;
      learnedId = pref.id;
      confidence = 0.8;
      if (p === 'low') urgency = 'low';
    }
  }

  // 3. deterministic signals
  if (importance === null) {
    if (securityVerified) {
      importance = 'high';
      category = 'important';
      urgency = 'urgent';
      tier = 'deterministic_signal';
      reason = 'security_verified';
    } else if (bulk) {
      importance = 'low';
      category = 'low_priority';
      urgency = 'low';
      tier = 'deterministic_signal';
      reason = signals.find((s) => BULK_SIGNALS.includes(s)) ?? 'bulk';
    } else if (deadlineSoon) {
      importance = 'normal';
      category = 'has_deadline';
      urgency = 'today';
      tier = 'deterministic_signal';
      reason = has('deadline_today') ? 'deadline_today' : 'deadline_tomorrow';
      aiNeeded = true;
    } else if (signals.some((s) => INFORMATIONAL_SIGNALS.includes(s))) {
      importance = 'normal';
      category = 'informational';
      tier = 'deterministic_signal';
      reason = signals.find((s) => INFORMATIONAL_SIGNALS.includes(s)) ?? 'informational';
    }
  }
  if (has('interest_match') && tier !== 'explicit_rule' && tier !== 'learned_preference') {
    urgency = atLeast(urgency, 'today');
  }

  // 4. AI classification
  if (importance === null) {
    if (ai) {
      const norm = normalizeAiCategory(ai.category);
      const conf = clampAiConfidence(ai.confidence);
      let cat = norm.category;
      reason =
        ai.reasonCode && /^[a-z_]{3,48}$/.test(ai.reasonCode) ? ai.reasonCode : 'ai_classification';
      if (cat === 'important' && conf < AI_IMPORTANT_MIN_CONFIDENCE) {
        cat = 'informational';
        reason = 'ai_low_confidence';
      }
      if (cat === 'awaiting_my_reply' && has('auto_submitted')) cat = 'informational';
      category = cat;
      importance =
        cat === 'important' || cat === 'awaiting_my_reply' || cat === 'has_deadline'
          ? 'high'
          : cat === 'low_priority'
            ? 'low'
            : 'normal';
      tier = 'ai_classification';
      confidence = conf;
      urgency = ai.urgency ?? urgency;
      if (norm.normalization === 'fallback') reason = 'ai_label_fallback';
    } else {
      importance = 'normal';
      category = has('awaiting_my_reply') ? 'awaiting_my_reply' : 'informational';
      tier = 'deterministic_signal';
      reason = has('awaiting_my_reply') ? 'awaiting_my_reply' : 'pending_ai';
      confidence = 0.5;
      aiNeeded = true;
    }
  }

  // floors from soft signals (never lower a higher-tier decision)
  if (has('awaiting_my_reply') && importance !== 'muted' && importance !== 'low') {
    if (category === 'informational') category = 'awaiting_my_reply';
  }
  if (vip && importance !== 'muted') urgency = atLeast(urgency, 'today');
  if (deadlineSoon && importance !== 'muted') urgency = atLeast(urgency, 'today');

  const finalImportance: Importance = importance;
  const finalCategory = category ?? categoryForImportance(finalImportance);
  const finalNotify: NotifyLevel =
    notifyLevel ?? (finalImportance === 'muted' ? 'never' : 'default');

  return {
    category: finalCategory,
    importance: finalImportance,
    urgency,
    notify: finalNotify !== 'never',
    notify_level: finalNotify,
    decision_tier: tier ?? 'deterministic_signal',
    reason_code: reason,
    rule_id: ruleId,
    notify_rule_id: notifyRule?.id ?? null,
    learned_preference_id: learnedId,
    confidence,
    ai_needed: aiNeeded,
    realtime,
    signals,
  };
}
