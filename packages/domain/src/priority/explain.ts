/**
 * "Neden önemli?" explanations (AI_PIPELINE_PLAN §7.7) as i18n message references: the tier
 * heading (`explain.tiers.*`), the reason line (the `flow.generated.why.*` sentences the Edge
 * Functions render into `insights.reason`) and the detail lines (`explain.confidenceBand.*`,
 * `explain.notify.*`). The WhySheet renders them with the user's catalog; this module never
 * produces copy itself.
 */
import type { DecisionTier } from '../enums.ts';
import { type MessageRef, messageRef } from '../entities/message.ts';
import type { PriorityResult } from './engine.ts';
import { DETERMINISTIC_REASON_CODES } from './signals.ts';

export const CONFIDENCE_LABEL_VALUES = ['high', 'medium', 'low'] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABEL_VALUES)[number];

/** Wording band of a calibrated confidence (§6.7): ≥0.85 assertive, 0.70–0.85 "muhtemelen". */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}

export interface ExplainContext {
  /** Display title of the rule ("@yilmazendustri.com adresinden gelenler"). */
  readonly ruleTitle?: string;
  /** VIP person display name. */
  readonly personName?: string;
  /** Learned preference statement + evidence line (already user-facing text from the DB row). */
  readonly learnedStatement?: string;
  readonly learnedEvidence?: string;
  /** Localised due time for deadline signals ("17:00"). */
  readonly dueTime?: string;
}

export interface Explanation {
  readonly tier: DecisionTier;
  /** Tier heading key (`explain.tiers.<tier>`). */
  readonly heading: MessageRef;
  /** Main reason line. */
  readonly reason: MessageRef;
  /** Extra lines (confidence band, notify rule). */
  readonly details: readonly MessageRef[];
  /** The correction actions offered by the sheet (fixed order, §7.7). */
  readonly corrections: readonly (
    'not_important' | 'show_more' | 'make_vip' | 'stop_tracking' | 'create_rule'
  )[];
}

/** Catalog key of a deterministic reason code (`other` for a code without its own sentence). */
function signalKey(code: string): string {
  return (DETERMINISTIC_REASON_CODES as readonly string[]).includes(code) ? code : 'other';
}

/** `explain(result)` → i18n keys + ICU params for the WhySheet. */
export function explain(result: PriorityResult, ctx: ExplainContext = {}): Explanation {
  const tier = result.decision_tier;
  const heading = messageRef(`explain.tiers.${tier}`);
  let reason: MessageRef;
  const details: MessageRef[] = [];

  switch (tier) {
    case 'explicit_rule':
      reason =
        result.reason_code === 'vip'
          ? messageRef('flow.generated.why.vip', { name: ctx.personName ?? '' })
          : messageRef('flow.generated.why.rule', {
              rule: ctx.ruleTitle ?? '',
              outcome: result.reason_code.replace(/^rule_[a-z]+_/, '').replace(/^app_/, ''),
            });
      break;
    case 'learned_preference':
      reason = messageRef('flow.generated.why.learned', {
        statement: ctx.learnedStatement ?? '',
        evidence: ctx.learnedEvidence ?? '',
      });
      break;
    case 'deterministic_signal':
      reason = messageRef(`flow.generated.why.signal.${signalKey(result.reason_code)}`, {
        time: ctx.dueTime ?? '',
      });
      break;
    case 'ai_classification': {
      const band = confidenceLabel(result.confidence);
      reason = messageRef('flow.generated.why.ai', {
        reason: result.reason_code,
        confidence: band,
      });
      if (band !== 'high') details.push(messageRef(`explain.confidenceBand.${band}`));
      break;
    }
  }
  if (result.notify_rule_id !== null) {
    details.push(
      messageRef(
        result.notify_level === 'never' ? 'explain.notify.muted' : 'explain.notify.always',
      ),
    );
  }
  return {
    tier,
    heading,
    reason,
    details,
    corrections: ['not_important', 'show_more', 'make_vip', 'stop_tracking', 'create_rule'],
  };
}
