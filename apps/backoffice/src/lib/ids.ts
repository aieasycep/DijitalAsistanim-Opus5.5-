/**
 * UUID v7 (RFC 9562): 48-bit Unix milliseconds, version and variant bits, random tail. Used for
 * `Idempotency-Key` (created when a confirm dialog opens) and `x-correlation-id` (BACKOFFICE_PLAN
 * §2.3), so keys sort by creation time in logs.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
