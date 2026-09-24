/**
 * Person statistics (IMPLEMENTATION_PLAN T-5.06): `last_contact_at`, `last_inbound_at`,
 * `last_outbound_at`, `message_count_30d` and `meeting_count_30d` are recomputed in SQL
 * (`refresh_contact_stats`) from the synced rows; recent topics are the `topic_label`s the triage
 * writes on threads (cleaned subjects). These columns feed the `person_intelligence` and
 * `vip_suggestions` RPCs.
 */
import type { MailStore } from '../intel/store.ts';

/** Contact ids touched by a run (deduplicated, stable order). */
export function touchedContacts(byEmail: Readonly<Record<string, string>>): string[] {
  return [...new Set(Object.values(byEmail))].sort();
}

/** Refreshes the stats of the touched contacts (all of the user's when `null`). */
export async function refreshPersonStats(
  store: Pick<MailStore, 'refreshContactStats'>,
  userId: string,
  byEmail: Readonly<Record<string, string>> | null,
): Promise<number> {
  const ids = byEmail === null ? null : touchedContacts(byEmail);
  if (ids !== null && ids.length === 0) return 0;
  await store.refreshContactStats(userId, ids);
  return ids?.length ?? -1;
}
