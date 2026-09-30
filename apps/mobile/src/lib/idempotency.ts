/**
 * Deterministic `Idempotency-Key`s for intents named in the screen map (`evening_ready:{briefing}`,
 * `first_analysis:{user}:{attempt}`, `oauth_complete:{code}`). The API requires a UUID
 * (API_CONTRACTS §2.11), so the intent name is hashed (SHA-256) into a name-based UUID: the same
 * intent always sends the same key, including after an app restart.
 */
import * as Crypto from 'expo-crypto';

export async function intentKey(intent: string): Promise<string> {
  const hex = (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, intent)
  ).toLowerCase();
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
