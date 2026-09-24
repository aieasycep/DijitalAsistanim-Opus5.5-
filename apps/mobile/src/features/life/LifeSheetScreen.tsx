/**
 * M-LIFE-01 · Yaşam detayı: one deep-linkable sheet (`life/[id]`, transparent modal) for shipment,
 * flight, reservation, payment, subscription and security (M§23, SREQ-25). Every field is shown
 * only when grounded in the source; an ungrounded amount or deadline reads "Kaynakta
 * kesinleşmiyor." (C-15). URL actions need a stored, server-verified `https:` link (the tracking
 * URL is allow-listed and DKIM-aligned server-side); without one the action is not rendered.
 * Security alerts never turn links into buttons — only the source opens.
 */
import { qk } from '@da/api-client';
import { formatCurrency } from '@da/i18n';
import {
  BottomSheet,
  Button,
  HintRow,
  IconTile,
  KeyValueGrid,
  SkeletonBlock,
  SourceLine,
  Text,
  NotFoundState,
  useToast,
  type IconName,
  type KeyValueItem,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { unwrap, unwrapMaybe } from '../../lib/data/rpc';
import { useFormats } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { isHttpsUrl, mapsUrl, openInBrowser, openWithOs, telUrl } from '../actions/handoff';
import { useInsightActions } from '../actions/insights';
import { useProposals } from '../actions/proposals';
import { openReminder, openSource } from '../actions/sheets';

type LifeType = 'shipment' | 'flight' | 'reservation' | 'payment' | 'subscription' | 'security';

const ICON: Readonly<Record<LifeType, IconName>> = {
  shipment: 'package_2',
  flight: 'flight',
  reservation: 'restaurant',
  payment: 'receipt_long',
  subscription: 'autorenew',
  security: 'shield',
};

const Payload = z.record(z.string(), z.unknown());

interface LifeEvent {
  readonly id: string;
  readonly type: LifeType;
  readonly status: string;
  readonly title: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly dueAt: string | null;
  readonly eventAt: string | null;
  readonly trackingUrl: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceProvider: string | null;
  readonly sourceTimestamp: string;
  readonly insightId: string | null;
}

async function fetchLifeEvent(id: string): Promise<LifeEvent> {
  const supabase = getSupabase();
  const row = unwrap(
    await supabase
      .from('life_events')
      .select(
        'id,type,status,title,payload,amount,currency,due_at,event_at,tracking_url,source_type,source_id,source_provider,source_timestamp',
      )
      .eq('id', id)
      .single(),
  );
  const insight = unwrapMaybe(
    await supabase
      .from('insights')
      .select('id')
      .eq('entity_type', 'life_event')
      .eq('entity_id', id)
      .in('status', ['open', 'snoozed'])
      .limit(1)
      .maybeSingle(),
  );
  const payload = Payload.safeParse(row.payload);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    payload: payload.success ? payload.data : {},
    amount: row.amount,
    currency: row.currency,
    dueAt: row.due_at,
    eventAt: row.event_at,
    trackingUrl: row.tracking_url,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceProvider: row.source_provider,
    sourceTimestamp: row.source_timestamp,
    insightId: insight?.id ?? null,
  };
}

function str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/** "ABC4K" → "···· 4K" (PNRs and account refs are never shown in full). */
export function maskRef(value: string): string {
  return `···· ${value.slice(-2)}`;
}

type LifeAction =
  | 'track'
  | 'paid'
  | 'mine'
  | 'never_show'
  | 'remind'
  | 'open_source'
  | 'checkin'
  | 'calendar'
  | 'dismiss';

export function LifeSheetScreen() {
  const t = useTranslations('life');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const router = useRouter();
  const toast = useToast();
  const formats = useFormats();
  const queryClient = useQueryClient();
  const proposals = useProposals('life');
  const insights = useInsightActions([qk.flow.all, qk.life.all]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visible, setVisible] = useState(true);
  const query = useQuery({
    queryKey: qk.life.detail(id),
    queryFn: () => fetchLifeEvent(id),
    staleTime: 60_000,
    meta: { persist: true },
  });
  const event = query.data;
  const close = () => {
    setVisible(false);
  };

  const type = event?.type;
  useEffect(() => {
    if (type !== undefined) track('life_detail_view', { type });
  }, [type]);

  const act = (action: LifeAction) => {
    if (type !== undefined) track('life_action', { type, action });
  };

  const sourcePath = (e: LifeEvent): string | null => {
    if (e.sourceType === 'email_message') return `/mail/${e.sourceId}`;
    if (e.sourceType === 'capture') return `/capture/${e.sourceId}`;
    return null;
  };
  const openSourceScreen = (e: LifeEvent) => {
    act('open_source');
    const path = sourcePath(e);
    close();
    if (path !== null && isScreenAvailable(path)) router.push(path);
    else openSource({ targetType: 'life_event', targetId: e.id, origin: 'life' });
  };

  const resolve = async (e: LifeEvent, action: 'paid' | 'mine' | 'track', message: string) => {
    act(action === 'track' ? 'track' : action);
    close();
    try {
      await getSupabase()
        .from('life_events')
        .update({ status: 'done', resolved_at: now().toISOString() })
        .eq('id', e.id);
      await queryClient.invalidateQueries({ queryKey: qk.life.detail(e.id) });
    } catch {
      toast.show({ message: t('screen.failed'), kind: 'error' });
      return;
    }
    if (e.insightId !== null)
      insights.setStatus({ id: e.insightId, to: 'done', via: 'button', message });
    else toast.show({ message, kind: 'success' });
  };

  let body;
  if (event === undefined) {
    body = query.isError ? (
      <NotFoundState
        variant="entity"
        title={t('screen.gone')}
        backAction={{ label: tc('actions.close'), onPress: close }}
        testID="life.notFound"
      />
    ) : (
      <View style={{ gap: 10 }} testID="life.loading">
        <SkeletonBlock width={44} height={44} radius={12} />
        <SkeletonBlock height={18} width="70%" />
        <SkeletonBlock height={14} width="50%" />
      </View>
    );
  } else {
    const e = event;
    const p = e.payload;
    const at = e.eventAt ?? e.dueAt;
    const past =
      at !== null &&
      Date.parse(at) < now().getTime() &&
      (e.type === 'flight' || e.type === 'shipment' || e.type === 'reservation');
    const when = (iso: string | null) =>
      iso === null
        ? tc('provenance.notConfirmed')
        : `${formats.dayMonth(iso)} ${formats.time(iso)}`;
    const amount =
      e.amount === null
        ? tc('provenance.notConfirmed')
        : formatCurrency(e.amount, formats.locale, { currency: e.currency ?? 'TRY' });
    const rows: KeyValueItem[] = [];
    const push = (key: string, label: string, value: string | null) => {
      if (value !== null) rows.push({ key, label, value });
    };
    switch (e.type) {
      case 'shipment':
        push('merchant', t('screen.fields.merchant'), str(p, 'merchant'));
        push('carrier', t('screen.fields.carrier'), str(p, 'carrier'));
        push('tracking', t('screen.fields.trackingNo'), str(p, 'tracking_no'));
        push('eta', t('fields.eta'), e.eventAt === null ? null : when(e.eventAt));
        break;
      case 'flight': {
        const from = str(p, 'from');
        const to = str(p, 'to');
        push('airline', t('screen.fields.airline'), str(p, 'airline'));
        push('flight', t('screen.fields.flightNo'), str(p, 'flight_no'));
        push(
          'route',
          t('screen.fields.route'),
          from !== null && to !== null ? `${from} → ${to}` : null,
        );
        push('departure', t('fields.departure'), when(e.eventAt));
        push('gate', t('fields.gate'), str(p, 'gate'));
        const pnr = str(p, 'pnr');
        push('pnr', t('screen.fields.pnr'), pnr === null ? null : maskRef(pnr));
        break;
      }
      case 'reservation':
        push('venue', t('screen.fields.venue'), str(p, 'venue'));
        push('when', t('screen.fields.when'), when(e.eventAt));
        push('party', t('fields.partySize'), str(p, 'party_size'));
        push('address', t('screen.fields.address'), str(p, 'address'));
        break;
      case 'payment': {
        push('payee', t('screen.fields.payee'), str(p, 'payee'));
        rows.push({ key: 'amount', label: t('fields.amount'), value: amount });
        rows.push({ key: 'due', label: t('fields.dueDate'), value: when(e.dueAt) });
        const ref = str(p, 'account_ref');
        push('ref', t('screen.fields.accountRef'), ref === null ? null : maskRef(ref));
        break;
      }
      case 'subscription':
        push('service', t('screen.fields.service'), str(p, 'service'));
        rows.push({ key: 'amount', label: t('fields.amount'), value: amount });
        rows.push({
          key: 'renewal',
          label: t('fields.renewal'),
          value: when(e.dueAt ?? e.eventAt),
        });
        break;
      case 'security':
        push('service', t('screen.fields.service'), str(p, 'service'));
        push('device', t('screen.fields.device'), str(p, 'device'));
        push('location', t('screen.fields.location'), str(p, 'location'));
        rows.push({ key: 'time', label: t('screen.fields.time'), value: when(e.sourceTimestamp) });
        break;
    }

    const buttons: { key: string; label: string; primary?: boolean; onPress: () => void }[] = [];
    const sourceButton = {
      key: 'source',
      label: t('actions.openSource'),
      onPress: () => {
        openSourceScreen(e);
      },
    };
    const remindButton = (anchor: string | null) => ({
      key: 'remind',
      label: t('actions.remind'),
      onPress: () => {
        act('remind');
        close();
        openReminder({
          title: e.title,
          origin: 'life_event',
          anchorAt: anchor,
          subject: { type: 'life_event', id: e.id },
        });
      },
    });
    const calendarButton = {
      key: 'calendar',
      label: t('actions.addToCalendar'),
      onPress: () => {
        if (e.eventAt === null) return;
        act('calendar');
        close();
        void proposals.proposeEvent({
          title: e.title,
          start: e.eventAt,
          origin: 'life_event',
          originRef: null,
          originRefId: e.id,
          source: {
            source_type: 'life_event',
            source_id: e.id,
            source_provider: 'in_app',
            source_timestamp: e.sourceTimestamp,
          },
          invalidate: [qk.life.detail(e.id), qk.plan.all],
        });
      },
    };
    if (!past) {
      switch (e.type) {
        case 'shipment':
          if (isHttpsUrl(e.trackingUrl)) {
            const url = e.trackingUrl;
            buttons.push({
              key: 'track',
              label: t('actions.trackPackage'),
              primary: true,
              onPress: () => {
                act('track');
                track('external_handoff', { kind: 'tracking' });
                void openInBrowser(url);
              },
            });
          }
          buttons.push(remindButton(e.eventAt));
          buttons.push({
            key: 'received',
            label: t('screen.received'),
            onPress: () => {
              void resolve(e, 'track', t('screen.receivedDone'));
            },
          });
          break;
        case 'flight': {
          const checkin = str(p, 'checkin_url');
          if (p.checkin_open === true && isHttpsUrl(checkin)) {
            buttons.push({
              key: 'checkin',
              label: t('actions.checkIn'),
              primary: true,
              onPress: () => {
                act('checkin');
                track('external_handoff', { kind: 'checkin' });
                void openInBrowser(checkin);
              },
            });
          }
          if (e.eventAt !== null) buttons.push(calendarButton);
          buttons.push(remindButton(e.eventAt));
          break;
        }
        case 'reservation': {
          const confirmUrl = str(p, 'confirm_url');
          const phone = telUrl(str(p, 'phone'));
          if (isHttpsUrl(confirmUrl) || phone !== null) {
            buttons.push({
              key: 'confirm',
              label: t('screen.confirm'),
              primary: true,
              onPress: () => {
                track('external_handoff', { kind: isHttpsUrl(confirmUrl) ? 'confirm' : 'tel' });
                if (isHttpsUrl(confirmUrl)) void openInBrowser(confirmUrl);
                else if (phone !== null) void openWithOs(phone);
              },
            });
          }
          const address = str(p, 'address');
          if (address !== null) {
            buttons.push({
              key: 'maps',
              label: t('screen.directions'),
              onPress: () => {
                track('external_handoff', { kind: 'maps' });
                void openWithOs(mapsUrl(address));
              },
            });
          }
          if (e.eventAt !== null) buttons.push(calendarButton);
          buttons.push(remindButton(e.eventAt));
          break;
        }
        default:
          break;
      }
    }
    switch (e.type) {
      case 'payment':
        buttons.push({ ...remindButton(e.dueAt), primary: true });
        buttons.push({
          key: 'paid',
          label: t('screen.paid'),
          onPress: () => {
            void resolve(e, 'paid', t('screen.paidDone'));
          },
        });
        break;
      case 'subscription':
        buttons.push({ ...remindButton(e.dueAt ?? e.eventAt), primary: true });
        if (e.insightId !== null) {
          const insightId = e.insightId;
          buttons.push({
            key: 'never',
            label: t('screen.neverShow'),
            onPress: () => {
              act('never_show');
              close();
              insights.sendFeedback({
                id: insightId,
                kind: 'stop_tracking',
                message: tc('toast.learnedLower'),
              });
            },
          });
        }
        break;
      case 'security':
        buttons.push({ ...sourceButton, primary: true });
        buttons.push({
          key: 'mine',
          label: t('screen.itWasMe'),
          onPress: () => {
            void resolve(e, 'mine', t('screen.mineDone'));
          },
        });
        if (e.insightId !== null) {
          const insightId = e.insightId;
          buttons.push({
            key: 'dismiss',
            label: t('screen.notImportant'),
            onPress: () => {
              act('dismiss');
              close();
              insights.dismissOnly(insightId, t('screen.dismissed'), 'button');
            },
          });
        }
        break;
      default:
        break;
    }
    if (e.type !== 'security') {
      if (buttons.length === 0 || past) buttons.unshift({ ...sourceButton, primary: true });
      else buttons.push(sourceButton);
    }
    const primaryIndex = Math.max(
      0,
      buttons.findIndex((b) => b.primary === true),
    );

    body = (
      <View style={{ gap: 14 }} testID={`life.${e.type}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconTile
            icon={ICON[e.type]}
            size={44}
            tone={e.type === 'security' ? 'critical' : 'neutral'}
          />
          <View style={{ flex: 1 }}>
            <Text variant="kicker" tone="tertiaryStrong">
              {past ? t('screen.pastKicker', { type: t(`types.${e.type}`) }) : t(`types.${e.type}`)}
            </Text>
            <Text variant="meta" tone="tertiaryStrong">
              {formats.dayMonth(e.sourceTimestamp)}
            </Text>
          </View>
        </View>
        <Text variant="h3" heading>
          {e.title}
        </Text>
        {rows.length === 0 ? null : <KeyValueGrid items={rows} testID="life.fields" />}
        {e.type === 'security' ? <HintRow text={t('screen.securityGuidance')} /> : null}
        <View style={{ gap: 8 }}>
          {buttons.map((b, index) => (
            <Button
              key={b.key}
              label={b.label}
              variant={index === primaryIndex ? 'primary' : 'tonal'}
              onPress={b.onPress}
              fullWidth
              {...(b.key === 'track' || b.key === 'checkin' || b.key === 'confirm'
                ? { accessibilityHint: tc('a11y.opensInBrowser') }
                : {})}
              testID={`life.action.${b.key}`}
            />
          ))}
        </View>
        <SourceLine
          icon={e.sourceType === 'email_message' ? 'mail' : 'description'}
          parts={[
            tc(`sourceTypes.${e.sourceType === 'email_message' ? 'email_message' : 'capture'}`),
            formats.dayMonth(e.sourceTimestamp),
          ]}
          onPress={() => {
            openSource({ targetType: 'life_event', targetId: e.id, origin: 'life' });
          }}
        />
      </View>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={close}
      onHidden={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/flow');
      }}
      presentation="inline"
      accessibilityLabel={event?.title ?? ts('loading.label')}
      testID="life.sheet"
    >
      {body}
    </BottomSheet>
  );
}
