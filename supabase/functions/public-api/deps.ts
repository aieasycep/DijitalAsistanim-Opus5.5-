/**
 * Dependencies of `public-api` (API_CONTRACTS §13). `index.ts` wires the supabase-backed
 * implementations (`repo.ts`, `otp.ts`, `captcha.ts`); tests pass in-memory ones.
 */
import type { TicketCategory } from '@da/domain';
import type { Pepper } from '../_shared/crypto/hash.ts';
import type { RateLimitStore } from '../_shared/ratelimit.ts';

export interface DeletionStatusRow {
  readonly id: string;
  readonly kind: 'account' | 'history';
  readonly status:
    'requested' | 'verified' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  readonly requested_at: string;
  readonly completed_at: string | null;
  readonly steps: Readonly<Record<string, unknown>>;
  /** Hex sha256 of the status token, or null when none was issued. */
  readonly status_token_hash: string | null;
}

/** The public-api data layer (migration 20260924002220; service-role wrappers only). */
export interface PublicRepo {
  supportTicket(input: {
    email: string;
    name: string | null;
    category: TicketCategory;
    subject: string;
    message: string;
  }): Promise<{ id: string; reference: string; duplicate: boolean }>;
  inboundNote(input: {
    messageId: string;
    reference: string;
    sender: string;
    body: string;
    digest: Uint8Array;
  }): Promise<{ stored: boolean; reason?: string }>;
  deletionSubject(email: string): Promise<{ user_id: string; is_admin: boolean } | null>;
  otpLockSeconds(subject: string): Promise<number>;
  otpRecordFailure(
    subject: string,
  ): Promise<{ locked: boolean; failures: number; retry_after: number }>;
  createDeletionRequest(input: {
    userId: string;
    statusTokenHash: Uint8Array;
    subjectEmailHash: Uint8Array;
    correlationId: string | null;
  }): Promise<{ request_id: string; status: string; created: boolean }>;
  subscriptionActive(userId: string): Promise<boolean>;
  deletionStatus(requestId: string): Promise<DeletionStatusRow | null>;
  plans(): Promise<{
    free: Readonly<Record<string, unknown>>;
    pricing: unknown;
    updated_at: string | null;
  }>;
  referralResolve(
    code: string,
  ): Promise<{ valid: boolean; reward_days: number; apply_window_days: number }>;
  webAnalyticsIncrement(
    day: string,
    event: string,
    dims: Record<string, string | number | boolean>,
  ): Promise<void>;
}

/** Supabase Auth e-mail OTP (PUB-02/03); the browser never talks to Auth (C-24). */
export interface OtpGateway {
  /** `signInWithOtp({email, options:{shouldCreateUser:false}})`; failures are swallowed. */
  sendCode(email: string, locale: 'tr' | 'en'): Promise<void>;
  /** `verifyOtp({email, token, type:'email'})`; null when the code is wrong or expired. */
  verifyCode(
    email: string,
    code: string,
  ): Promise<{ userId: string; accessToken: string; isAdmin: boolean } | null>;
  /** Revokes the verification session and every other session of the user. */
  revokeSessions(accessToken: string): Promise<boolean>;
}

/** Cloudflare Turnstile (only when `TURNSTILE_SECRET_KEY` is configured). */
export interface CaptchaVerifier {
  verify(token: string | undefined): Promise<boolean>;
}

export interface PublicApiServices {
  readonly repo: PublicRepo;
  readonly otp: OtpGateway;
  readonly captcha: CaptchaVerifier | null;
  readonly rateLimits: RateLimitStore;
  /** `HASH_PEPPER`: IP and e-mail hashes for rate limits and deletion subjects. */
  readonly pepper: Pepper;
  /** `EMAIL_INBOUND_BASIC_AUTH` (`user:password`) for PUB-08. */
  readonly inboundBasicAuth: string | undefined;
  /** `PUBLIC_WEB_URL`, the store fallback `/get`. */
  readonly publicWebUrl: string | undefined;
  /** `IOS_APP_STORE_ID` (External credential required for the App Store link). */
  readonly iosAppStoreId: string | undefined;
  /** `ANDROID_PACKAGE` (default `com.dijitalasistan.app`). */
  readonly androidPackage: string;
  /** Immediate worker poke after an enqueue (best effort). */
  readonly poke: () => Promise<unknown>;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
}
