import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { clientEnv } from '../../env/client.ts';
import { serverEnv } from '../../env/server.ts';
import { PUBLIC_API_PATH } from '../site.ts';
import {
  PublicPlansSchema,
  ReferralResolveSchema,
  successOf,
  type PublicPlans,
  type ReferralResolve,
} from './schemas.ts';

/**
 * Server-side reads of `public-api` (PUB-05 plans, PUB-04 referral resolve). Server fetches use
 * `API_PUBLIC_BASE_URL` (falling back to the browser base) and never send credentials.
 */

const TIMEOUT_MS = 4000;

function serverBaseUrl(): string | null {
  const base = serverEnv().API_PUBLIC_BASE_URL ?? clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  return base === undefined ? null : `${base}${PUBLIC_API_PATH}`;
}

async function getJson(path: string): Promise<unknown> {
  const base = serverBaseUrl();
  if (base === null) return null;
  const response = await fetch(`${base}${path}`, {
    headers: { accept: 'application/json', 'x-client-info': 'da-web-server' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`public-api ${path} answered ${String(response.status)}`);
  return (await response.json()) as unknown;
}

/**
 * Plan facts (PUB-05), cached for an hour (`cacheTag('plans')`). A failure is cached for a
 * minute only and renders the honest "limited" wording. An indexable production build fails
 * instead of shipping pages without the real numbers (Part 5 W-HOME-01 error states).
 */
export async function getPlans(): Promise<PublicPlans | null> {
  'use cache';
  cacheTag('plans');
  try {
    const parsed = successOf(PublicPlansSchema).safeParse(await getJson('/plans'));
    if (!parsed.success) throw new Error('public-api /plans returned an unexpected shape');
    cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });
    return parsed.data.data;
  } catch (error) {
    const env = serverEnv();
    if (env.indexable && process.env.NEXT_PHASE === 'phase-production-build') {
      throw new Error('plans fetch failed', { cause: error });
    }
    cacheLife({ stale: 30, revalidate: 60, expire: 300 });
    return null;
  }
}

export interface PlansSnapshot {
  readonly plans: PublicPlans | null;
  /** When this snapshot was taken: "now" for the 90-day price-freshness rule. */
  readonly checkedAt: string;
}

/**
 * Plans plus the time they were read, in one cache entry, so prerendered pages judge price
 * freshness without reading the clock outside a cache scope (Cache Components).
 */
export async function getPlansSnapshot(): Promise<PlansSnapshot> {
  'use cache';
  cacheTag('plans');
  const plans = await getPlans();
  return { plans, checkedAt: new Date().toISOString() };
}

export type ReferralLookup =
  { readonly kind: 'resolved'; readonly value: ReferralResolve } | { readonly kind: 'unavailable' };

/** Referral link resolve (PUB-04), cached 300 s per code. Never returns referrer identity. */
export async function resolveReferral(code: string): Promise<ReferralLookup> {
  'use cache';
  cacheTag(`ref:${code}`);
  try {
    const parsed = successOf(ReferralResolveSchema).safeParse(
      await getJson(`/referrals/${encodeURIComponent(code)}`),
    );
    if (!parsed.success) throw new Error('unexpected referral response');
    cacheLife({ stale: 60, revalidate: 300, expire: 900 });
    return { kind: 'resolved', value: parsed.data.data };
  } catch {
    cacheLife({ stale: 10, revalidate: 30, expire: 60 });
    return { kind: 'unavailable' };
  }
}
