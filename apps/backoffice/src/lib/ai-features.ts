/*
 * AI feature → M§57 model role (BACKOFFICE_PLAN §6.10; master plan R-18): each `ai_feature` belongs
 * to exactly one role. The registry's `ModelConfigRow` carries no `role` column, so the backoffice
 * derives it with the same mapping the model-config seed uses.
 */

export type AiRole = 'classifier' | 'reasoning' | 'embedding' | 'stt' | 'tts';

export const AI_ROLES: readonly AiRole[] = ['classifier', 'reasoning', 'embedding', 'stt', 'tts'];

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
