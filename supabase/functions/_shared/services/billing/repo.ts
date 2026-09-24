/**
 * Database side of the RevenueCat mirror (migration 20260924002200): the webhook ledger insert and
 * the sync steps, all through service-role `public.*` wrappers of `private.*` functions. The client
 * is injected (the service client in `worker`, `webhooks-revenuecat` and `api/repos/system`).
 */
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { toByteaHex } from '../../crypto/encoding.ts';
import { mapDbError } from '../../errors.ts';
import { enqueueJob } from '../../jobs/client.ts';
import { supabaseAuditWriter } from '../audit.ts';
import type { ApplyMirrorResult, BillingRepo, BillingSyncContext } from './sync.ts';

export interface BillingEventRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly appUserId: string | null;
  readonly environment: string;
  readonly store: string | null;
  readonly productId: string | null;
  readonly eventTimestamp: string;
  readonly transferredFrom: readonly string[] | null;
  readonly transferredTo: readonly string[] | null;
  /** The webhook body with `subscriber_attributes` removed. */
  readonly payload: Record<string, unknown>;
  readonly payloadDigest: Uint8Array;
  /** App user ids to re-fetch (`billing_sync:{id}:{event_id}` each); empty for TEST / unknown types. */
  readonly syncIds: readonly string[];
  readonly correlationId: string | null;
}

export interface BillingLedger {
  record(event: BillingEventRecord): Promise<{ inserted: boolean; jobs: string[] }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID_RE.test(value) ? value : null;
}

export function supabaseBillingLedger(system: DbClient): BillingLedger {
  return {
    async record(event) {
      const result = await rpc<{ inserted?: boolean; jobs?: unknown[] }>(
        system,
        DB_FN.recordBillingEvent,
        {
          p_event_id: event.eventId,
          p_event_type: event.eventType,
          p_app_user_id: event.appUserId,
          p_environment: event.environment,
          p_store: event.store,
          p_product_id: event.productId,
          p_event_timestamp: event.eventTimestamp,
          p_transferred_from: event.transferredFrom,
          p_transferred_to: event.transferredTo,
          p_payload: event.payload,
          p_payload_digest: toByteaHex(event.payloadDigest),
          p_sync_ids: event.syncIds,
          p_correlation_id: uuidOrNull(event.correlationId),
        },
      );
      return {
        inserted: result?.inserted === true,
        jobs: (result?.jobs ?? []).filter((j): j is string => typeof j === 'string'),
      };
    },
  };
}

export function supabaseBillingRepo(system: DbClient): BillingRepo {
  const audit = supabaseAuditWriter(system);
  return {
    async context(appUserId, eventId) {
      const raw = await rpc<Partial<BillingSyncContext> | null>(system, DB_FN.billingSyncContext, {
        p_app_user_id: appUserId,
        p_event_id: eventId,
      });
      return {
        user_id: raw?.user_id ?? null,
        sandbox_allowed: raw?.sandbox_allowed === true,
        locale: raw?.locale ?? null,
        event: raw?.event ?? null,
        mirror: raw?.mirror ?? null,
      };
    },
    async markEvent(eventId, status) {
      await rpc<null>(system, DB_FN.billingMarkEvent, { p_event_id: eventId, p_status: status });
    },
    async applyMirror(userId, rcAppUserId, snapshot, eventId) {
      const raw = await rpc<Partial<ApplyMirrorResult> | null>(system, DB_FN.billingApplyMirror, {
        p_user: userId,
        p_rc_app_user_id: rcAppUserId,
        p_snapshot: snapshot,
        p_event_id: eventId,
      });
      return {
        skipped: raw?.skipped ?? null,
        previous: raw?.previous ?? null,
        current: raw?.current ?? null,
        event_type: raw?.event_type ?? null,
        effective_before: raw?.effective_before ?? null,
        effective_after: raw?.effective_after ?? null,
      };
    },
    enqueue: (input) => enqueueJob(system, input),
    async analytics(row) {
      const { error } = await system.from('analytics_events').insert({
        user_id: row.user_id,
        event_name: row.event_name,
        props: row.props,
        occurred_at: row.occurred_at,
      });
      if (error !== null) throw mapDbError(error);
    },
    audit: (entry) => audit.append(entry),
  };
}
