/**
 * Confidence calibration (AI_PIPELINE_PLAN §6.7). Until enough labels exist per (feature, field)
 * the hand-set prior `prior-2026-09` applies; a learned isotonic calibration replaces it through
 * `ai_calibration_versions` without code changes (the version id travels with the value).
 */

export const PRIOR_CALIBRATION_VERSION = 'prior-2026-09';

export type MatchKind = 'exact' | 'fuzzy' | 'none';
export type ModelConfidence = 'high' | 'medium' | 'low';
export type SenderType = 'vip' | 'known' | 'bulk' | 'unknown';

export interface CalibrationFeatures {
  readonly match: MatchKind;
  /** The deterministic re-parse of the quote agrees with the claim. */
  readonly parseAgrees: boolean;
  readonly precision?: 'datetime' | 'day' | 'week' | 'month' | null;
  readonly ambiguous?: boolean;
  readonly certainty?: 'explicit' | 'hedged';
  readonly modelConfidence?: ModelConfidence | null;
  readonly senderType?: SenderType;
  /** "en geç", "kesin", "son gün" near the claim. */
  readonly explicitMarker?: boolean;
}

/** Wording thresholds (UT-GRD-14). */
export const ASSERTIVE_MIN = 0.85;
export const PROBABLY_MIN = 0.7;
/** Below this an actionable item becomes a confirmation/proposal instead of a silent create. */
export const ACTIONABLE_MIN = 0.7;
/** Commitments below this are proposed as `commitment_create` approvals (DB `commitments` note). */
export const COMMITMENT_DIRECT_CREATE_MIN = 0.8;

const round3 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;

/** The prior calibration: start 0.90, adjust per feature, apply caps. */
export function calibrateConfidence(f: CalibrationFeatures): number {
  if (f.match === 'none') return 0;
  let c = 0.9;
  if (f.match === 'fuzzy') c -= 0.1;
  if (!f.parseAgrees) c -= 0.2;
  if (f.precision === 'week') c -= 0.05;
  if (f.precision === 'month') c -= 0.1;
  if (f.modelConfidence === 'low') c -= 0.15;
  if (f.senderType === 'bulk') c -= 0.1;
  if (f.senderType === 'vip' || f.senderType === 'known') c += 0.05;
  if (f.explicitMarker) c += 0.03;
  if (f.ambiguous) c = Math.min(c, 0.7);
  if (f.certainty === 'hedged') c = Math.min(c, 0.65);
  return round3(Math.min(c, 0.99));
}

export type ConfidenceWording = 'assertive' | 'probably' | 'uncertain';

/** ≥0.85 assertive; 0.70–0.85 "muhtemelen"; <0.70 "Emin değilim" / "Kaynakta kesinleşmiyor". */
export function confidenceWording(confidence: number): ConfidenceWording {
  if (confidence >= ASSERTIVE_MIN) return 'assertive';
  if (confidence >= PROBABLY_MIN) return 'probably';
  return 'uncertain';
}

/** i18n key of the wording (`explain.confidence.*`). */
export function confidenceWordingKey(confidence: number): string {
  return `explain.confidence.${confidenceWording(confidence)}`;
}

/** Whether an actionable item may be created without confirmation. */
export function isActionable(confidence: number): boolean {
  return confidence >= ACTIONABLE_MIN;
}
