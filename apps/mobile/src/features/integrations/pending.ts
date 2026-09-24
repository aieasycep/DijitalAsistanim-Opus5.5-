/**
 * The client binding of an integration OAuth flow (R-07, D-31): a 32-byte random `device_nonce`
 * kept in SecureStore `da.oauth.pending` (one flow at a time, valid 10 minutes); only its SHA-256
 * (lower-case hex, API_CONTRACTS `Sha256Hex`) is sent to `/start` or `/upgrade`, and the nonce
 * itself only to `POST /integrations/oauth/complete`.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { now } from '../../lib/clock';
import { SECURE_KEYS, SECURE_STORE_OPTIONS, base64Url } from '../../lib/storage';

export type OAuthProvider = 'google' | 'microsoft' | 'demo';
export type ReadCapability = 'mail_read' | 'calendar_read' | 'tasks_read';
export type ReturnTo = 'onboarding' | 'settings_accounts' | 'error_card';

export interface PendingOAuth {
  readonly device_nonce: string;
  readonly provider: OAuthProvider;
  readonly capabilities: readonly string[];
  readonly return_to: ReturnTo;
  readonly account_id?: string;
  readonly state_id?: string;
  readonly started_at: string;
}

export const PENDING_TTL_MS = 10 * 60_000;

/** A fresh 32-byte nonce as unpadded base64url (43 characters) and its SHA-256 hex digest. */
export async function newDeviceNonce(): Promise<{ nonce: string; hash: string }> {
  const nonce = base64Url(Crypto.getRandomBytes(32));
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  return { nonce, hash: hash.toLowerCase() };
}

export async function savePendingOAuth(entry: PendingOAuth): Promise<void> {
  await SecureStore.setItemAsync(
    SECURE_KEYS.oauthPending,
    JSON.stringify(entry),
    SECURE_STORE_OPTIONS,
  );
}

function isPending(value: unknown): value is PendingOAuth {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.device_nonce === 'string' &&
    typeof entry.provider === 'string' &&
    typeof entry.started_at === 'string' &&
    Array.isArray(entry.capabilities)
  );
}

/** The pending flow of this device, or null (missing, unreadable or older than 10 minutes). */
export async function readPendingOAuth(at: Date = now()): Promise<PendingOAuth | null> {
  const raw = await SecureStore.getItemAsync(SECURE_KEYS.oauthPending, SECURE_STORE_OPTIONS);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPending(parsed)) return null;
    const started = Date.parse(parsed.started_at);
    if (!Number.isFinite(started) || at.getTime() - started > PENDING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingOAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_KEYS.oauthPending, SECURE_STORE_OPTIONS).catch(
    () => undefined,
  );
}
