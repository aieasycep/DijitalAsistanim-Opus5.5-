import { z } from 'zod';
import { IsoDateTime, LocalDate, Money, Sha256Hex, Uuid } from './common.ts';
import { AndroidPackageName } from './devices.ts';
import { Success } from './envelope.ts';

/** Signals older than this are rejected (API-ANI-01 "posted_at within 7 days"). */
export const ANI_MAX_SIGNAL_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One structured, on-device-extracted notification signal. Raw notification text is never uploaded:
 * every string is an enum or length-bounded, and there is no free-text field by design.
 */
export const AniSignal = z.strictObject({
  signal_hash: Sha256Hex,
  package: AndroidPackageName,
  app_label: z.string().max(60),
  category: z.enum(['cargo', 'bank_payment', 'flight', 'reservation', 'other']),
  amount: z.strictObject(Money.shape).optional(),
  due_date: LocalDate.optional(),
  tracking_status: z
    .enum(['created', 'in_transit', 'out_for_delivery', 'delivered', 'exception'])
    .optional(),
  flight_no: z
    .string()
    .regex(/^[A-Z0-9]{2}\d{1,4}$/)
    .optional(),
  gate: z.string().max(6).optional(),
  posted_at: IsoDateTime,
});
export type AniSignal = z.infer<typeof AniSignal>;

// API-ANI-01 · POST /android-notifications/signals
export const AniSignalsBody = z
  .strictObject({
    installation_id: Uuid,
    signals: z.array(AniSignal).min(1).max(200),
  })
  .refine((b) => new Set(b.signals.map((s) => s.signal_hash)).size === b.signals.length, {
    message: 'duplicate_signal_hash',
    path: ['signals'],
  });
export const AniSignalsResponse = Success(
  z.object({ accepted: z.int().min(0), duplicates: z.int().min(0), rejected: z.int().min(0) }),
);

/** `true` when a signal's `posted_at` is within 7 days of `now` (and not in the future beyond 5 min). */
export function aniSignalFresh(signal: Pick<AniSignal, 'posted_at'>, now: Date): boolean {
  const posted = Date.parse(signal.posted_at);
  return posted >= now.getTime() - ANI_MAX_SIGNAL_AGE_MS && posted <= now.getTime() + 5 * 60 * 1000;
}
