/**
 * T-8.23 / T-8.28 screen behaviour: the M-GL-09 offline banner (2 s debounce, "Son analiz" with the
 * Turkish ablative, "Yenile" → "Hâlâ çevrimdışı.", the "Güncel" reconnect flash, analytics), and the
 * deferred M-MAIL-04 items — the sender's VIP toggle (Pro writes `vip_people`, Free opens the
 * paywall, offline it is queued) and "Kopyala" on the original mail's text.
 */
import { qk } from '@da/api-client';
import NetInfo from '@react-native-community/netinfo';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { json, renderApp, resetAppState } from './helpers/app';
import { googleAccount, ok, TS, uuid } from './helpers/fixtures';
import { events, openApp } from './helpers/journeys';
import { setup } from './m2/harness';
import { queuedMutations } from '../src/lib/offline/mutations';
import { getQueryClient } from '../src/lib/query/client';
import { resetConnectivityForTests } from '../src/lib/offline/connectivity';

const MESSAGE = uuid(90);
const CONTACT = uuid(95);

const messageRow = {
  id: MESSAGE,
  thread_id: uuid(91),
  connected_account_id: googleAccount.id,
  provider: 'google',
  direction: 'inbound',
  from_name: 'Mehmet Yılmaz',
  from_email: 'mehmet@yilmaz.example',
  to_emails: ['ahmet@example.com'],
  cc_emails: [],
  received_at: TS,
  subject: 'Teklif',
  ai_summary: 'Mehmet Bey revize teklifi yarın bekliyor.',
  key_points: [],
  ai_status: 'done',
  classification: 'awaiting_my_reply',
  classification_tier: 'ai_classification',
  classification_reason: null,
  classification_confidence: 0.9,
  has_attachments: false,
  attachment_meta: [],
  injection_suspected: false,
  web_link: null,
};

const tables = { email_messages: [messageRow], contacts: [{ id: CONTACT }], vip_people: [] };

beforeEach(async () => {
  await resetAppState();
  resetConnectivityForTests();
});

async function openMenu(fake: ReturnType<typeof setup>['fake']) {
  await renderApp(`/mail/${MESSAGE}`);
  expect(await screen.findByTestId('email.subject')).toBeOnTheScreen();
  // The sender's VIP state is known before the menu opens.
  await waitFor(() => {
    expect(fake.data.calls.some((c) => c.kind === 'select' && c.target === 'vip_people')).toBe(
      true,
    );
    expect(getQueryClient().getQueryState(qk.vip.list())?.status).toBe('success');
  });
  await fireEvent.press(screen.getByTestId('email.more'));
  return screen.findByTestId('m2.menu.vip');
}

describe('M-MAIL-04 VIP toggle', () => {
  it('Pro: makes the sender a VIP through vip_people and confirms', async () => {
    const { fake } = setup({ pro: true, data: { tables } });
    const row = await openMenu(fake);
    expect(within(row).getByText('Göndereni VIP yap')).toBeOnTheScreen();
    await fireEvent.press(row);
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.kind === 'insert' && c.target === 'vip_people')?.args,
      ).toMatchObject({ contact_id: CONTACT, origin: 'user' });
    });
    expect(await screen.findByText('Öğrendim · Mehmet Yılmaz artık VIP.')).toBeOnTheScreen();
    expect(events('vip_toggle').at(-1)?.props).toEqual({ on: true });
  });

  it('Pro: removes an existing VIP; offline the change is queued', async () => {
    const { fake } = setup({
      pro: true,
      data: {
        tables: {
          ...tables,
          vip_people: [{ id: uuid(96), contact_id: CONTACT, relationship: 'client', contacts: {} }],
        },
      },
    });
    const row = await openMenu(fake);
    expect(within(row).getByText("VIP'den çıkar")).toBeOnTheScreen();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    await fireEvent.press(row);
    expect(await screen.findByText('Bağlantı gelince kaydedilecek.')).toBeOnTheScreen();
    expect(queuedMutations().map((e) => e.kind)).toEqual(['vip_set']);
    expect(fake.data.calls.some((c) => c.kind === 'delete')).toBe(false);
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.kind === 'delete' && c.target === 'vip_people')?.filters,
      ).toContainEqual(['eq', 'contact_id', CONTACT]);
    });
  });

  it('Free: opens the paywall for VIP', async () => {
    const { fake } = setup({ data: { tables } });
    const row = await openMenu(fake);
    await fireEvent.press(row);
    await waitFor(() => {
      expect(events('pro_gate_cta_tapped').at(-1)?.props).toMatchObject({ feature: 'vip' });
    });
    expect(events('vip_toggle')).toHaveLength(0);
  });
});

describe('"Kopyala" on the original mail', () => {
  it('copies the plain text from the long-press menu', async () => {
    setup({
      data: { tables },
      api: {
        [`GET /mail/${MESSAGE}/original`]: () =>
          json(
            200,
            ok({
              message_id: MESSAGE,
              subject: 'Teklif',
              from: { email: 'mehmet@yilmaz.example', name: 'Mehmet Yılmaz' },
              to: [{ email: 'ahmet@example.com' }],
              cc: [],
              date: TS,
              body: {
                format: 'text',
                content: 'Revize teklifi yarın bekliyoruz.',
                truncated: false,
                remote_images_blocked: true,
              },
              attachments: [],
              web_link: null,
              fetched_at: TS,
            }),
          ),
      },
    });
    await renderApp(`/mail/${MESSAGE}`);
    await fireEvent.press(
      within(await screen.findByTestId('email.original')).getByTestId('ui.accordion.header'),
    );
    await fireEvent(await screen.findByTestId('email.original.text.copyable'), 'longPress');
    await fireEvent.press(await screen.findByTestId('m2.menu.copy'));
    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Revize teklifi yarın bekliyoruz.');
    });
    expect(await screen.findByText('Kopyalandı')).toBeOnTheScreen();
  });
});

describe('M-GL-09 offline banner', () => {
  it('waits 2 s, re-checks on "Yenile", and flashes "Güncel" on reconnect', async () => {
    await openApp();
    await act(async () => {
      onlineManager.setOnline(false);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('today.offline')).toBeNull();
    const banner = await screen.findByTestId('today.offline', {}, { timeout: 4_000 });
    expect(
      within(banner).getByText(
        /^Çevrimdışısın\. Son analiz \d{2}:\d{2}'(d|t)(a|e)n gösteriliyor\.$/,
      ),
    ).toBeOnTheScreen();
    expect(events('offline_banner_shown').at(-1)?.props).toEqual({ screen: 'M-TD-01' });

    jest.mocked(NetInfo.refresh).mockResolvedValueOnce({ isConnected: false } as never);
    await fireEvent.press(within(banner).getByTestId('ui.offlineBanner.refresh'));
    expect(await screen.findByText('Hâlâ çevrimdışı.')).toBeOnTheScreen();
    expect(events('offline_refresh_tapped').at(-1)?.props).toEqual({ result: 'still_offline' });

    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('today.offline')).toBeNull();
    expect(await screen.findByTestId('today.offline.reconnected')).toBeOnTheScreen();
  });
});
