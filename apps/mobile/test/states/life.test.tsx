/**
 * T-8.14 · M-LIFE-01 Yaşam detayı per type (SCREEN_AND_FLOW_MAP M-LIFE-01, M§23, C-15): only grounded
 * fields (masked PNR / account refs, "Kaynakta kesinleşmiyor." for an ungrounded amount), URL actions
 * only for stored `https:` links (tracking, check-in, confirmation), maps and tel hand-offs,
 * "Takvime Ekle" through `POST /approvals`, the in-app reminder, "Teslim Aldım" / "Ödedim" / "Bu
 * Bendim" resolving the `life_events` row and its insight, "Bu türü bir daha gösterme"
 * (`stop_tracking`), security alerts that open only their source, past items and a missing row.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as WebBrowser from 'expo-web-browser';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import type * as Clock from '../../src/lib/clock';
import { json, renderApp, resetAppState } from '../helpers/app';
import { approvalView } from '../helpers/assist';
import { googleAccount, ok, TS, uuid } from '../helpers/fixtures';
import { events, setup } from '../m2/harness';

jest.mock('../../src/lib/clock', () => ({
  ...jest.requireActual<typeof Clock>('../../src/lib/clock'),
  now: () => new Date('2026-09-24T06:30:00Z'),
}));

const LIFE = uuid(1800);
const INSIGHT = uuid(1801);
const MSG = uuid(1802);

function life(type: string, overrides: Record<string, unknown> = {}) {
  return {
    id: LIFE,
    type,
    status: 'active',
    title: `${type} kaydı`,
    payload: {},
    amount: null,
    currency: null,
    due_at: null,
    event_at: null,
    tracking_url: null,
    source_type: 'email_message',
    source_id: MSG,
    source_provider: 'google',
    source_timestamp: TS,
    ...overrides,
  };
}

function lifeSetup(row: Record<string, unknown>, withInsight = true) {
  return setup({
    data: {
      rpc: {
        set_insight_status: () => null,
        apply_insight_feedback: () => ({ feedback_id: uuid(1803) }),
        get_explanation: () => ({
          reason_text: 'Mailden çıkarıldı.',
          decision_tier: 'deterministic_signal',
          confidence: 0.9,
          sources: [],
        }),
      },
      tables: {
        life_events: [row],
        insights: withInsight
          ? [{ id: INSIGHT, entity_type: 'life_event', entity_id: LIFE, status: 'open' }]
          : [],
        calendars: [
          { id: uuid(12), connected_account_id: googleAccount.id, can_write: true, selected: true },
        ],
      },
    },
    api: {
      'POST /approvals': () =>
        json(
          201,
          ok(
            approvalView({
              action_type: 'calendar_create',
              type_label_key: 'approvals.types.calendar_create',
              origin: 'life_event',
              side_effects: [],
              destination: {
                target_kind: 'provider',
                provider: 'google',
                account_label: 'ahmet@example.com',
                container_label: null,
              },
            }),
          ),
        ),
    },
  });
}

async function openLife() {
  const rendered = await renderApp(`/life/${LIFE}`);
  await screen.findByTestId('life.fields');
  return rendered;
}

beforeEach(async () => {
  await resetAppState();
});

describe('M-LIFE-01 · Yaşam detayı', () => {
  it('shipment: tracks through the verified link and marks it received', async () => {
    const { fake } = lifeSetup(
      life('shipment', {
        payload: { merchant: 'Trendyol', carrier: 'Yurtiçi', tracking_no: 'YK12345' },
        event_at: '2026-09-25T12:00:00Z',
        tracking_url: 'https://kargotakip.yurticikargo.com/?code=YK12345',
      }),
    );
    await openLife();
    expect(screen.getByText('Trendyol')).toBeOnTheScreen();
    expect(screen.getByText('YK12345')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('life.action.track'));
    await waitFor(() => {
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://kargotakip.yurticikargo.com/?code=YK12345',
      );
    });
    await fireEvent.press(screen.getByTestId('life.action.received'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.kind === 'update')).toMatchObject({
        target: 'life_events',
        args: { status: 'done' },
      });
    });
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_insight_id: INSIGHT,
        p_status: 'done',
      });
    });
    expect(events('life_action').map((e) => e.props.action)).toEqual(['track', 'track']);
  });

  it('flight: masks the PNR, checks in, adds to the calendar and reminds', async () => {
    const { api } = lifeSetup(
      life('flight', {
        payload: {
          airline: 'THY',
          flight_no: 'TK2124',
          from: 'IST',
          to: 'ESB',
          gate: 'B12',
          pnr: 'ABC4K9',
          checkin_open: true,
          checkin_url: 'https://www.turkishairlines.com/checkin',
        },
        event_at: '2026-09-26T07:00:00Z',
      }),
    );
    await openLife();
    expect(screen.getByText('IST → ESB')).toBeOnTheScreen();
    expect(screen.getByText('···· K9')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('life.action.checkin'));
    await waitFor(() => {
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://www.turkishairlines.com/checkin',
      );
    });
    await fireEvent.press(screen.getByTestId('life.action.calendar'));
    await waitFor(() => {
      expect(api.calls.find((c) => c.url.endsWith('/approvals'))?.body).toMatchObject({
        payload: {
          action_type: 'calendar_create',
          title: 'flight kaydı',
          time: { kind: 'timed', start: '2026-09-26T07:00:00Z', end: '2026-09-26T08:00:00.000Z' },
        },
        origin: 'life_event',
        origin_ref_id: LIFE,
      });
    });
    expect(await screen.findByTestId('sheet.approval')).toBeOnTheScreen();
  });

  it('reservation: confirms online, opens directions and reminds', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    lifeSetup(
      life('reservation', {
        payload: {
          venue: 'Mikla',
          party_size: 4,
          address: 'Meşrutiyet Cd. 15, Beyoğlu',
          confirm_url: 'https://mikla.example/r/123',
        },
        event_at: '2026-09-27T17:00:00Z',
      }),
    );
    await openLife();
    expect(screen.getByText('4')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('life.action.maps'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(expect.stringContaining('Me%C5%9Frutiyet'));
    });
    await fireEvent.press(screen.getByTestId('life.action.confirm'));
    await waitFor(() => {
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://mikla.example/r/123');
    });
    await fireEvent.press(screen.getByTestId('life.action.remind'));
    expect(await screen.findByTestId('m2.reminder')).toBeOnTheScreen();
    expect(events('external_handoff').map((e) => e.props.kind)).toEqual(['maps', 'confirm']);
  });

  it('reservation with only a phone number calls it', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');
    lifeSetup(
      life('reservation', {
        payload: { venue: 'Mikla', phone: '+90 212 293 56 56' },
        event_at: '2026-09-27T17:00:00Z',
      }),
    );
    await openLife();
    await fireEvent.press(screen.getByTestId('life.action.confirm'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/^tel:/));
    });
  });

  it('payment: an ungrounded amount is not confirmed; "Ödedim" resolves without an insight', async () => {
    const { fake } = lifeSetup(
      life('payment', {
        payload: { payee: 'CK Boğaziçi Elektrik', account_ref: '4000123456' },
        due_at: '2026-09-30T20:59:00Z',
      }),
      false,
    );
    await openLife();
    expect(screen.getByText('Kaynakta kesinleşmiyor.')).toBeOnTheScreen();
    expect(screen.getByText('···· 56')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('life.action.paid'));
    expect(await screen.findByText('Ödendi olarak işaretlendi.')).toBeOnTheScreen();
    expect(fake.data.calls.some((c) => c.target === 'set_insight_status')).toBe(false);
  });

  it('subscription: shows the renewal amount and stops tracking the type', async () => {
    const { fake } = lifeSetup(
      life('subscription', {
        payload: { service: 'Spotify' },
        amount: 59.99,
        currency: 'TRY',
        due_at: '2026-10-01T09:00:00Z',
      }),
    );
    await openLife();
    expect(screen.getByText(/59,99/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('life.action.never'));
    await waitFor(() => {
      expect(
        fake.data.calls.find((c) => c.target === 'apply_insight_feedback')?.args,
      ).toMatchObject({
        p_insight_id: INSIGHT,
        p_kind: 'stop_tracking',
      });
    });
  });

  it('security: never links out, opens its source mail, and "Bu Bendim" / "Önemli değil" resolve it', async () => {
    const { fake } = lifeSetup(
      life('security', {
        payload: { service: 'Google', device: 'iPhone 15', location: 'Ankara' },
        tracking_url: 'https://phishing.example/login',
      }),
    );
    const { router } = await openLife();
    expect(screen.getByText(/Maildeki bağlantılara tıklama/)).toBeOnTheScreen();
    expect(screen.queryByTestId('life.action.track')).toBeNull();
    await fireEvent.press(screen.getByTestId('life.action.dismiss'));
    await waitFor(() => {
      expect(fake.data.calls.find((c) => c.target === 'set_insight_status')?.args).toMatchObject({
        p_status: 'dismissed',
      });
    });
    await fireEvent.press(screen.getByTestId('life.action.mine'));
    await waitFor(() => {
      expect(fake.data.calls.some((c) => c.kind === 'update' && c.target === 'life_events')).toBe(
        true,
      );
    });
    await fireEvent.press(screen.getByTestId('life.action.source'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/mail/${MSG}`);
    });
  });

  it('a past flight only offers its source and the source line explains it', async () => {
    lifeSetup(
      life('flight', {
        payload: { flight_no: 'TK2124' },
        event_at: '2026-09-20T07:00:00Z',
        source_type: 'capture',
        source_id: uuid(1804),
      }),
    );
    await openLife();
    expect(screen.getByText('Uçuş · geçmiş'.toLocaleUpperCase('tr-TR'))).toBeOnTheScreen();
    expect(screen.queryByTestId('life.action.calendar')).toBeNull();
    expect(
      within(screen.getByTestId('life.flight')).getByTestId('life.action.source'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(/^Yakalama/));
    expect(await screen.findByText('Mailden çıkarıldı.')).toBeOnTheScreen();
  });

  it('shows "Bu kayıt artık yok." for a missing row', async () => {
    setup({});
    await renderApp(`/life/${LIFE}`);
    expect(await screen.findByTestId('life.notFound')).toBeOnTheScreen();
  });
});
