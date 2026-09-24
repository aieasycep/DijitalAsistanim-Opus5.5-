/**
 * RevenueCat REST API v2 client and mirror mapping (IMPLEMENTATION_PLAN T-7.01; API_CONTRACTS
 * JOB-24, API-BIZ-03; INTEGRATION_PLAN §10.4; ADR-11).
 *
 * The customer record is the truth: `GET /v2/projects/{pid}/customers/{id}` (its
 * `active_entitlements`) plus `/subscriptions`. Webhook events only trigger this re-fetch, so the
 * mirror can never be built from unordered events. The Pro entitlement is found by its lookup key
 * (`REVENUECAT_ENTITLEMENT_PRO_ID`, default `pro`) through `GET /v2/projects/{pid}/entitlements`;
 * a subscription's store product identifier comes from `GET /v2/projects/{pid}/products/{id}`
 * [verify v2 field names against the RevenueCat reference before launch].
 *
 * Errors are normalised (API_CONTRACTS §2.7): 401/403 → `EXTERNAL_CREDENTIAL_REQUIRED` (key missing
 * or without permission), 429 → `PROVIDER_RATE_LIMITED` with `Retry-After`, 5xx / network →
 * `PROVIDER_UNAVAILABLE`, timeout → `UPSTREAM_TIMEOUT`. External credential required:
 * `REVENUECAT_PROJECT_ID` and `REVENUECAT_API_V2_SECRET_KEY`.
 */
import type { SubscriptionStatus } from '@da/domain';
import { z } from 'zod';
import { OUTBOUND } from '../../config.ts';
import { credentialStatus } from '../../env.ts';
import { AppError } from '../../errors.ts';

export const REVENUECAT_API_BASE = 'https://api.revenuecat.com/v2';

export interface RevenueCatConfig {
  readonly projectId: string;
  readonly secretKey: string;
  /** Entitlement lookup key of Pro (`REVENUECAT_ENTITLEMENT_PRO_ID`). */
  readonly entitlementLookupKey: string;
}

/** The v2 configuration, or null while the credential is missing (names in `missing`). */
export function revenueCatConfig(env: Readonly<Record<string, unknown>>): RevenueCatConfig | null {
  if (credentialStatus('revenuecat', env).status !== 'configured') return null;
  const lookup = env.REVENUECAT_ENTITLEMENT_PRO_ID;
  return {
    projectId: String(env.REVENUECAT_PROJECT_ID).trim(),
    secretKey: String(env.REVENUECAT_API_V2_SECRET_KEY).trim(),
    entitlementLookupKey:
      typeof lookup === 'string' && lookup.trim() !== '' ? lookup.trim() : 'pro',
  };
}

export function missingRevenueCatCredential(): AppError {
  return new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
    details: {
      feature: 'purchases',
      credential_keys: ['REVENUECAT_PROJECT_ID', 'REVENUECAT_API_V2_SECRET_KEY'],
    },
  });
}

// ── v2 response shapes (loose: unknown fields are ignored) ───────────────────

const Millis = z.number().nullable().optional();
const ListOf = <T extends z.ZodType>(item: T) =>
  z.looseObject({ items: z.array(item).default([]), next_page: z.string().nullable().optional() });

export const V2Entitlement = z.looseObject({
  id: z.string(),
  lookup_key: z.string().optional(),
});
export const V2ActiveEntitlement = z.looseObject({
  entitlement_id: z.string(),
  expires_at: Millis,
});
export const V2Customer = z.looseObject({
  id: z.string(),
  active_entitlements: ListOf(V2ActiveEntitlement).optional(),
});
export type V2Customer = z.infer<typeof V2Customer>;
export const V2Subscription = z.looseObject({
  id: z.string(),
  product_id: z.string().nullable().optional(),
  starts_at: Millis,
  current_period_starts_at: Millis,
  current_period_ends_at: Millis,
  gives_access: z.boolean().optional(),
  auto_renewal_status: z.string().optional(),
  status: z.string().optional(),
  environment: z.string().optional(),
  store: z.string().optional(),
  ownership: z.string().optional(),
  entitlements: ListOf(z.looseObject({ id: z.string() })).optional(),
});
export type V2Subscription = z.infer<typeof V2Subscription>;
const V2Product = z.looseObject({ id: z.string(), store_identifier: z.string().optional() });
const SubscriptionList = ListOf(V2Subscription);

/** Everything the mirror needs about one app user id. */
export interface RevenueCatCustomerData {
  /** False when RevenueCat has no customer with this id (404). */
  readonly found: boolean;
  readonly entitlementId: string;
  readonly customer: V2Customer | null;
  readonly subscriptions: readonly V2Subscription[];
  /** RevenueCat product id → store product identifier (e.g. `da_pro_annual:annual`). */
  readonly productIdentifiers: Readonly<Record<string, string>>;
}

export interface RevenueCatClient {
  fetchCustomer(appUserId: string, signal?: AbortSignal): Promise<RevenueCatCustomerData>;
}

export interface RevenueCatClientOptions {
  readonly config: RevenueCatConfig;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

function retryAfterSeconds(response: Response): string {
  const header = response.headers.get('Retry-After');
  const seconds = header === null ? Number.NaN : Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return String(seconds);
  const reset = response.headers.get('RateLimit-Reset');
  const resetSeconds = reset === null ? Number.NaN : Number.parseInt(reset, 10);
  return Number.isFinite(resetSeconds) && resetSeconds > 0 ? String(resetSeconds) : '60';
}

export function createRevenueCatClient(options: RevenueCatClientOptions): RevenueCatClient {
  const doFetch = options.fetch ?? fetch;
  const base = `${(options.baseUrl ?? REVENUECAT_API_BASE).replace(/\/+$/, '')}/projects/${encodeURIComponent(options.config.projectId)}`;
  const timeoutMs = options.timeoutMs ?? OUTBOUND.providerTimeoutMs;
  let entitlementId: Promise<string> | null = null;
  const products = new Map<string, string>();

  async function get(path: string, signal: AbortSignal | undefined): Promise<unknown | null> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.config.secretKey}`,
          Accept: 'application/json',
        },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AppError('UPSTREAM_TIMEOUT', {
          details: { provider: 'revenuecat' },
          cause: error,
        });
      }
      throw new AppError('PROVIDER_UNAVAILABLE', {
        details: { provider: 'revenuecat' },
        cause: error,
      });
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
        details: {
          feature: 'purchases',
          credential_keys: ['REVENUECAT_API_V2_SECRET_KEY'],
          provider_status: response.status,
        },
      });
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new AppError('PROVIDER_RATE_LIMITED', {
        details: { provider: 'revenuecat' },
        headers: { 'Retry-After': retryAfterSeconds(response) },
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('PROVIDER_UNAVAILABLE', {
        details: { provider: 'revenuecat', provider_status: response.status },
      });
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        details: { provider: 'revenuecat', reason: 'invalid_json' },
        cause: error,
      });
    }
  }

  function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        details: { provider: 'revenuecat', reason: 'unexpected_shape' },
      });
    }
    return parsed.data;
  }

  async function resolveEntitlementId(signal: AbortSignal | undefined): Promise<string> {
    const list = parse(ListOf(V2Entitlement), await get('/entitlements?limit=100', signal));
    const match = list.items.find((e) => e.lookup_key === options.config.entitlementLookupKey);
    if (match === undefined) {
      throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
        details: { feature: 'purchases', credential_keys: ['REVENUECAT_ENTITLEMENT_PRO_ID'] },
      });
    }
    return match.id;
  }

  return {
    async fetchCustomer(appUserId, signal) {
      entitlementId ??= resolveEntitlementId(signal).catch((error: unknown) => {
        entitlementId = null;
        throw error;
      });
      const entitlement = await entitlementId;
      const id = encodeURIComponent(appUserId);
      const customerRaw = await get(`/customers/${id}`, signal);
      if (customerRaw === null) {
        return {
          found: false,
          entitlementId: entitlement,
          customer: null,
          subscriptions: [],
          productIdentifiers: {},
        };
      }
      const customer = parse(V2Customer, customerRaw);
      const subscriptions: V2Subscription[] = [];
      let next: string | null = `/customers/${id}/subscriptions?limit=50`;
      for (let pages = 0; next !== null && pages < 3; pages++) {
        const page: unknown = await get(next, signal);
        const list: z.infer<typeof SubscriptionList> = parse(SubscriptionList, page);
        subscriptions.push(...list.items);
        const cursor: string | null = list.next_page ?? null;
        next = cursor === null ? null : cursor.replace(/^.*\/customers\//, '/customers/');
      }
      const identifiers: Record<string, string> = {};
      const best = selectSubscription(subscriptions, entitlement, true);
      const productId = best?.product_id ?? null;
      if (productId !== null) {
        let identifier = products.get(productId);
        if (identifier === undefined) {
          const product = await get(`/products/${encodeURIComponent(productId)}`, signal);
          identifier =
            product === null
              ? productId
              : (parse(V2Product, product).store_identifier ?? productId);
          products.set(productId, identifier);
        }
        identifiers[productId] = identifier;
      }
      return {
        found: true,
        entitlementId: entitlement,
        customer,
        subscriptions,
        productIdentifiers: identifiers,
      };
    },
  };
}

// ── Mapping to the `subscriptions` mirror ────────────────────────────────────

/** The normalised snapshot `public.billing_apply_mirror` stores (DATABASE_AND_RLS_PLAN §4.6). */
export interface MirrorSnapshot {
  readonly fetched_at: string;
  readonly is_active: boolean;
  readonly status: SubscriptionStatus;
  readonly store: string | null;
  readonly environment: 'sandbox' | 'production' | null;
  readonly product_id: string | null;
  readonly period_type: 'normal' | 'trial' | 'intro' | null;
  readonly purchased_at: string | null;
  readonly original_purchased_at: string | null;
  readonly expires_at: string | null;
  readonly will_renew: boolean;
  readonly grace_expires_at: string | null;
  readonly is_family_share: boolean;
}

const MIRROR_STORES = new Set([
  'app_store',
  'play_store',
  'promotional',
  'stripe',
  'amazon',
  'mac_app_store',
  'test_store',
]);
const RENEWING = new Set(['will_renew', 'will_change_product']);

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function grantsEntitlement(sub: V2Subscription, entitlementId: string): boolean {
  const items = sub.entitlements?.items;
  return items === undefined || items.length === 0 || items.some((e) => e.id === entitlementId);
}

/** The subscription that decides the mirror: access-giving first, then the latest period end. */
export function selectSubscription(
  subscriptions: readonly V2Subscription[],
  entitlementId: string,
  allowSandbox: boolean,
): V2Subscription | null {
  const candidates = subscriptions.filter(
    (s) => grantsEntitlement(s, entitlementId) && (allowSandbox || s.environment !== 'sandbox'),
  );
  candidates.sort((a, b) => {
    const access = Number(b.gives_access === true) - Number(a.gives_access === true);
    if (access !== 0) return access;
    return (b.current_period_ends_at ?? 0) - (a.current_period_ends_at ?? 0);
  });
  return candidates[0] ?? null;
}

function mapStatus(
  sub: V2Subscription | null,
  active: boolean,
  willRenew: boolean,
): SubscriptionStatus {
  let status: SubscriptionStatus;
  switch (sub?.status) {
    case 'trialing':
      status = 'trial';
      break;
    case 'active':
      status = willRenew ? 'active' : 'cancelled';
      break;
    case 'in_grace_period':
      status = 'grace_period';
      break;
    case 'in_billing_retry':
      status = 'billing_issue';
      break;
    case 'paused':
      status = 'paused';
      break;
    case 'expired':
      status = 'expired';
      break;
    default:
      status = active ? 'active' : 'none';
  }
  if (
    !active &&
    ['trial', 'active', 'cancelled', 'grace_period', 'billing_issue'].includes(status)
  ) {
    return sub === null ? 'none' : 'expired';
  }
  if (active && ['none', 'expired', 'paused'].includes(status)) return 'active';
  return status;
}

/**
 * Pure mapping of the REST v2 customer to the mirror (UT-ENT-06/07/08): `is_active` is the
 * customer's active Pro entitlement (the snapshot is the truth, also during billing retry); in
 * production a sandbox subscription never grants access unless `allowSandbox` (the allow-listed
 * testers of app_settings['billing.sandbox_allowed_app_user_ids']).
 */
export function toMirrorSnapshot(
  data: RevenueCatCustomerData,
  options: { fetchedAt: Date; allowSandbox: boolean },
): MirrorSnapshot {
  const fetchedAt = options.fetchedAt.toISOString();
  const active = data.customer?.active_entitlements?.items.find(
    (e) => e.entitlement_id === data.entitlementId,
  );
  const sub = selectSubscription(data.subscriptions, data.entitlementId, options.allowSandbox);
  const sandboxOnly =
    !options.allowSandbox &&
    data.subscriptions.some(
      (s) =>
        s.environment === 'sandbox' &&
        s.gives_access === true &&
        grantsEntitlement(s, data.entitlementId),
    ) &&
    !data.subscriptions.some(
      (s) =>
        s.environment !== 'sandbox' &&
        s.gives_access === true &&
        grantsEntitlement(s, data.entitlementId),
    );
  const entitlementLive =
    active !== undefined &&
    (active.expires_at === null ||
      active.expires_at === undefined ||
      active.expires_at > options.fetchedAt.getTime());
  const isActive = entitlementLive && !sandboxOnly;
  const willRenew = sub !== null && RENEWING.has(sub.auto_renewal_status ?? '');
  const status = mapStatus(sub, isActive, willRenew);
  const expiresAt =
    (isActive ? iso(active?.expires_at) : null) ?? iso(sub?.current_period_ends_at) ?? null;
  const storeRaw = sub?.store ?? (isActive ? 'promotional' : null);
  const productId = sub?.product_id ?? null;
  return {
    fetched_at: fetchedAt,
    is_active: isActive,
    status,
    store: storeRaw !== null && MIRROR_STORES.has(storeRaw) ? storeRaw : null,
    environment:
      sub?.environment === 'sandbox' || sub?.environment === 'production' ? sub.environment : null,
    product_id: productId === null ? null : (data.productIdentifiers[productId] ?? productId),
    period_type: status === 'trial' ? 'trial' : sub === null ? null : 'normal',
    purchased_at: iso(sub?.current_period_starts_at),
    original_purchased_at: iso(sub?.starts_at),
    expires_at: expiresAt,
    will_renew: isActive && willRenew,
    grace_expires_at:
      status === 'grace_period' || status === 'billing_issue' ? iso(active?.expires_at) : null,
    is_family_share: sub?.ownership === 'family_shared',
  };
}

/**
 * Deletes the RevenueCat customer at account deletion (API_CONTRACTS JOB-23 step 4;
 * SECURITY_AND_PRIVACY_PLAN §4.8 step 5): `DELETE /v2/projects/{pid}/customers/{app_user_id}`
 * [verify endpoint against the RevenueCat reference before launch]. The store subscription itself is
 * not cancelled (the user was told). A missing customer is `not_found`; errors map like the reads
 * above (429 → `PROVIDER_RATE_LIMITED` with `Retry-After`, 5xx / network → `PROVIDER_UNAVAILABLE`,
 * timeout → `UPSTREAM_TIMEOUT`, 401/403 → `EXTERNAL_CREDENTIAL_REQUIRED`).
 */
export async function deleteRevenueCatCustomer(
  options: RevenueCatClientOptions,
  appUserId: string,
  signal?: AbortSignal,
): Promise<'deleted' | 'not_found'> {
  const base = `${(options.baseUrl ?? REVENUECAT_API_BASE).replace(/\/+$/, '')}/projects/${encodeURIComponent(options.config.projectId)}`;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `${base}/customers/${encodeURIComponent(appUserId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${options.config.secretKey}`,
          Accept: 'application/json',
        },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new AppError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'UPSTREAM_TIMEOUT'
        : 'PROVIDER_UNAVAILABLE',
      { details: { provider: 'revenuecat' }, cause: error },
    );
  }
  await response.body?.cancel();
  if (response.ok) return 'deleted';
  if (response.status === 404) return 'not_found';
  if (response.status === 401 || response.status === 403) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: {
        feature: 'purchases',
        credential_keys: ['REVENUECAT_API_V2_SECRET_KEY'],
        provider_status: response.status,
      },
    });
  }
  if (response.status === 429) {
    throw new AppError('PROVIDER_RATE_LIMITED', {
      details: { provider: 'revenuecat' },
      headers: { 'Retry-After': retryAfterSeconds(response) },
    });
  }
  throw new AppError('PROVIDER_UNAVAILABLE', {
    details: { provider: 'revenuecat', provider_status: response.status },
  });
}
