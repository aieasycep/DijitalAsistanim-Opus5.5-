/**
 * Nightly AI cost reconciliation (IMPLEMENTATION_PLAN T-5.17; AI_PIPELINE_PLAN §8.12; JOB-08 with
 * `payload.scope='ai_cost'`). Our recorded spend per provider for one UTC day (`ai_requests`,
 * through `ai_cost_by_model`) is compared with the provider bills:
 * - Anthropic Admin API `GET /v1/organizations/cost_report` (amounts are USD cents as decimal
 *   strings), `ANTHROPIC_ADMIN_API_KEY`;
 * - OpenAI `GET /v1/organization/costs` (amounts in USD), `OPENAI_ADMIN_API_KEY`.
 * Drift above 5 % → `system_health_checks` `degraded` (check `ai_cost_reconciliation`) and an
 * `ai_ops` audit alert. A missing admin key is recorded as `external_credential_required`, never as
 * a green status.
 */
import { credentialStatus, type RawEnv } from '../../env.ts';

export const DRIFT_THRESHOLD = 0.05;
const ANTHROPIC_COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const OPENAI_COST_URL = 'https://api.openai.com/v1/organization/costs';

export type BilledProvider = 'anthropic' | 'openai';

export interface ProviderBill {
  readonly provider: BilledProvider;
  readonly status: 'ok' | 'credential_missing' | 'error';
  readonly usdMicros: number | null;
  readonly error?: string;
}

export interface OurCost {
  readonly provider: string;
  readonly model: string;
  readonly cost_usd_micros: number;
  readonly requests: number;
}

export interface ReconciliationRow {
  readonly component: 'ai_anthropic' | 'ai_openai';
  readonly status: 'healthy' | 'degraded' | 'external_credential_required' | 'unknown';
  readonly detail: Record<string, string | number | boolean | null>;
}

function dayBounds(utcDate: string): { start: Date; end: Date } {
  const start = new Date(`${utcDate}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Decimal string → µ$ given the unit (`cents` for Anthropic, `usd` for OpenAI). */
export function toMicros(value: string | number, unit: 'cents' | 'usd'): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(unit === 'cents' ? n * 10_000 : n * 1_000_000);
}

async function pagedJson(
  fetcher: typeof fetch,
  first: URL,
  headers: Record<string, string>,
  next: (body: Record<string, unknown>, url: URL) => URL | null,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const pages: Record<string, unknown>[] = [];
  let url: URL | null = first;
  for (let i = 0; url !== null && i < 20; i++) {
    const response: Response = await fetcher(url, {
      headers,
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`http_${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    pages.push(body);
    url = next(body, url);
  }
  return pages;
}

export async function anthropicBill(
  fetcher: typeof fetch,
  env: RawEnv,
  utcDate: string,
  signal?: AbortSignal,
): Promise<ProviderBill> {
  if (credentialStatus('anthropic_admin', env).status !== 'configured') {
    return { provider: 'anthropic', status: 'credential_missing', usdMicros: null };
  }
  const { start, end } = dayBounds(utcDate);
  const url = new URL(ANTHROPIC_COST_URL);
  url.searchParams.set('starting_at', start.toISOString());
  url.searchParams.set('ending_at', end.toISOString());
  url.searchParams.set('bucket_width', '1d');
  try {
    const pages = await pagedJson(
      fetcher,
      url,
      { 'x-api-key': env.ANTHROPIC_ADMIN_API_KEY!.trim(), 'anthropic-version': '2023-06-01' },
      (body, current) => {
        if (body.has_more !== true || typeof body.next_page !== 'string') return null;
        const u = new URL(current);
        u.searchParams.set('page', body.next_page);
        return u;
      },
      signal,
    );
    let micros = 0;
    for (const page of pages) {
      for (const bucket of (page.data as { results?: { amount?: string | number; currency?: string }[] }[]) ?? []) {
        for (const r of bucket.results ?? []) {
          if (r.amount !== undefined && (r.currency ?? 'USD').toUpperCase() === 'USD') {
            micros += toMicros(r.amount, 'cents');
          }
        }
      }
    }
    return { provider: 'anthropic', status: 'ok', usdMicros: micros };
  } catch (error) {
    return { provider: 'anthropic', status: 'error', usdMicros: null, error: error instanceof Error ? error.message : 'error' };
  }
}

export async function openaiBill(
  fetcher: typeof fetch,
  env: RawEnv,
  utcDate: string,
  signal?: AbortSignal,
): Promise<ProviderBill> {
  if (credentialStatus('openai_admin', env).status !== 'configured') {
    return { provider: 'openai', status: 'credential_missing', usdMicros: null };
  }
  const { start, end } = dayBounds(utcDate);
  const url = new URL(OPENAI_COST_URL);
  url.searchParams.set('start_time', String(Math.floor(start.getTime() / 1000)));
  url.searchParams.set('end_time', String(Math.floor(end.getTime() / 1000)));
  url.searchParams.set('bucket_width', '1d');
  try {
    const pages = await pagedJson(
      fetcher,
      url,
      { Authorization: `Bearer ${env.OPENAI_ADMIN_API_KEY!.trim()}` },
      (body, current) => {
        if (body.has_more !== true || typeof body.next_page !== 'string') return null;
        const u = new URL(current);
        u.searchParams.set('page', body.next_page);
        return u;
      },
      signal,
    );
    let micros = 0;
    for (const page of pages) {
      for (const bucket of (page.data as { results?: { amount?: { value?: number; currency?: string } }[] }[]) ?? []) {
        for (const r of bucket.results ?? []) {
          const value = r.amount?.value;
          if (typeof value === 'number' && (r.amount?.currency ?? 'usd').toLowerCase() === 'usd') {
            micros += toMicros(value, 'usd');
          }
        }
      }
    }
    return { provider: 'openai', status: 'ok', usdMicros: micros };
  } catch (error) {
    return { provider: 'openai', status: 'error', usdMicros: null, error: error instanceof Error ? error.message : 'error' };
  }
}

/** Relative drift of our figure against the bill (0 when both are zero). */
export function drift(ours: number, billed: number): number {
  if (billed === 0) return ours === 0 ? 0 : 1;
  return Math.abs(ours - billed) / billed;
}

/** One `system_health_checks` row per billed provider. */
export function reconciliationRows(
  utcDate: string,
  ours: readonly OurCost[],
  bills: readonly ProviderBill[],
): ReconciliationRow[] {
  return bills.map((bill) => {
    const component = bill.provider === 'anthropic' ? 'ai_anthropic' : 'ai_openai';
    const ourMicros = ours
      .filter((o) => o.provider === bill.provider)
      .reduce((n, o) => n + Number(o.cost_usd_micros), 0);
    const base = { check: 'ai_cost_reconciliation', utc_date: utcDate, ours_usd_micros: ourMicros };
    if (bill.status === 'credential_missing') {
      return {
        component,
        status: 'external_credential_required',
        detail: {
          ...base,
          credential_key: bill.provider === 'anthropic' ? 'ANTHROPIC_ADMIN_API_KEY' : 'OPENAI_ADMIN_API_KEY',
        },
      };
    }
    if (bill.status === 'error' || bill.usdMicros === null) {
      return { component, status: 'unknown', detail: { ...base, error: bill.error ?? 'error' } };
    }
    const d = drift(ourMicros, bill.usdMicros);
    return {
      component,
      status: d > DRIFT_THRESHOLD ? 'degraded' : 'healthy',
      detail: {
        ...base,
        provider_usd_micros: bill.usdMicros,
        drift_pct: Math.round(d * 10_000) / 100,
        threshold_pct: DRIFT_THRESHOLD * 100,
      },
    };
  });
}
