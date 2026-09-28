/**
 * T-8.16 · M-PERSON-01 Kişi, M-VIP-01 Önemli Kişiler, M-VIP-02 Kişi Ekle and M-VIP-03 VIP Ayarı
 * (SCREEN_AND_FLOW_MAP; RPC-12 `person_intelligence`, RPC-13 `vip_suggestions`, RPC-23
 * `upsert_manual_contact`, `vip_people` through the `vip_set` queue): unlocked sections routing to
 * their sources, resolving an open loop with undo (and its failure), asking about the person, the
 * error and offline states; the VIP groups, editing a VIP (relationship, "Her zaman bildir",
 * "Sessiz saatlerde bile" with the global switch off), removing, the Free limit, the picker with
 * recent contacts / no match / a new address, dismissing a suggestion and offline writes.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { renderApp, resetAppState } from '../helpers/app';
import { M3 } from '../helpers/assist';
import { bootstrap, TS, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { setup } from '../m2/harness';
import { back } from './support';

const MEETING = uuid(2300);
const LOOP = uuid(2301);
const OWE = uuid(2302);
const THEY = uuid(2303);

function person(overrides: Record<string, unknown> = {}) {
  return {
    contact: {
      id: M3.contact,
      display_name: 'Mehmet Yılmaz',
      primary_email: 'mehmet@acme.com',
      organization: null,
      title: null,
    },
    is_vip: true,
    relationship: 'key_client',
    last_contact_at: TS,
    upcoming_meetings: [
      { id: MEETING, title: 'Teklif görüşmesi', start_at: '2026-09-25T09:00:00Z' },
    ],
    related_emails: [
      { thread_id: uuid(2304), subject: 'Teklif v2', ai_summary: null, last_message_at: TS },
    ],
    recent_topics: ['Teklif'],
    open_loops: [{ insight_id: LOOP, title: 'Fiyat onayı bekleniyor', due_at: TS }],
    user_owes: [{ id: OWE, text: 'Teklifi gönder', due_at: null }],
    they_owe: [{ id: THEY, text: 'Sözleşmeyi imzalayacak', due_at: TS }],
    locked_sections: [],
    ...overrides,
  };
}

function vipRow(
  n: number,
  relationship: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: uuid(n),
    contact_id: uuid(n + 50),
    relationship,
    always_notify: true,
    bypass_quiet_hours: true,
    origin: 'user',
    created_at: TS,
    contacts: { display_name: name, primary_email: `${String(n)}@example.com`, organization: null },
    ...overrides,
  };
}

async function openPerson(extra?: (db: PostgrestFake) => void, data = proBootstrap()) {
  const opened = await openApp({
    data,
    path: `/person/${M3.contact}?origin=vip`,
    setup: (db) => {
      db.setRpc('person_intelligence', person());
      db.setTable('vip_people', [
        vipRow(2310, 'key_client', 'Mehmet Yılmaz', { contact_id: M3.contact }),
      ]);
      extra?.(db);
    },
  });
  await screen.findByTestId('person.openLoops');
  return opened;
}

async function openVip(
  rows: readonly Record<string, unknown>[],
  extra?: (db: PostgrestFake) => void,
  data = proBootstrap(),
) {
  const opened = await openApp({
    data,
    path: '/vip',
    setup: (db) => {
      db.setTable('vip_people', rows);
      db.setTable('contacts', [
        {
          id: uuid(2320),
          display_name: 'Ayşe Kaya',
          primary_email: 'ayse@example.com',
          organization: null,
          merged_into_id: null,
        },
        {
          id: uuid(2321),
          display_name: 'Zeynep Ak',
          primary_email: 'zeynep@example.com',
          organization: null,
          merged_into_id: null,
        },
      ]);
      extra?.(db);
    },
  });
  await screen.findByTestId('screen.vip');
  return opened;
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-PERSON-01 · Kişi', () => {
  it('shows every unlocked section and resolves an open loop with undo', async () => {
    const { db } = await openPerson((fake) => {
      fake.setRpc('set_insight_status', null);
    });
    expect(screen.getByText('acme.com')).toBeOnTheScreen();
    expect(screen.getByTestId('person.vipChip')).toHaveTextContent('VIP · Önemli müşteri');
    expect(screen.getByTestId('person.meetings')).toHaveTextContent(/Teklif görüşmesi/);
    expect(screen.getByTestId('person.userOwes')).toHaveTextContent(/Teklifi gönder/);
    expect(screen.getByTestId('person.theyOwe')).toHaveTextContent(/Sözleşmeyi imzalayacak/);
    expect(screen.getByTestId('person.topics')).toHaveTextContent(/Teklif/);
    expect(screen.getByTestId('person.allMail')).toHaveTextContent('Tüm mailleri gör (1)');
    expect(events('person_opened').at(-1)?.props).toEqual({ origin: 'vip', is_vip: true });

    await fireEvent.press(screen.getByText('Fiyat onayı bekleniyor'));
    await waitFor(() => {
      expect(db.rpcCalls.find((c) => c.name === 'set_insight_status')?.args).toEqual({
        p_insight_id: LOOP,
        p_status: 'done',
      });
    });
    await fireEvent.press(await screen.findByText('Geri al'));
    await waitFor(() => {
      expect(db.rpcCalls.filter((c) => c.name === 'set_insight_status').at(-1)?.args).toEqual({
        p_insight_id: LOOP,
        p_status: 'open',
      });
    });
  });

  it('reports a failed resolve', async () => {
    await openPerson((fake) => {
      fake.setRpc('set_insight_status', () => ({ data: null, error: { message: 'FORBIDDEN' } }));
    });
    await fireEvent.press(screen.getByText('Fiyat onayı bekleniyor'));
    expect(await screen.findByText('Kaydedilemedi. Tekrar dene.')).toBeOnTheScreen();
  });

  it.each([
    ['the meeting row', () => screen.getByText('Teklif görüşmesi'), `/event/${MEETING}`, null],
    [
      'what the user owes',
      () => screen.getByText('Teklifi gönder'),
      `/commitments/${OWE}`,
      'commitments',
    ],
    [
      'what they owe',
      () => screen.getByText('Sözleşmeyi imzalayacak'),
      `/commitments/${THEY}`,
      null,
    ],
    ['all mail', () => screen.getByTestId('person.allMail'), '/search', 'emails'],
  ])('opens %s', async (_name, target, path, section) => {
    const { router } = await openPerson();
    await fireEvent.press(target());
    await waitFor(() => {
      expect(router.getPathname()).toBe(path);
    });
    if (section !== null) {
      expect(events('person_section_opened').at(-1)?.props).toEqual({ section });
    }
  });

  it('asks about the person in a new chat, by text or by voice', async () => {
    const { router } = await openPerson();
    await fireEvent.changeText(screen.getByTestId('ui.chatComposer.input'), 'Son teklif ne oldu?');
    await fireEvent.press(screen.getByTestId('ui.chatComposer.send'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/chat/new');
    });
    expect(router.getSearchParams()).toMatchObject({
      contactId: M3.contact,
      prompt: 'Son teklif ne oldu?',
      origin: 'person',
    });
    expect(events('person_ask_submitted').at(-1)?.props).toEqual({ input_mode: 'text' });
    await back();
    await fireEvent.press(await screen.findByTestId('ui.chatComposer.mic'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/voice');
    });
    expect(events('person_ask_submitted').at(-1)?.props).toEqual({ input_mode: 'voice' });
  });

  it('edits the VIP settings from the chip and removes the VIP', async () => {
    const { db } = await openPerson();
    await fireEvent.press(screen.getByTestId('person.vipChip'));
    const sheet = await screen.findByTestId('sheet.vipEdit');
    expect(within(sheet).getByTestId('vipEdit.rel.key_client')).toBeChecked();
    await fireEvent.press(within(sheet).getByTestId('vipEdit.rel.manager'));
    await fireEvent.press(within(sheet).getByTestId('vipEdit.alwaysNotify'));
    await fireEvent.press(within(sheet).getByTestId('vipEdit.bypassQuiet'));
    await fireEvent.press(within(sheet).getByTestId('vipEdit.save'));
    await waitFor(() => {
      expect(events('vip_updated').map((e) => e.props.field)).toEqual([
        'relationship',
        'always_notify',
        'bypass_quiet_hours',
      ]);
    });
    expect(db.writes.find((w) => w.table === 'vip_people')?.values).toMatchObject({
      contact_id: M3.contact,
      relationship: 'manager',
      always_notify: false,
      bypass_quiet_hours: false,
    });
    expect(await screen.findByText('Kaydedildi')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('person.vipChip'));
    await fireEvent.press(await screen.findByTestId('vipEdit.remove'));
    await waitFor(() => {
      expect(db.writes.some((w) => w.table === 'vip_people' && w.op === 'delete')).toBe(true);
    });
    expect(events('vip_removed')).toHaveLength(1);
  });

  it('shows the error with retry and the offline composer', async () => {
    const { db } = await openApp({
      data: proBootstrap(),
      path: `/person/${M3.contact}`,
      setup: (fake) => {
        fake.setRpc('person_intelligence', () => ({ data: null, error: { message: 'FORBIDDEN' } }));
      },
    });
    expect(await screen.findByTestId('person.error')).toBeOnTheScreen();
    db.setRpc('person_intelligence', person({ upcoming_meetings: [], related_emails: [] }));
    await fireEvent.press(screen.getByText('Tekrar Dene'));
    expect(await screen.findByTestId('person.openLoops')).toBeOnTheScreen();
    expect(screen.queryByTestId('person.meetings')).toBeNull();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(await screen.findByText('İnternet bağlantısı yok.')).toBeOnTheScreen();
    expect(screen.getByTestId('ui.chatComposer.input')).toBeDisabled();
  });
});

describe('M-VIP-01…03 · Önemli Kişiler', () => {
  it('groups the VIPs, opens a person and changes a group', async () => {
    const { router, db } = await openVip([
      vipRow(2330, 'spouse', 'Elif'),
      vipRow(2331, 'manager', 'Kaan', { always_notify: false }),
      vipRow(2332, 'friend', 'Deniz'),
    ]);
    expect(await screen.findByTestId('vip.group.family')).toHaveTextContent(/Elif/);
    expect(screen.getByTestId('vip.group.manager')).toHaveTextContent(/Kaan/);
    expect(screen.getByTestId('vip.group.friend')).toHaveTextContent(/Deniz/);
    expect(events('vip_list_viewed').at(-1)?.props).toEqual({ count_bucket: '2-5' });
    await fireEvent.press(screen.getByTestId(`vip.edit.${uuid(2331)}`));
    const sheet = await screen.findByTestId('sheet.vipEdit');
    await fireEvent.press(within(sheet).getByTestId('vipEdit.rel.key_client'));
    await fireEvent.press(within(sheet).getByTestId('vipEdit.save'));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'vip_people')?.values).toMatchObject({
        contact_id: uuid(2381),
        relationship: 'key_client',
      });
    });
    await fireEvent.press(screen.getByTestId(`vip.row.${uuid(2330)}`));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/person/${uuid(2380)}`);
    });
  });

  it('adds a recent contact from the empty state', async () => {
    const { db } = await openVip([]);
    await fireEvent.press(within(await screen.findByTestId('vip.empty')).getByText('Kişi Ekle'));
    const picker = await screen.findByTestId('sheet.contactPicker');
    expect(
      await within(picker).findByText('Son yazıştıkların'.toLocaleUpperCase('tr-TR')),
    ).toBeOnTheScreen();
    await fireEvent.press(within(picker).getByTestId(`picker.contact.${uuid(2320)}`));
    const sheet = await screen.findByTestId('sheet.vipEdit');
    expect(within(sheet).getByText('Ayşe Kaya')).toBeOnTheScreen();
    await fireEvent.press(within(sheet).getByTestId('vipEdit.save'));
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'vip_people')?.values).toMatchObject({
        contact_id: uuid(2320),
        origin: 'user',
      });
    });
    expect(events('vip_picker_opened')).toHaveLength(1);
    expect(events('vip_added').at(-1)?.props).toEqual({ origin: 'manual' });
  });

  it('searches the picker and adds a new address through upsert_manual_contact', async () => {
    const { db } = await openVip(
      [vipRow(2333, 'other', 'Zeynep Ak', { contact_id: uuid(2321) })],
      (fake) => {
        fake.setRpc('upsert_manual_contact', uuid(2322));
      },
    );
    await fireEvent.press(await screen.findByTestId('vip.add'));
    const picker = await screen.findByTestId('sheet.contactPicker');
    // An existing VIP is not offered again.
    await within(picker).findByTestId(`picker.contact.${uuid(2320)}`);
    expect(within(picker).queryByTestId(`picker.contact.${uuid(2321)}`)).toBeNull();
    await fireEvent.changeText(within(picker).getByTestId('picker.search'), 'yok');
    expect(await within(picker).findByText('Kişi bulunamadı.')).toBeOnTheScreen();
    await fireEvent.changeText(within(picker).getByTestId('picker.search'), 'Can@Example.com');
    await fireEvent.changeText(await within(picker).findByTestId('picker.manualName'), 'Can Er');
    await fireEvent.press(within(picker).getByTestId('picker.manual'));
    await waitFor(() => {
      expect(db.rpcCalls.find((c) => c.name === 'upsert_manual_contact')?.args).toEqual({
        p_email: 'can@example.com',
        p_display_name: 'Can Er',
      });
    });
    const sheet = await screen.findByTestId('sheet.vipEdit');
    expect(within(sheet).getByText('Can Er')).toBeOnTheScreen();
    expect(events('vip_picker_manual_email_used')).toHaveLength(1);
  });

  it('shows the Free limit card and opens the Pro gate', async () => {
    const { db } = await openVip([vipRow(2334, 'other', 'Deniz')], undefined, bootstrap());
    db.failWrites('vip_people', 'PLAN_LIMIT:vip_max');
    await fireEvent.press(await screen.findByTestId(`vip.edit.${uuid(2334)}`));
    const sheet = await screen.findByTestId('sheet.vipEdit');
    expect(within(sheet).getByTestId('vipEdit.proHint')).toBeOnTheScreen();
    await fireEvent.press(within(sheet).getByTestId('vipEdit.rel.friend'));
    await fireEvent.press(within(sheet).getByTestId('vipEdit.save'));
    expect(await screen.findByTestId('vipEdit.limit')).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByTestId('vipEdit.limit')).getByText("Pro'yu Gör"));
    expect(await screen.findByTestId('sheet.proGate')).toBeOnTheScreen();
  });

  it('reports a failed save in the sheet and a failed removal as a toast', async () => {
    const { db } = await openVip([vipRow(2335, 'other', 'Deniz')]);
    db.failWrites('vip_people', 'FORBIDDEN');
    await fireEvent.press(await screen.findByTestId(`vip.edit.${uuid(2335)}`));
    await fireEvent.press(
      within(await screen.findByTestId('sheet.vipEdit')).getByTestId('vipEdit.rel.friend'),
    );
    await fireEvent.press(screen.getByTestId('vipEdit.save'));
    expect(
      await within(screen.getByTestId('sheet.vipEdit')).findByText('Kaydedilemedi. Tekrar dene.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('vipEdit.remove'));
    expect(await screen.findByText('Kaydedilemedi. Tekrar dene.')).toBeOnTheScreen();
  });

  it('points to the notification settings when the global VIP bypass is off', async () => {
    const data = proBootstrap();
    const { router } = await openVip([vipRow(2336, 'other', 'Deniz')], undefined, {
      ...data,
      notification_preferences: { ...data.notification_preferences, vip_bypass_quiet: false },
    });
    await fireEvent.press(await screen.findByTestId(`vip.edit.${uuid(2336)}`));
    const sheet = await screen.findByTestId('sheet.vipEdit');
    expect(within(sheet).getByTestId('vipEdit.bypassQuiet')).toBeDisabled();
    await fireEvent.press(within(sheet).getByText('Bildirim ayarlarına git'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/settings/notifications');
    });
  });

  it('dismisses a suggestion as feedback', async () => {
    const { db } = await openVip([vipRow(2337, 'other', 'Deniz')], (fake) => {
      fake.setRpc('vip_suggestions', [
        {
          contact_id: M3.contact2,
          display_name: 'Ayşe Demir',
          primary_email: 'ayse@example.com',
          organization: null,
          exchanges_30d: 12,
        },
      ]);
    });
    expect(
      await screen.findByText(
        'Öneri: Ayşe Demir ile son 30 günde 12 kez yazıştın. VIP yapayım mı?',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('vip.suggestion.dismiss'));
    expect(screen.queryByTestId('vip.suggestion')).toBeNull();
    await waitFor(() => {
      expect(db.writes.find((w) => w.table === 'ai_feedback')?.values).toEqual({
        target_type: 'contact',
        target_id: M3.contact2,
        rating: -1,
        reason_code: 'other',
      });
    });
    expect(events('vip_suggestion_dismissed')).toHaveLength(1);
  });

  it('queues a removal and a save offline', async () => {
    await openVip([vipRow(2338, 'other', 'Deniz'), vipRow(2339, 'friend', 'Elif')]);
    await screen.findByTestId(`vip.row.${uuid(2338)}`);
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByTestId(`vip.star.${uuid(2338)}`));
    expect(await screen.findAllByText('Bağlantı gelince kaydedilecek.')).not.toHaveLength(0);
    await fireEvent.press(screen.getByTestId(`vip.edit.${uuid(2339)}`));
    await fireEvent.press(await screen.findByTestId('vipEdit.save'));
    await waitFor(() => {
      expect(screen.queryByTestId('sheet.vipEdit')).toBeNull();
    });
  });

  it('shows the load error', async () => {
    setup({ pro: true, data: { failures: { vip_people: 'FORBIDDEN' } } });
    await renderApp('/vip');
    expect(await screen.findByTestId('vip.error')).toBeOnTheScreen();
  });
});
