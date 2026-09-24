/** Hono context types shared by every function. */
import type { Context } from 'hono';
import type { Locale } from '../errors.ts';
import type { Logger } from '../logging/logger.ts';

/** Verified claims of a Supabase access token (the subset the functions rely on). */
export interface VerifiedClaims {
  readonly sub: string;
  readonly role?: string;
  readonly aal?: string;
  readonly session_id?: string;
  readonly is_anonymous?: boolean;
  readonly email?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly amr?: readonly { method?: string; timestamp?: number }[];
  readonly app_metadata?: Readonly<Record<string, unknown>>;
  readonly admin_role?: string;
  readonly [claim: string]: unknown;
}

export type Aal = 'aal1' | 'aal2';

export interface UserAuth {
  readonly userId: string;
  readonly aal: Aal;
  readonly sessionId: string | null;
  /** The raw access token, forwarded to user-scoped (RLS) database clients only. */
  readonly jwt: string;
  readonly claims: VerifiedClaims;
}

export interface AdminAuth {
  readonly adminId: string;
  readonly sessionId: string | null;
  readonly jwt: string;
  readonly role: string | null;
}

/** Request-scoped values set by middleware. */
export interface AppVariables {
  correlationId: string;
  requestId: string;
  locale: Locale;
  log: Logger;
  startedAt: number;
  auth: UserAuth | undefined;
  /** Peppered pseudonym of the caller for logs. */
  userHash: string | undefined;
  admin: AdminAuth | undefined;
  /** Validated request parts (set by the route validator). */
  validated: { raw?: unknown; body?: unknown; query?: unknown; params?: unknown };
  /** `X-DA-Client` parsed: platform and app version (§2.2). */
  client: { platform: 'ios' | 'android' | null; version: string | null; build: string | null };
  /** `X-DA-Installation-Id` when it is a UUID. */
  installationId: string | null;
  /** Error code of the response, for the access log. */
  errorCode: string | undefined;
  /** Route template ("METHOD /path") matched by the route registry. */
  routeKey: string | undefined;
}

export interface AppEnv {
  Variables: AppVariables;
}

export type AppContext = Context<AppEnv>;
