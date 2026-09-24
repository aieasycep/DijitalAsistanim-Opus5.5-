/**
 * Database reads and writes of the `health` function (service client; system tables only, no user
 * content): `system_health_checks`, `jobs`, `job_attempts`, `webhook_events`, `ai_requests`,
 * `connected_accounts` status counts, `ai_model_config`, and `private.audit_verify_chain`.
 */
import type { DbClient } from '../_shared/db/clients.ts';
import { DB_FN, rpc } from '../_shared/db/functions.ts';
import { mapDbError } from '../_shared/errors.ts';
import type { HealthData, HealthStatus } from './probes/types.ts';

async function countRows(
  query: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error !== null) throw mapDbError(error);
  return count ?? 0;
}

export function supabaseHealthData(system: DbClient): HealthData {
  return {
    async pingDatabase() {
      const { error } = await system
        .from('system_health_checks')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (error !== null) throw mapDbError(error);
    },
    async listStorage(bucket) {
      const { error } = await system.storage.from(bucket).list('', { limit: 1 });
      if (error !== null) throw new Error('storage_list_failed');
    },
    async cronStats(now) {
      const [attempt, ready, cron] = await Promise.all([
        system
          .from('job_attempts')
          .select('finished_at')
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        system
          .from('jobs')
          .select('run_after')
          .in('status', ['queued', 'retrying'])
          .lte('run_after', now.toISOString())
          .order('run_after', { ascending: true })
          .limit(1)
          .maybeSingle(),
        system
          .from('jobs')
          .select('created_at')
          .in('type', ['health_check', 'push_receipts'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      for (const r of [attempt, ready, cron]) if (r.error !== null) throw mapDbError(r.error);
      return {
        lastAttemptFinishedAt:
          (attempt.data as { finished_at: string } | null)?.finished_at ?? null,
        oldestReadyJobAt: (ready.data as { run_after: string } | null)?.run_after ?? null,
        lastCronEnqueueAt: (cron.data as { created_at: string } | null)?.created_at ?? null,
      };
    },
    async webhookStats(source, since) {
      const base = () =>
        system
          .from('webhook_events')
          .select('id', { count: 'exact', head: true })
          .eq('source', source);
      const [total, rejected, backlog, last] = await Promise.all([
        countRows(base().gte('received_at', since.toISOString())),
        countRows(base().gte('received_at', since.toISOString()).eq('signature_valid', false)),
        countRows(
          base()
            .eq('status', 'received')
            .lt('received_at', new Date(Date.now() - 10 * 60_000).toISOString()),
        ),
        system
          .from('webhook_events')
          .select('received_at')
          .eq('source', source)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (last.error !== null) throw mapDbError(last.error);
      return {
        total,
        rejected,
        backlog,
        lastReceivedAt: (last.data as { received_at: string } | null)?.received_at ?? null,
      };
    },
    async aiErrorRate(provider, since) {
      const base = () =>
        system
          .from('ai_requests')
          .select('id', { count: 'exact', head: true })
          .eq('provider', provider)
          .gte('created_at', since.toISOString());
      const [total, errors] = await Promise.all([
        countRows(base()),
        countRows(base().in('status', ['error', 'timeout'])),
      ]);
      return { total, errors };
    },
    async accountHealth(provider) {
      const base = () =>
        system
          .from('connected_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('provider', provider)
          .neq('status', 'disconnected');
      const [total, failing] = await Promise.all([
        countRows(base()),
        countRows(base().in('status', ['error', 'needs_reauth', 'admin_consent_required'])),
      ]);
      return { total, failing };
    },
    async embeddingQueryModel() {
      const { data, error } = await system
        .from('ai_model_config')
        .select('model')
        .eq('profile', 'balanced')
        .eq('feature', 'embedding_query')
        .eq('enabled', true)
        .limit(1)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as { model: string } | null)?.model ?? null;
    },
    async auditChain(window) {
      const { data, error } = await system
        .from('audit_logs')
        .select('chain_seq')
        .order('chain_seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      const last = (data as { chain_seq: number } | null)?.chain_seq ?? 0;
      if (last === 0) return { ok: true, checked: 0, firstBadSeq: null };
      const rows = await rpc<
        { ok: boolean; checked: number; first_bad_seq: number | null }[] | null
      >(system, DB_FN.auditVerifyChain, {
        p_from: Math.max(1, last - window + 1),
        p_to: last,
      });
      const row = rows?.[0];
      return {
        ok: row?.ok === true,
        checked: row?.checked ?? 0,
        firstBadSeq: row?.first_bad_seq ?? null,
      };
    },
  };
}

export interface HealthRow {
  readonly component: string;
  readonly status: HealthStatus;
  readonly latency_ms: number | null;
  readonly detail: Record<string, unknown>;
  readonly checked_by: 'cron' | 'admin';
  readonly checked_at: string;
}

export interface HealthWriter {
  insert(rows: readonly HealthRow[]): Promise<void>;
}

export function supabaseHealthWriter(system: DbClient): HealthWriter {
  return {
    async insert(rows) {
      if (rows.length === 0) return;
      const { error } = await system.from('system_health_checks').insert([...rows]);
      if (error !== null) throw mapDbError(error);
    },
  };
}
