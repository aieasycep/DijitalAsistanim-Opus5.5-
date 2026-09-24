/**
 * "Neden önemli?" lines (AI_PIPELINE_PLAN §7.7) rendered to text for `insights.why_important` and
 * `email_messages.classification_reason` (both ≤300 chars) from the i18n catalogs. The tier, rule
 * and reason code stay separate columns, so source, AI confidence and deterministic rules remain
 * separable (M§14).
 */
import type { PriorityResult, PriorityRule } from '@da/domain';
import { clip, copy, type CopyLocale } from '../copy.ts';

export interface WhyContext {
  readonly locale: CopyLocale;
  readonly rule?: PriorityRule | null;
  readonly vipName?: string | null;
  readonly learnedStatement?: string | null;
  /** Model reason (`reason_tr`, already cleaned) for the AI tier. */
  readonly aiReason?: string | null;
  readonly dueTime?: string | null;
}

function ruleLabel(rule: PriorityRule): string {
  const v = rule.condition_value as Readonly<Record<string, unknown>>;
  const value =
    typeof v.domain === 'string'
      ? `@${v.domain.replace(/^@/, '')}`
      : typeof v.address === 'string'
        ? v.address
        : Array.isArray(v.keywords)
          ? v.keywords.filter((k) => typeof k === 'string').join(', ')
          : typeof v.category === 'string'
            ? v.category
            : typeof v.package === 'string'
              ? v.package
              : '';
  return clip(value, 80);
}

const SIGNAL_KEYS = new Set([
  'security_verified',
  'deadline_today',
  'deadline_tomorrow',
  'list_unsubscribe',
  'precedence_bulk',
  'auto_submitted',
  'category_promotions',
  'category_social',
  'category_forums',
  'category_updates',
  'esp_bulk',
  'noreply_sender',
  'cc_only_unknown',
  'transactional',
  'security_unverified',
  'awaiting_my_reply',
]);

/** Text of the decisive reason of a priority result. */
export function whyText(result: PriorityResult, ctx: WhyContext): string {
  const l = ctx.locale;
  switch (result.decision_tier) {
    case 'explicit_rule':
      if (result.reason_code === 'vip') {
        return clip(copy(l, 'flow.generated.why.vip', { name: ctx.vipName ?? '' }), 300);
      }
      return clip(
        copy(l, 'flow.generated.why.rule', {
          rule: ctx.rule ? ruleLabel(ctx.rule) : '',
          outcome: ctx.rule?.outcome ?? 'high',
        }),
        300,
      );
    case 'learned_preference':
      return clip(
        copy(l, 'flow.generated.why.learned', { statement: ctx.learnedStatement ?? '' }),
        300,
      );
    case 'deterministic_signal': {
      const code = SIGNAL_KEYS.has(result.reason_code) ? result.reason_code : 'other';
      return clip(copy(l, `flow.generated.why.signal.${code}`, { time: ctx.dueTime ?? '' }), 300);
    }
    case 'ai_classification': {
      const band = result.confidence >= 0.85 ? 'high' : result.confidence >= 0.7 ? 'medium' : 'low';
      return clip(
        copy(l, 'flow.generated.why.ai', {
          reason: ctx.aiReason ?? copy(l, 'flow.generated.why.aiDefault'),
          confidence: band,
        }),
        300,
      );
    }
  }
}

/** Plain reason lines per insight kind (no priority decision behind them). */
export function kindWhy(
  locale: CopyLocale,
  key:
    | 'follow_up'
    | 'commitment_user'
    | 'commitment_they'
    | 'conflict'
    | 'back_to_back'
    | 'meeting_prep'
    | 'schedule_request'
    | 'schedule_suggestion'
    | 'life'
    | 'security'
    | 'approval'
    | 'task_due'
    | 'deadline',
  params: Readonly<Record<string, string | number>> = {},
): string {
  return clip(copy(locale, `flow.generated.why.kind.${key}`, params), 300);
}
