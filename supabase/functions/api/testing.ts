/**
 * In-memory harness for the `api` route tests: every repository is a fake with the semantics of
 * its SQL counterpart, JWTs come from a local issuer and `fetch` is a recording stub.
 */
import type { Hono } from 'hono';
import type { AccountStatus, Capability, Provider } from '@da/domain';
import { loadKeyring, type TokenKeyring } from '../_shared/crypto/token-cipher.ts';
import { parseFunctionEnv, type RawEnv } from '../_shared/env.ts';
import type { AppEnv, UserAuth } from '../_shared/http/context.ts';
import { memoryIdempotencyRepo } from '../_shared/idempotency.ts';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import type { RateLimitStore } from '../_shared/ratelimit.ts';
import type { AccountState } from '../_shared/services/account-state.ts';
import type { AuditEntry } from '../_shared/services/audit.ts';
import type {
  AccountRow,
  AnnouncementRow,
  BootstrapSources,
  ServiceCapabilities,
} from '../_shared/services/bootstrap.ts';
import { memoryCredentials } from '../_shared/testing/credentials.ts';
import {
  type MemoryBilling,
  memoryBillingRepo,
  type MemoryGate,
  memoryEntitlementGate,
  type MemoryReferrals,
  memoryReferralRepo,
} from '../_shared/testing/business.ts';
import type { RevenueCatClient } from '../_shared/services/billing/revenuecat.ts';
import type {
  DevicesRepo,
  InstallationUpsert,
  TokenDisableReason,
} from '../_shared/services/devices.ts';
import type { EntitlementReader } from '../_shared/services/entitlements.ts';
import { randomBase64, testEnv } from '../_shared/testing/env.ts';
import { stubFetch, type StubHandler } from '../_shared/testing/fetch.ts';
import { createTestIssuer, type TestIssuer, userClaims } from '../_shared/testing/jwt.ts';
import { createApiApp } from './app.ts';
import type { IntegrationRuntime } from '../_shared/services/integrations/runtime.ts';
import type { ApiDeps } from './deps.ts';
import type { AnalyticsRow } from './routes/analytics.ts';
import type { FeedbackInsert, TicketInsert, TicketView } from './routes/support.ts';

export const NOW = new Date('2026-09-23T07:00:00.000Z');

export interface StoredInstallation extends InstallationUpsert {
  readonly id: string;
  signed_out_at: null;
  signedOut: string | null;
}

export interface StoredToken {
  readonly id: string;
  user_id: string;
  installation_id: string;
  readonly expo_push_token: string;
  status: 'active' | 'disabled';
  disabled_reason: TokenDisableReason | null;
}

export function memoryDevices() {
  const installations = new Map<string, StoredInstallation>();
  const tokens: StoredToken[] = [];
  const timezones = new Map<string, { timezone: string; timezone_mode: 'auto' | 'manual' }>();
  let upserts = 0;
  const repo: DevicesRepo = {
    findInstallation(installationId) {
      const row = installations.get(installationId);
      return Promise.resolve(
        row === undefined
          ? null
          : {
              id: row.id,
              user_id: row.user_id,
              installation_id: row.installation_id,
              signed_out_at: row.signedOut,
            },
      );
    },
    upsertInstallation(row) {
      upserts++;
      const existing = installations.get(row.installation_id);
      const id = existing?.id ?? crypto.randomUUID();
      installations.set(row.installation_id, { ...row, id, signedOut: null });
      return Promise.resolve(id);
    },
    findToken(token) {
      const row = tokens.find((t) => t.expo_push_token === token);
      return Promise.resolve(
        row === undefined
          ? null
          : {
              id: row.id,
              user_id: row.user_id,
              installation_id: row.installation_id,
              status: row.status,
            },
      );
    },
    reassignToken(tokenRowId, userId, installationRowId) {
      const row = tokens.find((t) => t.id === tokenRowId);
      if (row !== undefined) {
        row.user_id = userId;
        row.installation_id = installationRowId;
        row.status = 'active';
        row.disabled_reason = null;
      }
      return Promise.resolve();
    },
    insertToken(row) {
      tokens.push({
        id: crypto.randomUUID(),
        user_id: row.user_id,
        installation_id: row.installation_id,
        expo_push_token: row.expo_push_token,
        status: 'active',
        disabled_reason: null,
      });
      return Promise.resolve();
    },
    disableInstallationTokens(installationRowId, reason, filter = {}) {
      let n = 0;
      for (const t of tokens) {
        if (t.installation_id !== installationRowId || t.status !== 'active') continue;
        if (filter.exceptTokenRowId !== undefined && t.id === filter.exceptTokenRowId) continue;
        if (filter.notUserId !== undefined && t.user_id === filter.notUserId) continue;
        t.status = 'disabled';
        t.disabled_reason = reason;
        n++;
      }
      return Promise.resolve(n);
    },
    markSignedOut(installationRowId, at) {
      for (const row of installations.values())
        if (row.id === installationRowId) row.signedOut = at;
      return Promise.resolve();
    },
    timezonePreference: (userId) => Promise.resolve(timezones.get(userId) ?? null),
    updateTimezone(userId, timezone) {
      const current = timezones.get(userId);
      if (current !== undefined) timezones.set(userId, { ...current, timezone });
      return Promise.resolve();
    },
  };
  return { repo, installations, tokens, timezones, upserts: () => upserts };
}

export function countingRateLimits(): RateLimitStore {
  const counts = new Map<string, number>();
  return {
    hit(key, limit) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve({ allowed: n <= limit, count: n });
    },
  };
}

export function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    provider: 'microsoft' as Provider,
    account_email: 'yunus@contoso.example',
    display_label: 'İş',
    tenant_type: 'work',
    status: 'healthy' as AccountStatus,
    capabilities_granted: ['mail_read', 'calendar_read'] as Capability[],
    data_source_toggles: { draft_replies: false },
    last_sync_at: '2026-09-23T06:55:00Z',
    last_error_code: null,
    // Columns the bootstrap must never expose.
    provider_account_id: 'AAQkAGI2provider-internal-id',
    delta_link: 'https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=secret',
    scopes_granted: ['Mail.Read'],
    ...overrides,
  };
}

export interface Harness {
  readonly app: Hono<AppEnv>;
  readonly issuer: TestIssuer;
  readonly deps: ApiDeps;
  readonly devices: ReturnType<typeof memoryDevices>;
  readonly credentials: ReturnType<typeof memoryCredentials>;
  readonly accounts: Map<string, AccountState>;
  readonly audit: AuditEntry[];
  readonly analytics: { rows: AnalyticsRow[]; optOut: Set<string> };
  readonly support: { tickets: TicketInsert[]; feedback: FeedbackInsert[] };
  readonly touched: string[];
  readonly appleSubs: Map<string, string>;
  readonly fetchCalls: ReturnType<typeof stubFetch>['calls'];
  readonly announcements: AnnouncementRow[];
  readonly accountRows: AccountRow[];
  /** Business fakes (T-7.01…T-7.03): the plan gate (Free unless set Pro), referrals, billing. */
  readonly business: { gate: MemoryGate; referrals: MemoryReferrals; billing: MemoryBilling };
  token(sub?: string, extra?: Record<string, unknown>): Promise<string>;
}

export async function createHarness(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: StubHandler;
    capabilities?: Partial<ServiceCapabilities>;
    revenueCat?: RevenueCatClient | null;
    /** Integration engine (API-INT-01…07, API-MAIL-01) — `_shared/testing/integrations.ts`. */
    integrations?: IntegrationRuntime;
  } = {},
): Promise<Harness> {
  const raw: RawEnv = testEnv(options.env ?? {});
  const env = parseFunctionEnv(raw);
  const issuer = await createTestIssuer();
  const devices = memoryDevices();
  const credentials = memoryCredentials();
  const accounts = new Map<string, AccountState>();
  const audit: AuditEntry[] = [];
  const analytics = { rows: [] as AnalyticsRow[], optOut: new Set<string>() };
  const support = { tickets: [] as TicketInsert[], feedback: [] as FeedbackInsert[] };
  const touched: string[] = [];
  const appleSubs = new Map<string, string>();
  const announcements: AnnouncementRow[] = [];
  const accountRows: AccountRow[] = [accountRow()];
  const stub = stubFetch(options.fetch ?? (() => new Response('unexpected', { status: 599 })));
  let keyring: Promise<TokenKeyring> | null = null;
  const business = {
    gate: memoryEntitlementGate(),
    referrals: memoryReferralRepo(() => NOW),
    billing: memoryBillingRepo(),
  };

  // The store mirror written by the billing fake is what `effective_entitlement` reports.
  const entitlements: EntitlementReader = {
    effective: (userId) => {
      const mirror = business.billing.mirrors.get(userId);
      const active = mirror?.is_active === true;
      return Promise.resolve({
        is_active: active,
        source: active ? 'store' : 'none',
        is_trial: active && mirror?.period_type === 'trial',
        will_renew: active && mirror?.will_renew === true,
        store_expires_at: active ? (mirror?.expires_at ?? null) : null,
        grant_ends_at: null,
        active_until: active ? (mirror?.expires_at ?? null) : null,
      });
    },
    subscription: (userId) => {
      const mirror = business.billing.mirrors.get(userId);
      return Promise.resolve(
        mirror === undefined
          ? null
          : {
              is_active: mirror.is_active,
              store: mirror.store,
              product_id: mirror.product_id,
              period_type: mirror.period_type,
              will_renew: mirror.will_renew,
              expires_at: mirror.expires_at,
              billing_issue_at: null,
            },
      );
    },
    grants: () => Promise.resolve([]),
    usage: () =>
      Promise.resolve([
        { key: 'ai_daily_budget_units', limit: 20, used: 3, remaining: 17 },
        { key: 'captures_per_day', limit: 5, used: 1, remaining: 4 },
      ]),
  };

  const bootstrap: BootstrapSources = {
    profile: (userId) =>
      Promise.resolve({
        user_id: userId,
        display_name: 'Yunus',
        locale: 'tr-TR',
        state: accounts.get(userId)?.state ?? 'active',
        disabled_at: accounts.get(userId)?.disabledAt ?? null,
        onboarding_step: 'done',
        onboarding_completed_at: '2026-09-01T10:00:00Z',
        created_at: '2026-09-01T09:00:00Z',
      }),
    preferences: () => Promise.resolve({ timezone: 'Europe/Istanbul', retention_policy: 'd365' }),
    notificationPreferences: () => Promise.resolve({ detail_level: 'full' }),
    entitlements,
    flags: () =>
      Promise.resolve({
        'ai.global.enabled': true,
        'ai.feature.assistant_qa': true,
        'ai.feature.reply_draft': false,
        'ai.feature.embedding_query': true,
      }),
    minSupportedVersion: () => Promise.resolve({ ios: '1.2.0', android: '1.2.0' }),
    referralRewardDays: () => Promise.resolve(30),
    referralRewardsPerYear: () => Promise.resolve(6),
    counts: () => Promise.resolve({ pending_approvals: 2, open_followups: 1, open_commitments: 3 }),
    pendingDeviceApprovals: () => Promise.resolve([]),
    accounts: () => Promise.resolve(accountRows),
    announcements: () => Promise.resolve(announcements),
    touchInstallation(userId, installationId) {
      touched.push(`${userId}:${installationId}`);
      return Promise.resolve();
    },
  };

  const deps: ApiDeps = {
    env,
    raw,
    log: createLogger({ fn: 'api', sink: memorySink().sink }),
    verifier: issuer.verifier,
    accounts: {
      get: (userId) =>
        Promise.resolve(accounts.get(userId) ?? { state: 'active', disabledAt: null }),
    },
    settings: {
      minSupportedVersion: () => Promise.resolve({ ios: '1.2.0', android: '1.2.0' }),
      referralRewardDays: () => Promise.resolve(30),
    },
    rateLimits: countingRateLimits(),
    idempotency: memoryIdempotencyRepo(),
    credentials,
    audit: { append: (entry) => Promise.resolve(void audit.push(entry)) },
    appleSub: (userId) => Promise.resolve(appleSubs.get(userId) ?? null),
    keyring: () =>
      (keyring ??= loadKeyring({
        token_encryption_keys: { 1: randomBase64(32) },
        TOKEN_ENC_ACTIVE_VERSION: 1,
      })),
    capabilities: {
      aiGenerate: false,
      embeddings: false,
      ttsPremium: false,
      googleOauth: false,
      microsoftOauth: false,
      purchases: false,
      push: false,
      ...options.capabilities,
    },
    repos: (_auth: UserAuth) => ({
      devices: devices.repo,
      bootstrap,
      entitlements,
      analytics: {
        optedOut: (userId) => Promise.resolve(analytics.optOut.has(userId)),
        insert: (rows) => Promise.resolve(void analytics.rows.push(...rows)),
      },
      support: {
        insertTicket(row) {
          support.tickets.push(row);
          const view: TicketView = {
            id: crypto.randomUUID(),
            reference: `DA-${String(support.tickets.length).padStart(6, '0')}`,
            status: 'open',
          };
          return Promise.resolve(view);
        },
        getTicket: () => Promise.resolve(null),
        insertFeedback(row) {
          support.feedback.push(row);
          return Promise.resolve({ id: crypto.randomUUID() });
        },
      },
    }),
    business: {
      gate: () => business.gate,
      referrals: business.referrals,
      billing: business.billing,
      revenueCat: options.revenueCat ?? null,
    },
    fetch: stub.fetch,
    ...(options.integrations === undefined ? {} : { integrations: options.integrations }),
    now: () => NOW,
  };

  return {
    app: createApiApp(deps),
    issuer,
    deps,
    devices,
    credentials,
    accounts,
    audit,
    analytics,
    support,
    touched,
    appleSubs,
    fetchCalls: stub.calls,
    announcements,
    accountRows,
    business,
    token: (sub, extra = {}) => issuer.sign(userClaims(sub, extra)),
  };
}

/** JSON request helper: bearer token, optional Idempotency-Key and client headers. */
export function call(
  h: Harness,
  method: string,
  path: string,
  options: {
    jwt?: string | null;
    body?: unknown;
    key?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'X-DA-Client': 'ios/1.4.0 (812)', ...options.headers };
  if (options.jwt !== undefined && options.jwt !== null)
    headers.Authorization = `Bearer ${options.jwt}`;
  if (options.key !== undefined && options.key !== null) headers['Idempotency-Key'] = options.key;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return Promise.resolve(
    h.app.request(`/api${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
}
