/**
 * T-8.16 Person (M-PERSON-01) and VIP (M-VIP-01): RPC-12 `person_intelligence` with the locked
 * sections behind one gate, making a person VIP from the chip (`vip_people` insert), the VIP list
 * with remove + undo, and the Pro suggestion accepted with `origin: suggestion`.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { resetAppState } from './helpers/app';
import { M3 } from './helpers/assist';
import { TS } from './helpers/fixtures';
import { events, openApp, proBootstrap } from './helpers/journeys';

function person(overrides: Record<string, unknown> = {}) {
  return {
    contact: {
      id: M3.contact,
      display_name: 'Mehmet Yılmaz',
      primary_email: 'mehmet@example.com',
      organization: 'Acme',
      title: null,
    },
    is_vip: false,
    relationship: null,
    last_contact_at: TS,
    upcoming_meetings: [],
    related_emails: [
      {
        thread_id: M3.message,
        subject: 'Teklif revizyonu',
        ai_summary: 'Fiyat güncellemesi istiyor.',
        last_message_at: TS,
      },
    ],
    recent_topics: ['Teklif'],
    open_loops: [],
    user_owes: [],
    they_owe: [],
    locked_sections: ['open_loops', 'user_owes', 'they_owe'],
    ...overrides,
  };
}

function vipRow() {
  return {
    id: M3.vip,
    contact_id: M3.contact,
    relationship: 'key_client',
    always_notify: true,
    bypass_quiet_hours: true,
    origin: 'user',
    created_at: TS,
    contacts: {
      display_name: 'Mehmet Yılmaz',
      primary_email: 'mehmet@example.com',
      organization: 'Acme',
    },
  };
}

beforeEach(async () => {
  await resetAppState();
});

describe('Person (M-PERSON-01)', () => {
  it('renders the intelligence, gates the locked sections and makes the person VIP', async () => {
    const { db } = await openApp({
      path: `/person/${M3.contact}?origin=search`,
      setup: (fake) => {
        fake.setRpc('person_intelligence', person());
      },
    });
    expect(await screen.findByText('Mehmet Yılmaz')).toBeOnTheScreen();
    expect(screen.getByText('Teklif revizyonu')).toBeOnTheScreen();
    expect(screen.getByTestId('person.gate')).toBeOnTheScreen();
    expect(screen.queryByTestId('person.openLoops')).toBeNull();
    expect(events('person_opened')[0]?.props).toEqual({ origin: 'search', is_vip: false });

    await fireEvent.press(screen.getByTestId('person.vipChip'));
    await fireEvent.press(await screen.findByTestId('vipEdit.save'));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'vip_people')?.values).toMatchObject({
        contact_id: M3.contact,
        origin: 'user',
      });
    });
    expect(events('vip_added')[0]?.props).toEqual({ origin: 'manual' });
  });

  it('shows not-found when the contact is gone', async () => {
    await openApp({
      path: `/person/${M3.contact2}`,
      setup: (fake) => {
        fake.setRpc('person_intelligence', null);
      },
    });
    expect(await screen.findByTestId('person.notFound')).toBeOnTheScreen();
  });
});

describe('VIP (M-VIP-01)', () => {
  it('removes a VIP from the star and restores it with undo', async () => {
    const { db } = await openApp({
      path: '/vip',
      setup: (fake) => {
        fake.setTable('vip_people', [vipRow()]);
      },
    });
    expect(await screen.findByTestId(`vip.row.${M3.vip}`)).toBeOnTheScreen();
    expect(screen.getByTestId('vip.gate')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`vip.star.${M3.vip}`));
    await waitFor(() => {
      expect(db.writes.some((w) => w.table === 'vip_people' && w.op === 'delete')).toBe(true);
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(db.writes.some((w) => w.table === 'vip_people' && w.op === 'insert')).toBe(true);
    });
    expect(events('vip_removed')).toHaveLength(1);
  });

  it('accepts a Pro suggestion as a VIP', async () => {
    const { db } = await openApp({
      data: proBootstrap(),
      path: '/vip',
      setup: (fake) => {
        fake.setTable('vip_people', []);
        fake.setRpc('vip_suggestions', [
          {
            contact_id: M3.contact2,
            display_name: 'Ayşe Demir',
            primary_email: 'ayse@example.com',
            organization: null,
            exchanges_30d: 12,
          },
        ]);
      },
    });
    expect(await screen.findByTestId('vip.suggestion')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('vip.suggestion.yes'));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'vip_people')?.values).toMatchObject({
        contact_id: M3.contact2,
        origin: 'suggestion',
      });
    });
    expect(events('vip_suggestion_shown')).toHaveLength(1);
    expect(events('vip_added')[0]?.props).toEqual({ origin: 'suggestion' });
  });
});
