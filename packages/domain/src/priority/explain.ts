/**
 * "Neden önemli?" explanations (AI_PIPELINE_PLAN §7.7) as i18n message references under the
 * `explain` namespace. The WhySheet renders them with the user's catalog; this module never
 * produces copy itself.
 */
import type { DecisionTier } from '../enums.ts';
import { type MessageRef, messageRef } from '../entities/message.ts';
import type { PriorityResult } from './engine.ts';

export type ConfidenceLabel = 'high' | 'medium' | 'low';

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
  /** Tier heading key (`explain.tier.<tier>`). */
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

/** `explain(result)` → i18n keys + ICU params for the WhySheet. */
export function explain(result: PriorityResult, ctx: ExplainContext = {}): Explanation {
  const tier = result.decision_tier;
  const heading = messageRef(`explain.tier.${tier}`);
  let reason: MessageRef;
  const details: MessageRef[] = [];

  switch (tier) {
    case 'explicit_rule':
      reason =
        result.reason_code === 'vip'
          ? messageRef('explain.reason.vip', { name: ctx.personName ?? '' })
          : messageRef('explain.reason.rule', {
              rule: ctx.ruleTitle ?? '',
              outcome: result.reason_code.replace(/^rule_[a-z]+_/, '').replace(/^app_/, ''),
            });
      break;
    case 'learned_preference':
      reason = messageRef('explain.reason.learned', {
        statement: ctx.learnedStatement ?? '',
        evidence: ctx.learnedEvidence ?? '',
      });
      break;
    case 'deterministic_signal':
      reason = messageRef(`explain.signal.${result.reason_code}`, {
        time: ctx.dueTime ?? '',
      });
      break;
    case 'ai_classification': {
      const band = confidenceLabel(result.confidence);
      reason = messageRef('explain.reason.ai', {
        reason: result.reason_code,
        confidence: band,
      });
      if (band !== 'high') details.push(messageRef(`explain.confidence.${band}`));
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
