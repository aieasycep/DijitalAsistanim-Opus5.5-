/**
 * The app clock. Production builds always use the device time. Demo builds can pin it
 * (`dijitalasistan://demo/setup?clock=<ISO>`, R-21) so store screenshots and Maestro flows render
 * the same day and times as the seeded demo dataset; the pin is stored in `da-prefs`.
 */
import { isDemoBuild } from './env';
import { encryptedStorage, isEncryptedStorageOpen } from './storage';

const PIN_KEY = 'demo.clock_pin';

/** Offset between the pinned time and the device time when the pin was set. */
let offsetMs: number | null = null;

function loadPin(): void {
  if (offsetMs !== null || !isEncryptedStorageOpen() || !isDemoBuild()) return;
  const raw = encryptedStorage().prefs.getNumber(PIN_KEY);
  if (raw !== undefined) offsetMs = raw;
}

export function now(): Date {
  loadPin();
  return offsetMs === null ? new Date() : new Date(Date.now() + offsetMs);
}

/** Pins the clock to `at` (demo builds only); returns false when refused. */
export function pinClock(at: Date): boolean {
  if (!isDemoBuild() || Number.isNaN(at.getTime())) return false;
  offsetMs = at.getTime() - Date.now();
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(PIN_KEY, offsetMs);
  return true;
}

export function unpinClock(): void {
  offsetMs = null;
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.remove(PIN_KEY);
}
