/**
 * Shared helpers of the AI pipeline part 2 (T-5.09…T-5.15): interactive error mapping of a T0
 * outcome, language detection for drafts, content keys and provenance references.
 */
import type { Provider, SourceType } from '@da/domain';
import { routeForSource } from '@da/domain';
import type { T0Reason } from '../../ai/types.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import { AppError } from '../../errors.ts';

/**
 * Maps a model call that fell back to T0 onto the interactive error of API_CONTRACTS §2.6:
 * exhausted budget → `QUOTA_EXCEEDED`; kill switch / feature flag → `FEATURE_DISABLED`; no
 * configured route or credential → `EXTERNAL_CREDENTIAL_REQUIRED`; an invalid output →
 * `AI_OUTPUT_INVALID`; everything else → `AI_UNAVAILABLE`.
 */
export function interactiveAiError(reason: T0Reason | 'refine_failed' | string): AppError {
  switch (reason) {
    case 'ai_budget_exhausted':
      return new AppError('QUOTA_EXCEEDED', {
        details: { limit_key: 'ai_daily_budget_units', upgrade_available: true },
      });
    case 'kill_switch':
    case 'feature_disabled':
      return new AppError('FEATURE_DISABLED', { details: { reason } });
    case 'not_configured':
    case 'no_target':
      return new AppError('EXTERNAL_CREDENTIAL_REQUIRED', { details: { reason } });
    case 'refine_failed':
      return new AppError('AI_OUTPUT_INVALID');
    default:
      return new AppError('AI_UNAVAILABLE', { details: { reason } });
  }
}

const TR_MARKERS =
  /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|merhaba|teşekkür|rica|lütfen|selam|iyi günler)\b/giu;
const EN_MARKERS = /\b(the|and|please|thanks|thank you|regards|hello|dear|could|would)\b/gi;

/** Thread language: Turkish unless the text is clearly English (then the user's locale decides ties). */
export function detectLanguage(text: string, fallback: 'tr' | 'en'): 'tr' | 'en' {
  const tr = (text.match(TR_MARKERS) ?? []).length;
  const en = (text.match(EN_MARKERS) ?? []).length;
  if (tr === 0 && en === 0) return fallback;
  return en > tr ? 'en' : 'tr';
}

/** Stable content key (sha256 hex) of the parts. */
export function contentKey(
  parts: readonly (string | number | null | undefined)[],
): Promise<string> {
  return sha256Hex(
    parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u001f'),
  );
}

/** A `SourceRef` for API views (`open_route` only for known targets). */
export function sourceRef(input: {
  readonly source_type: SourceType;
  readonly source_id: string | null;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly label?: string;
}): {
  source_type: SourceType;
  source_id: string | null;
  source_provider: Provider | 'in_app';
  source_timestamp: string;
  label?: string;
  open_route?: string;
} {
  const route =
    input.source_id === null ? null : routeForSource(input.source_type, input.source_id);
  return {
    source_type: input.source_type,
    source_id: input.source_id,
    source_provider: input.source_provider ?? 'in_app',
    source_timestamp: new Date(input.source_timestamp).toISOString(),
    ...(input.label === undefined ? {} : { label: input.label.slice(0, 120) }),
    ...(route === null ? {} : { open_route: route }),
  };
}

/** `poll_after_ms` of the job-backed routes (API_CONTRACTS §2.13). */
export const POLL_AFTER_MS = 2_000;
