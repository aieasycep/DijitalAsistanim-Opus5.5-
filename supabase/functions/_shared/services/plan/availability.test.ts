/**
 * Attendee availability of conflict options (API-PLAN-03; KNOWN_PLATFORM_LIMITATIONS KPL-46):
 * only a provider answer makes an attendee free or busy; the scope, device and provider cases say
 * why the availability is unknown; the moved event's own time never counts against its move.
 */
import { assert, assertEquals } from '@std/assert';
import { type FreeBusyAnswer, ProviderError } from '@da/domain';
import { createLogger } from '../../logging/logger.ts';
import { activeDemoAccount, integrationHarness } from '../../testing/integrations.ts';
import { PEOPLE } from '../../providers/demo/fixtures/index.ts';
import type { MeetingEventRow } from '../assist/store.ts';
import type { IntegrationRuntime } from '../integrations/runtime.ts';
import {
  type AttendeeBusy,
  attendeeBusy,
  attendeeBusyIntervals,
  availabilityAt,
  NOT_APPLICABLE,
  subtractInterval,
} from './availability.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const log = createLogger({ fn: 'api', sink: () => {} });
const WINDOW = { start: '2026-09-24T09:00:00.000Z', end: '2026-10-01T09:00:00.000Z' };

function event(overrides: Partial<MeetingEventRow> = {}): MeetingEventRow {
  return {
    id: 'e1',
    user_id: USER,
    connected_account_id: 'acct',
    calendar_id: 'cal',
    provider: 'demo',
    title: 'Müşteri toplantısı',
    start_at: '2026-09-24T10:00:00.000Z',
    end_at: '2026-09-24T11:00:00.000Z',
    all_day: false,
    status: 'confirmed',
    location: null,
    is_online: false,
    organizer_self: true,
    can_modify: true,
    attendees: [
      { email: 'yunus@gmail.com', self: true, response: 'accepted' },
      { email: PEOPLE.mehmet.email, name: 'Mehmet Yılmaz', response: 'accepted' },
      { email: 'yabanci@ornek.com', name: null, response: 'needs_action' },
      { email: 'reddetti@ornek.com', name: null, response: 'declined' },
    ],
    attendee_count: 4,
    description_excerpt: null,
    updated_at: '2026-09-23T10:00:00.000Z',
    conference_url: null,
    organizer_email: 'yunus@gmail.com',
    ...overrides,
  };
}

function info(answers: FreeBusyAnswer[], attendees = answers.map((a) => a.email)): AttendeeBusy {
  return {
    attendees: attendees.map((email) => ({ email, name: null })),
    answers: new Map(answers.map((a) => [a.email, a])),
    reason: null,
    upgrade: null,
  };
}

Deno.test(
  'availability: device events and events without other attendees need no lookup',
  async () => {
    const deps = { rt: undefined, log, correlationId: 'c' };
    const device = await attendeeBusy(
      deps,
      event({ provider: 'apple_device', attendees: [] }),
      WINDOW,
    );
    assertEquals([device.reason, device.answers], ['device_calendar', null]);
    const solo = await attendeeBusy(
      deps,
      event({ provider: 'android_device', attendees: [], attendee_count: 1 }),
      WINDOW,
    );
    assertEquals(solo.reason, 'no_other_attendees');
    const alone = await attendeeBusy(
      deps,
      event({ attendees: [{ email: 'yunus@gmail.com', self: true }] }),
      WINDOW,
    );
    assertEquals(alone.reason, 'no_other_attendees');
    assertEquals(availabilityAt(alone, WINDOW, null).status, 'free');
    const offline = await attendeeBusy(deps, event(), WINDOW);
    assertEquals(offline.reason, 'provider_unavailable');
    assertEquals(
      offline.attendees.map((a) => a.email),
      [PEOPLE.mehmet.email, 'yabanci@ornek.com'],
      'the user and declined attendees are never asked about',
    );
    assertEquals(availabilityAt(offline, WINDOW, null).attendees.length, 2);
  },
);

Deno.test(
  'availability: without the calendar_freebusy grant the upgrade names the account',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, { userId: USER, flavor: 'microsoft' });
    const out = await attendeeBusy(
      { rt: h.runtime, log, correlationId: 'c' },
      event({ connected_account_id: account.id }),
      WINDOW,
    );
    assertEquals(out.reason, 'scope_missing');
    assertEquals(out.upgrade, {
      account_id: account.id,
      provider: 'microsoft',
      capability: 'calendar_freebusy',
    });
    const view = availabilityAt(out, WINDOW, null);
    assertEquals([view.status, view.reason], ['unknown', 'scope_missing']);
    const gone = await attendeeBusy(
      { rt: h.runtime, log, correlationId: 'c' },
      event({ connected_account_id: crypto.randomUUID() }),
      WINDOW,
    );
    assertEquals(gone.reason, 'provider_unavailable');
  },
);

Deno.test(
  'availability: a demo grant answers demo people and not_shared for everyone else',
  async () => {
    const h = await integrationHarness();
    const account = await activeDemoAccount(h, {
      userId: USER,
      capabilities: ['calendar_read', 'calendar_freebusy'],
      status: 'healthy',
    });
    const out = await attendeeBusy(
      { rt: h.runtime, log, correlationId: 'c' },
      event({ connected_account_id: account.id }),
      WINDOW,
    );
    assertEquals(out.reason, null);
    const mehmet = out.answers?.get(PEOPLE.mehmet.email);
    assert(mehmet !== undefined && mehmet.error === null);
    assertEquals(out.answers?.get('yabanci@ornek.com')?.error, 'not_shared');
    const busy = mehmet.busy[0];
    assert(busy !== undefined, 'Mehmet attends the demo customer meeting inside the window');
    const during = availabilityAt(out, busy, null);
    assertEquals([during.status, during.reason], ['busy', 'partial']);
  },
);

Deno.test('availability: provider failures never fail the options', async () => {
  const h = await integrationHarness();
  const account = await activeDemoAccount(h, {
    userId: USER,
    capabilities: ['calendar_read', 'calendar_freebusy'],
    status: 'healthy',
  });
  const failing = (error: Error): IntegrationRuntime => ({
    ...h.runtime,
    providers: {
      available: () => ['demo'],
      resolve: () =>
        ({
          oauth: {},
          calendar: { freeBusy: () => Promise.reject(error) },
        }) as never,
    },
  });
  const scope = await attendeeBusy(
    { rt: failing(new ProviderError('scope_missing', 403)), log, correlationId: 'c' },
    event({ connected_account_id: account.id }),
    WINDOW,
  );
  assertEquals([scope.reason, scope.upgrade?.provider], ['scope_missing', 'google']);
  const down = await attendeeBusy(
    { rt: failing(new ProviderError('provider_unavailable', 503)), log, correlationId: 'c' },
    event({ connected_account_id: account.id }),
    WINDOW,
  );
  assertEquals(down.reason, 'provider_unavailable');
  const noAdapter = await attendeeBusy(
    {
      rt: { ...h.runtime, providers: { available: () => ['demo'], resolve: () => ({}) as never } },
      log,
      correlationId: 'c',
    },
    event({ connected_account_id: account.id }),
    WINDOW,
  );
  assertEquals(noAdapter.reason, 'provider_unavailable');
});

Deno.test(
  'availability: statuses from answers (free, busy, partial, not shared, unavailable)',
  () => {
    const slot = { start: '2026-09-25T12:00:00.000Z', end: '2026-09-25T13:00:00.000Z' };
    const free = { email: 'a@x.com', busy: [], error: null };
    const busy = {
      email: 'b@x.com',
      busy: [{ start: '2026-09-25T12:30:00.000Z', end: '2026-09-25T14:00:00.000Z' }],
      error: null,
    };
    const hidden = { email: 'c@y.com', busy: [], error: 'not_shared' as const };
    const lost = { email: 'd@y.com', busy: [], error: 'unavailable' as const };
    assertEquals(availabilityAt(info([free]), slot, null).reason, 'checked');
    assertEquals(availabilityAt(info([free]), slot, null).status, 'free');
    const b = availabilityAt(info([free, busy]), slot, null);
    assertEquals([b.status, b.reason], ['busy', 'checked']);
    assertEquals(
      b.attendees.map((a) => a.status),
      ['free', 'busy'],
    );
    assertEquals(availabilityAt(info([busy, hidden]), slot, null).reason, 'partial');
    assertEquals(availabilityAt(info([free, hidden]), slot, null).status, 'unknown');
    assertEquals(availabilityAt(info([free, hidden]), slot, null).reason, 'partial');
    assertEquals(availabilityAt(info([hidden]), slot, null).reason, 'not_shared');
    assertEquals(availabilityAt(info([hidden, lost]), slot, null).reason, 'provider_unavailable');
    // An attendee the provider did not answer for at all is unknown, never free.
    const missing = availabilityAt(info([free], ['a@x.com', 'z@x.com']), slot, null);
    assertEquals(missing.attendees[1], {
      email: 'z@x.com',
      name: null,
      status: 'unknown',
      reason: 'unavailable',
    });
    // The moved meeting's own time does not make its attendees busy for its new slot.
    const own = { start: '2026-09-25T12:30:00.000Z', end: '2026-09-25T14:00:00.000Z' };
    assertEquals(availabilityAt(info([busy]), slot, own).status, 'free');
    assertEquals(NOT_APPLICABLE.reason, 'not_applicable');
  },
);

Deno.test('availability: vacated time is cut out of busy blocks for the slot finder', () => {
  const busy = [
    { start: '2026-09-25T09:00:00.000Z', end: '2026-09-25T12:00:00.000Z' },
    { start: '2026-09-25T13:00:00.000Z', end: '2026-09-25T14:00:00.000Z' },
  ];
  assertEquals(
    subtractInterval(busy, { start: '2026-09-25T10:00:00.000Z', end: '2026-09-25T11:00:00.000Z' }),
    [
      { start: '2026-09-25T09:00:00.000Z', end: '2026-09-25T10:00:00.000Z' },
      { start: '2026-09-25T11:00:00.000Z', end: '2026-09-25T12:00:00.000Z' },
      busy[1],
    ],
  );
  assertEquals(subtractInterval(busy, null), busy);
  assertEquals(
    subtractInterval(busy, { start: '2026-09-25T08:00:00.000Z', end: '2026-09-25T15:00:00.000Z' }),
    [],
  );
  const intervals = attendeeBusyIntervals(
    info([
      { email: 'a@x.com', busy, error: null },
      { email: 'b@x.com', busy, error: 'not_shared' },
    ]),
    { start: '2026-09-25T13:00:00.000Z', end: '2026-09-25T14:00:00.000Z' },
  );
  assertEquals(intervals, [busy[0]]);
  assertEquals(
    attendeeBusyIntervals(
      { attendees: [], answers: null, reason: 'scope_missing', upgrade: null },
      null,
    ),
    [],
  );
});
