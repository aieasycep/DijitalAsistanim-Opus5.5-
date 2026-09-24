/**
 * Dependencies of the `api` function. `index.ts` wires the real (supabase-backed) implementations
 * through `repos/system/index.ts`; tests pass in-memory ones.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import type { RateLimitClassName } from '../_shared/config.ts';
import type { FunctionEnv, RawEnv } from '../_shared/env.ts';
import type { AppEnv, UserAuth } from '../_shared/http/context.ts';
import type { IdempotencyRepo } from '../_shared/idempotency.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { RateLimitStore } from '../_shared/ratelimit.ts';
import type { TokenVerifier } from '../_shared/auth/user.ts';
import type { TokenKeyring } from '../_shared/crypto/token-cipher.ts';
import type { AccountStateRepo, AppSettingsRepo } from '../_shared/services/account-state.ts';
import type { AuditWriter } from '../_shared/services/audit.ts';
import type { BootstrapSources, ServiceCapabilities } from '../_shared/services/bootstrap.ts';
import type { CredentialsRepo } from '../_shared/services/credentials.ts';
import type { DevicesRepo } from '../_shared/services/devices.ts';
import type { EntitlementReader } from '../_shared/services/entitlements.ts';
import type { EntitlementGate } from '../_shared/services/entitlements/gate.ts';
import type { BillingRepo } from '../_shared/services/billing/sync.ts';
import type { RevenueCatClient } from '../_shared/services/billing/revenuecat.ts';
import type { ReferralRepo } from '../_shared/services/referrals/repo.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import type { AnalyticsRepo } from './routes/analytics.ts';
import type { SupportRepo } from './routes/support.ts';
import type { EnqueueInput } from '../_shared/jobs/types.ts';
import type { ApprovalsRepo } from '../_shared/services/approvals/model.ts';
import type { EventPreconditionReader } from '../_shared/services/approvals/context.ts';
import type { NotificationsRepo } from '../_shared/services/notifications/model.ts';
import type { RemindersRepo } from '../_shared/services/reminders.ts';
import type { WidgetSources } from '../_shared/services/widgets/snapshot.ts';

/** Job queue access for routes that enqueue follow-up work (service role). */
export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<string>;
  byKey(key: string): Promise<{ id: string; status: string } | null>;
}

/** Per-request repositories bound to the caller (their RLS client plus scoped system access). */
export interface RequestRepos {
  readonly devices: DevicesRepo;
  readonly bootstrap: BootstrapSources;
  readonly entitlements: EntitlementReader;
  readonly analytics: AnalyticsRepo;
  readonly support: SupportRepo;
  readonly approvals: ApprovalsRepo;
  readonly reminders: RemindersRepo;
  readonly notifications: NotificationsRepo;
  readonly widgets: WidgetSources;
  readonly jobs: JobQueue;
  /** Provider GET of an event's etag / organizer flag (`calendar_update`); absent → stored etag. */
  readonly eventPrecondition?: EventPreconditionReader;
}

/**
 * Business services (T-7.01…T-7.03): the Pro gate every route chain runs, the referral and billing
 * repositories (service client, verified user ids only) and the RevenueCat v2 client (null while
 * the credential is missing).
 */
export interface ApiBusiness {
  gate(auth: UserAuth): EntitlementGate;
  readonly referrals: ReferralRepo;
  readonly billing: BillingRepo;
  readonly revenueCat: RevenueCatClient | null;
}

export interface ApiDeps {
  readonly env: FunctionEnv;
  readonly raw: RawEnv;
  readonly log: Logger;
  readonly sentry?: Sentry;
  readonly verifier: TokenVerifier;
  readonly accounts: AccountStateRepo;
  readonly settings: AppSettingsRepo;
  readonly rateLimits: RateLimitStore;
  readonly idempotency: IdempotencyRepo;
  readonly credentials: CredentialsRepo;
  readonly audit: AuditWriter;
  readonly appleSub: (userId: string) => Promise<string | null>;
  readonly keyring: () => Promise<TokenKeyring>;
  readonly capabilities: ServiceCapabilities;
  readonly repos: (auth: UserAuth) => RequestRepos;
  readonly business: ApiBusiness;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface RouteKit {
  readonly deps: ApiDeps;
  /** requireUser + account/version gate + rate limit (per route class). */
  readonly chain: (options: {
    gate: boolean;
    rateLimit: RateLimitClassName;
  }) => MiddlewareHandler<AppEnv>[];
  readonly now: () => Date;
}

export type RouteRegistrar = (app: Hono<AppEnv>, kit: RouteKit) => void;
