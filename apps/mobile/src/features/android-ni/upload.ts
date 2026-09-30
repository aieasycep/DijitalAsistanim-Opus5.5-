/**
 * Signal uploader (T-8.26, API-ANI-01): batches the structured signals waiting in the encrypted
 * on-device buffer to `POST /android-notifications/signals` on foreground and on the background
 * task tick. Every signal is rebuilt from the allow-listed fields and validated against the strict
 * `AniSignal` schema before it leaves the device, so no text field can ever be sent (R-15). The
 * idempotency key is derived from the batch, so a retried batch reuses it; the server also dedupes
 * by `signal_hash`. Pro only (the server stays authoritative with 402); a failed batch stays in the
 * buffer, which drops anything older than 24 h on its own.
 */
import { aniSignalsUploadMutationOptions } from '@da/api-client/react';
import { isApiError, qk, type ApiClient } from '@da/api-client';
import { AniSignal, aniSignalFresh } from '@da/validation/api/android-ni';
import { MutationObserver } from '@tanstack/react-query';

import { installationId } from '../../lib/auth/first-run-purge';
import { getApiClient } from '../../lib/bootstrap';
import { now as clockNow } from '../../lib/clock';
import { cachedBootstrap } from '../../lib/postgrest';
import { getQueryClient } from '../../lib/query/client';
import { isOffline } from '../../lib/query/online-manager';
import { replayPendingDeletes } from './data';
import { isNiSupported, niCall } from './native';

/** Fields an uploaded signal may carry: exactly the `AniSignal` schema keys. */
export const UPLOAD_FIELDS = [
  'signal_hash',
  'package',
  'app_label',
  'category',
  'amount',
  'due_date',
  'tracking_status',
  'flight_no',
  'gate',
  'posted_at',
] as const;

const BATCH = 200;
const MAX_BATCHES = 5;

/** Rebuilds a buffered signal from the allow-listed fields; null when it fails the schema. */
export function toUploadSignal(raw: unknown): AniSignal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of UPLOAD_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    picked[field] =
      field === 'amount' && typeof value === 'object'
        ? {
            value: (value as Record<string, unknown>).value,
            currency: (value as Record<string, unknown>).currency,
          }
        : value;
  }
  const parsed = AniSignal.safeParse(picked);
  return parsed.success ? parsed.data : null;
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A UUID-v4-shaped key determined by the batch's hashes (same batch → same key). */
export function batchIdempotencyKey(hashes: readonly string[]): string {
  const input = [...hashes].sort().join('|');
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => fnv1a(input, seed).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type UploadResult =
  'unsupported' | 'not_entitled' | 'disabled' | 'offline' | 'empty' | 'uploaded' | 'failed';

export interface UploadDeps {
  readonly api?: ApiClient;
  readonly installationId?: () => string | null;
  readonly now?: () => Date;
}

/** `feature.android_ni` is on unless the bootstrap flags say otherwise (R-10 kill switch). */
export function isNiFeatureOn(): boolean {
  return cachedBootstrap()?.flags['feature.android_ni'] !== false;
}

/** Pro right now; null while no bootstrap is cached (a background launch): the server decides. */
export function isNiEntitled(): boolean | null {
  return cachedBootstrap()?.entitlement.is_active ?? null;
}

let inflight: Promise<UploadResult> | null = null;

/** Uploads everything waiting in the buffer (single flight). */
export function flushAniSignals(deps: UploadDeps = {}): Promise<UploadResult> {
  inflight ??= run(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(deps: UploadDeps): Promise<UploadResult> {
  if (!isNiSupported()) return 'unsupported';
  if (!isNiFeatureOn()) return 'disabled';
  if (isNiEntitled() === false) return 'not_entitled';
  if (isOffline()) return 'offline';
  const install = (deps.installationId ?? installationId)();
  if (install === null) return 'failed';
  await replayPendingDeletes();

  const observer = new MutationObserver(
    getQueryClient(),
    aniSignalsUploadMutationOptions(deps.api ?? getApiClient()),
  );
  let result: UploadResult = 'empty';
  for (let round = 0; round < MAX_BATCHES; round += 1) {
    const pending = niCall([], (ni) => ni.getPendingSignals(BATCH));
    if (pending.length === 0) break;
    const at = (deps.now ?? clockNow)();
    const signals: AniSignal[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const raw of pending) {
      const signal = toUploadSignal(raw);
      if (signal === null || !aniSignalFresh(signal, at) || seen.has(signal.signal_hash)) {
        invalid.push(raw.signal_hash);
        continue;
      }
      seen.add(signal.signal_hash);
      signals.push(signal);
    }
    // A signal the server would reject can never succeed: drop it from the buffer.
    for (const hash of invalid) {
      niCall(undefined, (ni) => {
        ni.deleteSignal(hash);
      });
    }
    if (signals.length === 0) continue;
    const hashes = signals.map((s) => s.signal_hash);
    try {
      await observer.mutate({
        body: { installation_id: install, signals },
        idempotencyKey: batchIdempotencyKey(hashes),
      });
      niCall(undefined, (ni) => {
        ni.markUploaded(hashes);
      });
      result = 'uploaded';
    } catch (error) {
      if (isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED') return 'not_entitled';
      if (isApiError(error) && error.code === 'FEATURE_DISABLED') return 'disabled';
      return 'failed';
    }
  }
  if (result === 'uploaded') {
    void getQueryClient().invalidateQueries({ queryKey: qk.ani.signals() });
  }
  return result;
}
