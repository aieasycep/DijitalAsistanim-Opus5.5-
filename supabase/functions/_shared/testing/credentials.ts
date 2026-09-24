/** In-memory `CredentialsRepo` (one user-level row per user and kind, like the partial unique index). */
import type { CredentialRecord, CredentialsRepo } from '../services/credentials.ts';

export function memoryCredentials(): CredentialsRepo & { rows: CredentialRecord[] } {
  const rows: CredentialRecord[] = [];
  return {
    rows,
    findUserCredential: (userId, kind) =>
      Promise.resolve(
        rows.find((r) => r.userId === userId && r.kind === kind && r.connectedAccountId === null) ??
          null,
      ),
    saveUserCredential(userId, provider, kind, token) {
      const index = rows.findIndex(
        (r) => r.userId === userId && r.kind === kind && r.connectedAccountId === null,
      );
      const record: CredentialRecord = {
        ...token,
        id: crypto.randomUUID(),
        userId,
        connectedAccountId: null,
        provider,
        kind,
      };
      if (index >= 0) rows[index] = record;
      else rows.push(record);
      return Promise.resolve();
    },
    listStale: (active, limit) =>
      Promise.resolve(rows.filter((r) => r.keyVersion < active).slice(0, limit)),
    swap(id, fromVersion, token) {
      const index = rows.findIndex((r) => r.id === id && r.keyVersion === fromVersion);
      const current = rows[index];
      if (current === undefined) return Promise.resolve(false);
      rows[index] = { ...current, ...token };
      return Promise.resolve(true);
    },
  };
}
