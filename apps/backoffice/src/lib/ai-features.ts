/*
 * AI feature → M§57 model role (BACKOFFICE_PLAN §6.10; master plan R-18): each `ai_feature` belongs
 * to exactly one role. `GET /ai/models` rows carry the `role` column itself; `roleOf` is the same
 * mapping the model-config seed uses, for places that only know the feature.
 */

export type AiRole = 'classifier' | 'reasoning' | 'embedding' | 'stt' | 'tts';

export const AI_ROLES: readonly AiRole[] = ['classifier', 'reasoning', 'embedding', 'stt', 'tts'];

/**
 * The model slots to show (§6.10 "Model yuvaları"): the M§57 concepts in their order plus any other
 * `ai_model_config.role` present in the rows (the DB also has `assistant` and `probe` rows).
 */
export const EXTRA_ROLES = ['assistant', 'probe'] as const;
export type SlotRole = AiRole | (typeof EXTRA_ROLES)[number];

export function slotRoles(rows: readonly { role: SlotRole }[]): SlotRole[] {
  const present = new Set<SlotRole>(rows.map((row) => row.role));
  return [...AI_ROLES, ...EXTRA_ROLES.filter((role) => present.has(role))];
}

export function roleOf(feature: string): AiRole {
  if (feature === 'email_triage') return 'classifier';
  if (feature === 'embedding_doc' || feature === 'embedding_query') return 'embedding';
  if (feature === 'stt') return 'stt';
  if (feature === 'tts') return 'tts';
  return 'reasoning';
}

/** The most used primary model among rows, and the rows that differ from it (the exceptions). */
export function slotSummary<T extends { primary_target: { provider: string; model: string } }>(
  rows: readonly T[],
): { model: string | null; exceptions: T[] } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.primary_target.provider}/${row.primary_target.model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (top === undefined) return { model: null, exceptions: [] };
  return {
    model: top[0],
    exceptions: rows.filter(
      (row) => `${row.primary_target.provider}/${row.primary_target.model}` !== top[0],
    ),
  };
}

/** `retires_not_before` within 30 days → the "Emeklilik tarihi yaklaşıyor" warning (§6.10). */
export function retiresSoon(retiresNotBefore: string | null, now: number): boolean {
  if (retiresNotBefore === null) return false;
  const at = Date.parse(retiresNotBefore);
  return at - now <= 30 * 86_400_000;
}
