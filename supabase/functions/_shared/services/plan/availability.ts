/**
 * Attendee availability for conflict options (API-PLAN-03; KNOWN_PLATFORM_LIMITATIONS KPL-46;
 * M§20, SREQ-20). Availability is only ever what a provider answered: Google `freeBusy.query`
 * (capability `calendar_freebusy`, scope `calendar.events.freebusy`) or Graph `getSchedule`
 * (`Calendars.Read`) through the account that owns the event. Every attendee the provider did not
 * answer for is `unknown` with the provider's reason; nothing is inferred from names, domains or
 * past meetings. Without the capability the options say `scope_missing` and name the account the
 * progressive upgrade needs; device events carry no attendee identities (`device_calendar`).
 *
 * The busy blocks of the answered attendees feed the free-slot finder, so a proposed move is a
 * slot where the user and every answering attendee are free when one exists in the search window.
 */
import {
  type CalendarWindow,
  type FreeBusyAnswer,
  type FreeBusyError,
  ProviderError,
  type BusyInterval,
} from '@da/domain';
import type { Logger } from '../../logging/logger.ts';
import type { MeetingEventRow } from '../assist/store.ts';
import { isServerProvider, providerContextFor } from '../integrations/context.ts';
import type { IntegrationRuntime } from '../integrations/runtime.ts';
import { attendeesOf } from '../meetings/prep.ts';

export type Availability = 'free' | 'busy' | 'unknown';
export type AvailabilityReason =
  | 'checked'
  | 'no_other_attendees'
  | 'partial'
  | 'not_shared'
  | 'scope_missing'
  | 'device_calendar'
  | 'provider_unavailable'
  | 'not_applicable';

export interface AttendeeLine {
  readonly email: string;
  readonly name: string | null;
  readonly status: Availability;
  readonly reason: FreeBusyError | null;
}

export interface OptionAvailability {
  readonly status: Availability;
  readonly reason: AvailabilityReason;
  readonly attendees: readonly AttendeeLine[];
}

export interface AvailabilityUpgrade {
  readonly account_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly capability: 'calendar_freebusy';
}

/** What the provider said about an event's other attendees over a window. */
export interface AttendeeBusy {
  readonly attendees: readonly { readonly email: string; readonly name: string | null }[];
  /** Null when nothing was asked (see `reason`). */
  readonly answers: ReadonlyMap<string, FreeBusyAnswer> | null;
  /** Why nothing was asked; null when the provider answered. */
  readonly reason: Exclude<AvailabilityReason, 'checked' | 'partial' | 'not_shared'> | null;
  readonly upgrade: AvailabilityUpgrade | null;
}

export const NOT_APPLICABLE: OptionAvailability = {
  status: 'unknown',
  reason: 'not_applicable',
  attendees: [],
};

const DEVICE_PROVIDERS: ReadonlySet<string> = new Set(['apple_device', 'android_device']);
const USABLE: ReadonlySet<string> = new Set(['healthy', 'syncing', 'partial']);

export interface AvailabilityDeps {
  readonly rt: IntegrationRuntime | undefined;
  readonly log: Logger;
  readonly correlationId: string;
}

function none(
  attendees: AttendeeBusy['attendees'],
  reason: NonNullable<AttendeeBusy['reason']>,
  upgrade: AvailabilityUpgrade | null = null,
): AttendeeBusy {
  return { attendees, answers: null, reason, upgrade };
}

/** Asks the event's own account for its other attendees' busy blocks over `window`. */
export async function attendeeBusy(
  deps: AvailabilityDeps,
  event: MeetingEventRow,
  window: CalendarWindow,
): Promise<AttendeeBusy> {
  if (DEVICE_PROVIDERS.has(event.provider)) {
    return none([], event.attendee_count > 1 ? 'device_calendar' : 'no_other_attendees');
  }
  const rt = deps.rt;
  const account = rt === undefined ? null : await rt.store.getAccount(event.connected_account_id);
  // Rows synced before attendee `self` was stored are recognised by the account's own address.
  const own = account?.account_email?.toLowerCase() ?? null;
  const attendees = attendeesOf(event)
    .filter((a) => a.email !== own)
    .slice(0, 20);
  if (attendees.length === 0) return none([], 'no_other_attendees');
  if (rt === undefined) return none(attendees, 'provider_unavailable');
  if (account === null || !isServerProvider(account.provider) || !USABLE.has(account.status)) {
    return none(attendees, 'provider_unavailable');
  }
  if (!account.capabilities_granted.includes('calendar_freebusy')) {
    const provider =
      account.provider === 'demo' ? (account.demo_flavor ?? 'google') : account.provider;
    return none(attendees, 'scope_missing', {
      account_id: account.id,
      provider,
      capability: 'calendar_freebusy',
    });
  }
  const adapter = rt.providers.resolve(account.provider).calendar;
  if (adapter?.freeBusy === undefined) return none(attendees, 'provider_unavailable');
  try {
    const ctx = await providerContextFor(rt, account, {
      owner: `freebusy:${deps.correlationId}`,
      correlationId: deps.correlationId,
      log: deps.log,
    });
    const answers = await adapter.freeBusy(ctx, {
      emails: attendees.map((a) => a.email),
      window,
    });
    return {
      attendees,
      answers: new Map(answers.map((a) => [a.email.toLowerCase(), a] as const)),
      reason: null,
      upgrade: null,
    };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'scope_missing') {
      const provider =
        account.provider === 'demo' ? (account.demo_flavor ?? 'google') : account.provider;
      return none(attendees, 'scope_missing', {
        account_id: account.id,
        provider,
        capability: 'calendar_freebusy',
      });
    }
    deps.log.warn('freebusy_unavailable', {
      provider: account.provider,
      error_code: error instanceof ProviderError ? error.code : 'unknown',
      error_kind: error instanceof Error ? error.name : typeof error,
    });
    return none(attendees, 'provider_unavailable');
  }
}

/** `busy` minus the interval that is being vacated (the moved event's own time). */
export function subtractInterval(
  busy: readonly CalendarWindow[],
  vacated: CalendarWindow | null,
): CalendarWindow[] {
  if (vacated === null) return [...busy];
  const vs = Date.parse(vacated.start);
  const ve = Date.parse(vacated.end);
  const out: CalendarWindow[] = [];
  for (const b of busy) {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    if (be <= vs || bs >= ve) {
      out.push(b);
      continue;
    }
    if (bs < vs) out.push({ start: b.start, end: new Date(vs).toISOString() });
    if (be > ve) out.push({ start: new Date(ve).toISOString(), end: b.end });
  }
  return out;
}

/** Busy intervals of the answering attendees for the slot finder. */
export function attendeeBusyIntervals(
  info: AttendeeBusy,
  vacated: CalendarWindow | null,
): BusyInterval[] {
  if (info.answers === null) return [];
  const out: BusyInterval[] = [];
  for (const answer of info.answers.values()) {
    if (answer.error !== null) continue;
    for (const b of subtractInterval(answer.busy, vacated))
      out.push({ start: b.start, end: b.end });
  }
  return out;
}

/** Each attendee's availability for `slot` and the option's overall status. */
export function availabilityAt(
  info: AttendeeBusy,
  slot: CalendarWindow,
  vacated: CalendarWindow | null,
): OptionAvailability {
  if (info.reason !== null || info.answers === null) {
    const reason = info.reason ?? 'provider_unavailable';
    return {
      status: reason === 'no_other_attendees' ? 'free' : 'unknown',
      reason,
      attendees: info.attendees.map((a) => ({
        email: a.email,
        name: a.name,
        status: 'unknown',
        reason: null,
      })),
    };
  }
  const answers = info.answers;
  const s = Date.parse(slot.start);
  const e = Date.parse(slot.end);
  const lines: AttendeeLine[] = info.attendees.map((a) => {
    const answer = answers.get(a.email);
    if (answer === undefined) return { ...a, status: 'unknown', reason: 'unavailable' };
    if (answer.error !== null) return { ...a, status: 'unknown', reason: answer.error };
    const busy = subtractInterval(answer.busy, vacated).some(
      (b) => Date.parse(b.start) < e && Date.parse(b.end) > s,
    );
    return { ...a, status: busy ? 'busy' : 'free', reason: null };
  });
  const answered = lines.filter((l) => l.status !== 'unknown');
  if (lines.some((l) => l.status === 'busy')) {
    return {
      status: 'busy',
      reason: answered.length === lines.length ? 'checked' : 'partial',
      attendees: lines,
    };
  }
  if (answered.length === lines.length)
    return { status: 'free', reason: 'checked', attendees: lines };
  if (answered.length > 0) return { status: 'unknown', reason: 'partial', attendees: lines };
  const shared = lines.every((l) => l.reason === 'not_shared' || l.reason === 'not_found');
  return {
    status: 'unknown',
    reason: shared ? 'not_shared' : 'provider_unavailable',
    attendees: lines,
  };
}
