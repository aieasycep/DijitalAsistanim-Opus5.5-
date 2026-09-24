/**
 * Webhook ingest ledger (API_CONTRACTS §10 common rules; DATABASE_AND_RLS_PLAN §4.2 `webhook_events`).
 * One row per provider delivery, unique by `(source, external_id)`: a duplicate delivery is a no-op.
 * The payload is minimal and content-free (ids, history id, change type), with a SHA-256 digest of the
 * raw body. Status: `received` → `enqueued` (provider_webhook job) | `ignored` (unmatched / stale
 * account) | `rejected` (authentication failed).
 */
import type { DbClient } from '../db/clients.ts';
import { toByteaHex } from '../crypto/encoding.ts';
import { mapDbError } from '../errors.ts';

export type WebhookSource =
  'google_gmail' | 'google_calendar' | 'microsoft_graph' | 'microsoft_lifecycle';
export type WebhookStatus = 'received' | 'enqueued' | 'ignored' | 'rejected' | 'failed';

export interface WebhookEventInsert {
  readonly source: WebhookSource;
  readonly externalId: string;
  readonly userId: string | null;
  readonly accountId: string | null;
  readonly signatureValid: boolean;
  readonly status: WebhookStatus;
  readonly payloadDigest: Uint8Array;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface WebhookLedger {
  /** Inserts the delivery; `duplicate` when `(source, external_id)` was already recorded. */
  record(event: WebhookEventInsert): Promise<{ id: string; duplicate: boolean }>;
  mark(id: string, status: WebhookStatus, jobId: string | null): Promise<void>;
}

export function supabaseWebhookLedger(db: DbClient): WebhookLedger {
  return {
    async record(event) {
      const { data, error } = await db
        .from('webhook_events')
        .insert({
          source: event.source,
          external_id: event.externalId.slice(0, 300),
          user_id: event.userId,
          connected_account_id: event.accountId,
          signature_valid: event.signatureValid,
          status: event.status,
          payload_digest: toByteaHex(event.payloadDigest),
          payload: event.payload,
        })
        .select('id')
        .single();
      if (error !== null) {
        if (error.code === '23505') {
          const existing = await db
            .from('webhook_events')
            .select('id')
            .eq('source', event.source)
            .eq('external_id', event.externalId.slice(0, 300))
            .maybeSingle();
          if (existing.error !== null) throw mapDbError(existing.error);
          return {
            id: String((existing.data as { id: number | string } | null)?.id ?? ''),
            duplicate: true,
          };
        }
        throw mapDbError(error);
      }
      return { id: String((data as { id: number | string }).id), duplicate: false };
    },
    async mark(id, status, jobId) {
      const { error } = await db
        .from('webhook_events')
        .update({ status, job_id: jobId })
        .eq('id', Number(id));
      if (error !== null) throw mapDbError(error);
    },
  };
}

/** In-memory ledger with the table's uniqueness (tests). */
export function memoryWebhookLedger(): WebhookLedger & {
  rows: (WebhookEventInsert & { id: string; jobId: string | null })[];
} {
  const rows: (WebhookEventInsert & { id: string; jobId: string | null })[] = [];
  return {
    rows,
    record(event) {
      const existing = rows.find(
        (r) => r.source === event.source && r.externalId === event.externalId,
      );
      if (existing !== undefined) return Promise.resolve({ id: existing.id, duplicate: true });
      const id = String(rows.length + 1);
      rows.push({ ...event, id, jobId: null });
      return Promise.resolve({ id, duplicate: false });
    },
    mark(id, status, jobId) {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined) {
        (row as { status: WebhookStatus }).status = status;
        row.jobId = jobId;
      }
      return Promise.resolve();
    },
  };
}
