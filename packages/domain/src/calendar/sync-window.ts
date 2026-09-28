/**
 * The rolling window of calendar events each provider keeps in the database (INTEGRATION_PLAN
 * §3.7, JOB-01; KNOWN_PLATFORM_LIMITATIONS KPL-36/KPL-40). The Edge calendar sync
 * (`calendarWindow`) and the device-calendar snapshot use these bounds; Plan shows the
 * "outside the sync window" note for dates past them.
 */
import type { Provider } from '../enums.ts';

const DAY_MS = 86_400_000;

/** Days kept before and after "now" per provider. */
export const CALENDAR_SYNC_WINDOW_DAYS: Readonly<
  Record<Provider, { readonly before: number; readonly after: number }>
> = {
  google: { before: 30, after: 365 },
  microsoft: { before: 2, after: 60 },
  demo: { before: 7, after: 30 },
  apple_device: { before: 1, after: 14 },
  android_device: { before: 1, after: 14 },
};

export interface CalendarSyncWindow {
  readonly start: Date;
  readonly end: Date;
}

export function calendarSyncWindow(provider: Provider, now: Date): CalendarSyncWindow {
  const days = CALENDAR_SYNC_WINDOW_DAYS[provider];
  const t = now.getTime();
  return { start: new Date(t - days.before * DAY_MS), end: new Date(t + days.after * DAY_MS) };
}

/**
 * Whether a future day lies wholly past the window of any of the providers: `dayStart` is the
 * start of that day in the user's zone. Past days are not flagged; their events stay stored.
 */
export function beyondSyncWindow(
  providers: readonly Provider[],
  dayStart: Date,
  now: Date,
): boolean {
  return providers.some((provider) => dayStart >= calendarSyncWindow(provider, now).end);
}
