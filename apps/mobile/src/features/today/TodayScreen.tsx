/**
 * M-TD-01 Today ("Bugün bilmen gerekenler"): RPC-04 `today_overview` + today's briefings,
 * rendered in the D-24 order — header (greeting, date, approval pill), one account alert, the hero
 * (Annex A modes) or its Pro gate, the weekly card, the announcement banner (R-25), ÖNCELİKLERİN
 * with swipe / "Tamamlandı" / "Ertele" / "Önemli değil" (R-06 undo) and the correction and
 * explain sheets, PROGRAMIN, SON TARİHLER, TAKİP and DİJİTAL HAYATIN. Every count comes from the
 * RPC; controls whose screen is not in this build are not rendered (R-24). Offline shows the
 * persisted Today with the banner; pull-to-refresh syncs healthy accounts (1/60 s per account).
 */
import { audioMinutes, formatDuration, toUpper } from '@da/i18n';
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import {
  AnnouncementCard,
  BriefingHero,
  Card,
  EmptyState,
  ErrorCard,
  GroupedList,
  HeaderPill,
  ListRow,
  OfflineBanner,
  PriorityCard,
  ReconnectCard,
  RootHeader,
  SectionHeader,
  SwipeableRow,
  SyncLine,
  Text,
  TextAction,
  TimelineRow,
  TodaySkeleton,
  useTheme,
  type A11yAction,
  type CardAction,
  type HeroSentence,
} from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useScrollToTop } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { isScreenAvailable, resolveIncomingLink, defaultLinkOptions } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { patchBootstrapCache, rpc } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { sheets } from '../../providers/SheetHost';
import { ContextualGate, isGateDismissed, isPro, openProGate } from '../pro-gate/ProGate';
import { useAccounts } from '../integrations/accounts';
import { connectCloud } from '../integrations/flow';
import { useDeviceCalendarSync } from '../integrations/useDeviceCalendarSync';
import { applyFeedback, completeInsight } from './actions';
import { badgeOf } from './badges';
import { useToday, type BriefingSummary, type TodayData, type TodayPriority } from './data';
import { analyticsHeroMode, localDateOf, resolveHero, type HeroState } from './hero';
import { INSIGHT_CORRECTION_SHEET } from './sheets/CorrectionSheet';
import { SNOOZE_SHEET } from './sheets/SnoozeSheet';
import { INSIGHT_WHY_SHEET } from './sheets/WhySheet';
import { routeForEntity, routeForSource } from './sources';

export const MAX_PRIORITIES = 5;

function splitSentence(text: string, count: number): HeroSentence {
  const value = String(count);
  const at = text.indexOf(value);
  if (at === -1) return { before: text };
  return { before: text.slice(0, at), count: value, after: text.slice(at + value.length) };
}

function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

function useGreeting(data: BootstrapData | undefined): string {
  const t = useTranslations('today.greeting');
  const format = useFormatter();
  const hour = Number(format.dateTime(now(), { hour: '2-digit', hourCycle: 'h23' }));
  const key = greetingKey(Number.isFinite(hour) ? hour : 9);
  const name = data?.profile.display_name?.trim().split(/\s+/)[0] ?? '';
  return name === '' ? t(`${key}NoName`) : t(key, { name });
}

function AccountAlert({ data }: { readonly data: BootstrapData }) {
  const states = useTranslations('states.error.oauthExpired');
  const common = useTranslations('common');
  const accounts = useAccounts();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const alert =
    data.accounts.find((a) => a.status === 'needs_reauth') ??
    data.accounts.find((a) => a.status === 'admin_consent_required');
  if (hidden || alert === undefined) return null;
  const provider = alert.provider;
  const mail = alert.capabilities_granted.includes('mail_read');
  const service = common(
    `providers.${provider === 'microsoft' ? (mail ? 'outlook' : 'outlookCalendar') : mail ? 'gmail' : 'googleCalendar'}`,
  );
  const identityProvider = common(`providers.${provider === 'microsoft' ? 'microsoft' : 'google'}`);
  if (alert.status === 'admin_consent_required') {
    return (
      <ReconnectCard
        variant="adminConsent"
        title={states('adminConsent.title')}
        body={states('adminConsent.body')}
        reconnectAction={{
          label: common('actions.details'),
          onPress: () => {
            track('account_alert_action', { code: 'admin_consent_required', action: 'details' });
            router.push(`/settings/accounts/${alert.id}`);
          },
        }}
        laterAction={{
          label: common('actions.later'),
          onPress: () => {
            track('account_alert_action', { code: 'admin_consent_required', action: 'dismiss' });
            setHidden(true);
          },
        }}
        testID="today.alert"
      />
    );
  }
  const row = accounts.data?.accounts.find((a) => a.id === alert.id);
  return (
    <ReconnectCard
      title={states('title', { service })}
      body={
        mail
          ? states('bodyMail', { identityProvider })
          : states('bodyCalendar', { identityProvider })
      }
      reconnectAction={{
        label: states('cta'),
        onPress: () => {
          track('account_alert_action', { code: 'needs_reauth', action: 'reconnect' });
          if (provider !== 'google' && provider !== 'microsoft' && provider !== 'demo') return;
          void connectCloud({
            provider,
            capability: mail ? 'mail_read' : 'calendar_read',
            returnTo: 'error_card',
            ...(row === undefined ? {} : { reconnect: row }),
          });
        },
      }}
      laterAction={{
        label: states('later'),
        onPress: () => {
          track('account_alert_action', { code: 'needs_reauth', action: 'dismiss' });
          setHidden(true);
        },
      }}
      testID="today.alert"
    />
  );
}

function AnnouncementBanner({ data }: { readonly data: BootstrapData }) {
  const t = useTranslations('today.announcement');
  const router = useRouter();
  const announcement = [...data.announcements].sort((a, b) =>
    (a.ends_at ?? '9999').localeCompare(b.ends_at ?? '9999'),
  )[0];
  const [expanded, setExpanded] = useState(false);
  const viewed = useRef<string | null>(null);
  const cta = (() => {
    const route = announcement?.cta_route ?? null;
    if (route === null) return null;
    const link = resolveIncomingLink(route, defaultLinkOptions());
    return link.kind === 'route' && isScreenAvailable(link.href) ? link.href : null;
  })();
  useEffect(() => {
    if (announcement === undefined || viewed.current === announcement.id) return;
    viewed.current = announcement.id;
    track('announcement_viewed', { has_cta: cta !== null });
  }, [announcement, cta]);
  if (announcement === undefined) return null;
  const dismiss = () => {
    track('announcement_dismissed');
    patchBootstrapCache((current) => ({
      ...current,
      announcements: current.announcements.filter((a) => a.id !== announcement.id),
    }));
    void rpc('dismiss_announcement', { p_announcement_id: announcement.id }).catch(() => undefined);
  };
  const long = announcement.body.length > 140 && !expanded;
  return (
    <AnnouncementCard
      title={announcement.title}
      body={long ? `${announcement.body.slice(0, 140)}…` : announcement.body}
      onDismiss={dismiss}
      dismissLabel={t('dismissA11y')}
      {...(long
        ? {
            action: {
              key: 'more',
              label: t('more'),
              onPress: () => {
                setExpanded(true);
              },
            },
          }
        : cta === null
          ? {}
          : {
              action: {
                key: 'cta',
                label: t('open'),
                onPress: () => {
                  track('announcement_cta_tapped');
                  router.push(cta);
                },
              },
            })}
      accessibilityLabel={t('a11y', { title: announcement.title, body: announcement.body })}
      testID="today.announcement"
    />
  );
}

interface HeroProps {
  readonly hero: HeroState;
  readonly data: TodayData;
  readonly bootstrap: BootstrapData;
  readonly online: boolean;
}

function Hero({ hero, data, bootstrap, online }: HeroProps) {
  const t = useTranslations('today.hero');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const lang = locale === 'en' ? 'en' : 'tr';
  const count = data.overview.hero_count;
  const briefing = hero.briefing;
  const time = (iso: string | null | undefined) =>
    iso === null || iso === undefined
      ? ''
      : format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });
  const prefs = bootstrap.preferences;
  const audioSeconds = briefing?.audio_duration_s ?? null;
  const minutes = audioSeconds === null ? null : audioMinutes(audioSeconds);
  const pro = isPro();

  const open = (b: BriefingSummary) => {
    track('today_hero_cta', { mode: analyticsHeroMode(hero.mode), cta: 'primary' });
    router.push(`/briefing/${b.id}?via=today`);
  };
  const listen =
    briefing === null || briefing.status === 'failed'
      ? undefined
      : {
          label:
            minutes === null ? common('actions.listen') : common('actions.listenFor', { minutes }),
          locked: !pro,
          disabled: !online,
          onPress: () => {
            track('today_hero_cta', { mode: analyticsHeroMode(hero.mode), cta: 'listen' });
            if (!pro) {
              openProGate('voice_briefing');
              return;
            }
            router.push(`/briefing/${briefing.id}/listen?autoplay=1`);
          },
        };

  const context = (() => {
    const parts: string[] = [];
    const important = data.overview.priorities.filter((p) => p.kind === 'reply_needed').length;
    if (important > 0) parts.push(t('context.mail', { count: important }));
    if (data.overview.next_meeting !== null) parts.push(t('context.events', { count: 1 }));
    if (data.overview.follow_ups.length > 0)
      parts.push(t('context.followUps', { count: data.overview.follow_ups.length }));
    if (data.overview.deadlines.length > 0)
      parts.push(t('context.deadlines', { count: data.overview.deadlines.length }));
    return parts.join(' · ');
  })();

  switch (hero.mode) {
    case 'no_sources':
      return (
        <EmptyState
          icon="mail"
          tone="primary"
          title={states('empty.noAccount.title')}
          body={states('empty.noAccount.body')}
          {...(isScreenAvailable('/settings/accounts')
            ? {
                action: {
                  label: states('empty.noAccount.cta'),
                  onPress: () => {
                    router.push('/settings/accounts');
                  },
                },
              }
            : {})}
          testID="today.hero.noSources"
        />
      );
    case 'midday_gate':
    case 'evening_gate':
      return (
        <ContextualGate
          feature={hero.mode === 'midday_gate' ? 'midday' : 'evening'}
          title={
            hero.mode === 'midday_gate'
              ? t('middayGate.title', { count })
              : t('eveningGate.title', { count })
          }
          {...(hero.mode === 'midday_gate' ? { body: t('middayGate.body') } : {})}
          testID="today.hero.gate"
        />
      );
    default:
      break;
  }

  let kicker: string;
  let sentence: HeroSentence;
  let heroContext: string | undefined = context === '' ? undefined : context;
  let primary: { label: string; onPress: () => void } | undefined;
  let mode: 'ready' | 'generating' | 'offline' = online ? 'ready' : 'offline';
  switch (hero.mode) {
    case 'silent_day':
      kicker = t('silentDay.kicker');
      sentence = { before: t('silentDay.title') };
      heroContext = t('silentDay.context');
      break;
    case 'evening_confirmed':
      kicker = t('eveningConfirmed.kicker');
      sentence = {
        before: t('eveningConfirmed.title', {
          time: prefs.morning_time.slice(0, 5),
          time_loc: prefs.morning_time.slice(0, 5),
        }),
      };
      heroContext = undefined;
      if (briefing !== null)
        primary = {
          label: t('eveningReady.cta'),
          onPress: () => {
            open(briefing);
          },
        };
      break;
    case 'evening_ready':
      kicker = t('eveningReady.kicker');
      sentence =
        count === 0
          ? { before: t('eveningReady.zero') }
          : splitSentence(t('eveningReady.title', { count }), count);
      if (briefing !== null)
        primary = {
          label: t('eveningReady.cta'),
          onPress: () => {
            open(briefing);
          },
        };
      break;
    case 'midday_ready':
      kicker = t('middayReady.kicker', { time: time(briefing?.generated_at) });
      sentence = splitSentence(t('middayReady.title', { count }), count);
      if (briefing !== null)
        primary = {
          label: t('middayReady.cta'),
          onPress: () => {
            open(briefing);
          },
        };
      break;
    case 'morning_ready':
    case 'first_day':
      kicker =
        hero.mode === 'first_day'
          ? t('morningReady.firstDayKicker')
          : online
            ? t('morningReady.kicker', { time: time(briefing?.generated_at) })
            : states('offline.todayKicker', { time: time(briefing?.generated_at) });
      sentence =
        count === 0
          ? { before: t('morningReady.zero') }
          : splitSentence(t('morningReady.title', { count }), count);
      if (hero.middaySkipped) heroContext = t('morningReady.middayNoChange');
      if (briefing !== null)
        primary = {
          label: common('actions.viewBriefing'),
          onPress: () => {
            open(briefing);
          },
        };
      break;
    case 'generating':
      kicker = t('generating.kicker');
      sentence = { before: '' };
      mode = 'generating';
      heroContext = undefined;
      break;
    case 'morning_failed':
      kicker = t('morningFailed.kicker');
      sentence = splitSentence(t('morningReady.title', { count }), count);
      heroContext = t('morningFailed.failed');
      if (briefing !== null) {
        primary = {
          label: common('actions.retry'),
          onPress: () => {
            void getApiClient()
              .call('POST /briefings/:id/retry', { params: { id: briefing.id }, body: {} })
              .catch(() => undefined);
          },
        };
      }
      break;
    case 'pre_morning': {
      const at = prefs.morning_time.slice(0, 5);
      kicker = t('preMorning.kicker', { time: at });
      sentence = { before: t('preMorning.title', { time: at, time_loc: at }) };
      heroContext = count > 0 ? t('preMorning.context', { count }) : undefined;
      break;
    }
    default:
      kicker = format.dateTime(now(), { day: 'numeric', month: 'long' });
      sentence =
        count === 0
          ? { before: t('morningReady.zero') }
          : splitSentence(t('morningReady.title', { count }), count);
      break;
  }
  return (
    <BriefingHero
      mode={mode}
      kicker={toUpper(kicker, lang)}
      sentence={sentence}
      {...(heroContext === undefined ? {} : { context: heroContext })}
      {...(primary === undefined ? {} : { primaryAction: primary })}
      {...(listen === undefined || hero.mode === 'generating' || hero.mode === 'silent_day'
        ? {}
        : { listenAction: listen })}
      testID="today.hero"
    />
  );
}

function PriorityItem({
  item,
  localDate,
}: {
  readonly item: TodayPriority;
  readonly localDate: string;
}) {
  const t = useTranslations('today');
  const common = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const badge = badgeOf(item.kind, item.urgency);
  const at = item.due_at ?? item.event_at;
  const time =
    at === null ? undefined : format.dateTime(new Date(at), { hour: '2-digit', minute: '2-digit' });
  const target =
    routeForEntity(item.entity_type, item.entity_id) ??
    routeForSource(item.source?.source_type, item.source?.source_id);
  const why = () => {
    sheets.open(INSIGHT_WHY_SHEET, { targetType: 'insight', targetId: item.id });
  };
  const openCard = () => {
    track('priority_opened', { kind: item.kind });
    if (target !== null) router.push(target);
    else why();
  };
  const snooze = () => {
    track('priority_action', { kind: item.kind, action: 'snooze' });
    sheets.open(SNOOZE_SHEET, { item, localDate });
  };
  const notImportant = () => {
    track('priority_action', { kind: item.kind, action: 'dismiss' });
    void applyFeedback(item, localDate, 'not_important', true);
  };
  const actions: CardAction[] = [
    {
      key: 'source',
      label: common('actions.viewSource'),
      onPress: why,
      emphasis: 'secondary',
    },
  ];
  const providerLabel =
    item.source?.provider === 'microsoft'
      ? common('providers.outlook')
      : item.source?.provider === 'google'
        ? common('providers.gmail')
        : null;
  const sourceStamp = item.source?.source_timestamp ?? null;
  const sourceTime =
    sourceStamp === null
      ? null
      : format.dateTime(new Date(sourceStamp), { hour: '2-digit', minute: '2-digit' });
  const sourceParts = [providerLabel, sourceTime].filter((p): p is string => p !== null);
  const label = t('cardA11y', {
    badge: common(`badges.${badge.key}`),
    time: time ?? '',
    title: item.title,
    subtitle: item.body ?? '',
  });
  return (
    <SwipeableRow
      right={{
        key: 'complete',
        label: common('actions.markDone'),
        icon: 'check_circle',
        onAction: () => {
          completeInsight(item, localDate, 'swipe');
        },
      }}
      left={[
        { key: 'snooze', label: common('actions.snooze'), icon: 'schedule', onAction: snooze },
        { key: 'dismiss', label: t('notImportant'), icon: 'remove_circle', onAction: notImportant },
      ]}
      accessibilityLabel={label}
      testID={`today.priority.${item.id}`}
    >
      {(verbs: readonly A11yAction[]) => (
        <PriorityCard
          title={item.title}
          {...(item.body === null ? {} : { subtitle: item.body })}
          badge={{ label: common(`badges.${badge.key}`), category: badge.category }}
          {...(time === undefined ? {} : { time })}
          {...(sourceParts.length === 0
            ? {}
            : {
                source: {
                  icon: 'mail',
                  parts: sourceParts,
                  onPress: why,
                  accessibilityLabel: t('sourceA11y', { source: sourceParts.join(', ') }),
                },
              })}
          actions={actions}
          onPress={openCard}
          onComplete={() => {
            completeInsight(item, localDate, 'button');
          }}
          completeLabel={common('actions.markDone')}
          onMore={() => {
            sheets.open(INSIGHT_CORRECTION_SHEET, { item, localDate });
          }}
          moreLabel={common('a11y.moreOptions')}
          a11yActions={[
            ...verbs,
            {
              key: 'more',
              label: common('a11y.moreOptions'),
              onPress: () => {
                sheets.open(INSIGHT_CORRECTION_SHEET, { item, localDate });
              },
            },
          ]}
          accessibilityLabel={label}
          testID={`today.card.${item.id}`}
        />
      )}
    </SwipeableRow>
  );
}

export function TodayScreen() {
  const t = useTranslations('today');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const format = useFormatter();
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const accounts = useAccounts();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  useDeviceCalendarSync(accounts.data?.accounts);
  const timeZone = bootstrap.data?.preferences.timezone ?? 'Europe/Istanbul';
  const localDate = localDateOf(now(), timeZone);
  const today = useToday(localDate);
  const [refreshing, setRefreshing] = useState(false);
  const [syncPhase, setSyncPhase] = useState<'idle' | 'syncing' | 'done'>('idle');
  const greeting = useGreeting(bootstrap.data);
  const viewed = useRef(false);

  const hero: HeroState | null =
    bootstrap.data === undefined || today.data === undefined
      ? null
      : resolveHero({
          now: now(),
          prefs: bootstrap.data.preferences,
          pro: isPro(),
          hasSources: bootstrap.data.accounts.length > 0,
          count: today.data.overview.hero_count,
          localDate: today.data.overview.local_date,
          briefings: today.data.briefings,
          gateDismissed: (feature) => isGateDismissed(feature),
        });

  useEffect(() => {
    if (hero === null || today.data === undefined || viewed.current) return;
    viewed.current = true;
    track('today_viewed', {
      hero_mode: analyticsHeroMode(hero.mode),
      priorities_count: today.data.overview.hero_count,
      has_alert: (bootstrap.data?.accounts ?? []).some(
        (a) => a.status === 'needs_reauth' || a.status === 'admin_consent_required',
      ),
    });
  }, [bootstrap.data?.accounts, hero, today.data]);

  const refresh = async () => {
    setRefreshing(true);
    setSyncPhase('syncing');
    const healthy = (bootstrap.data?.accounts ?? []).filter(
      (a) =>
        a.status === 'healthy' && a.provider !== 'apple_device' && a.provider !== 'android_device',
    );
    track('today_refreshed', { accounts: healthy.length });
    await Promise.all(
      healthy.map((a) =>
        getApiClient()
          .call('POST /integrations/:accountId/sync', { params: { accountId: a.id }, body: {} })
          .catch(() => undefined),
      ),
    );
    await Promise.all([
      today.refetch(),
      queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() }),
    ]);
    setRefreshing(false);
    setSyncPhase('done');
  };

  const title = greeting;
  const kicker = format.dateTime(now(), { day: 'numeric', month: 'long', year: 'numeric' });
  const approvals = today.data?.overview.pending_approvals_count ?? 0;
  const approvalsRoute = '/approvals';
  const header = (
    <RootHeader
      kicker={kicker}
      title={title}
      {...(approvals > 0 && isScreenAvailable(approvalsRoute)
        ? {
            trailing: (
              <HeaderPill
                label={t('approvalPill', { count: approvals })}
                icon="task_alt"
                accessibilityLabel={t('header.approvalsA11y', { count: approvals })}
                onPress={() => {
                  track('today_section_tapped', { section: 'approvals' });
                  router.push(approvalsRoute);
                }}
                testID="today.approvals"
              />
            ),
          }
        : {})}
      {...(isScreenAvailable('/settings')
        ? {
            avatar: {
              name:
                bootstrap.data?.profile.display_name ?? bootstrap.data?.profile.email ?? greeting,
              accessibilityLabel: t('header.profileA11y'),
              onPress: () => {
                track('avatar_tapped');
                router.push('/settings');
              },
            },
          }
        : {})}
    />
  );

  let body;
  if (bootstrap.data === undefined || (today.data === undefined && today.isPending)) {
    body = (
      <TodaySkeleton
        kicker={states('loading.label')}
        accessibilityLabel={states('loading.label')}
        testID="today.loading"
      />
    );
  } else if (today.data === undefined) {
    body = (
      <ErrorCard
        icon={online ? 'cloud_off' : 'wifi_off'}
        tone="neutral"
        title={online ? t('errors.title') : states('offline.noCache.title')}
        body={online ? t('errors.body') : states('offline.noCache.body')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void today.refetch();
          },
          loading: today.isFetching,
        }}
        testID="today.error"
      />
    );
  } else if (hero !== null) {
    const data = today.data;
    const shown = data.overview.priorities.slice(0, MAX_PRIORITIES);
    const priorityIds = new Set(data.overview.priorities.map((p) => p.id));
    const deadlines = data.overview.deadlines
      .filter((d) => !priorityIds.has(d.insight_id))
      .slice(0, 3);
    const followUps = data.overview.follow_ups
      .filter((f) => !priorityIds.has(f.insight_id))
      .slice(0, 3);
    const life = data.overview.life_intel.slice(0, 3);
    const evening =
      hero.mode === 'evening_ready' ||
      hero.mode === 'evening_confirmed' ||
      hero.mode === 'evening_gate';
    const weekly = data.briefings.find(
      (b) => b.kind === 'weekly' && (b.status === 'ready' || b.status === 'delivered'),
    );
    const captureRoute = '/capture';
    const time = (iso: string | null) =>
      iso === null ? '' : format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });
    body = (
      <View style={styles.sections}>
        <AccountAlert data={bootstrap.data} />
        <Hero hero={hero} data={data} bootstrap={bootstrap.data} online={online} />
        {weekly === undefined ? null : (
          <Card
            onPress={() => {
              track('weekly_card_opened');
              router.push(`/weekly/${weekly.id}`);
            }}
            accessibilityLabel={t('weekly.kicker')}
            testID="today.weekly"
          >
            <Text variant="kicker" tone="accent">
              {t('weekly.kicker')}
            </Text>
            {typeof weekly.weekly_stats?.mails_analyzed === 'number' ? (
              <Text variant="h3">
                {t('weekly.title', { count: weekly.weekly_stats.mails_analyzed })}
              </Text>
            ) : null}
            {typeof weekly.weekly_stats?.time_saved_min === 'number' ? (
              <Text variant="secondary" tone="secondary">
                {t('weekly.meta', { duration: formatDuration(weekly.weekly_stats.time_saved_min) })}
              </Text>
            ) : null}
          </Card>
        )}
        <AnnouncementBanner data={bootstrap.data} />
        {hero.mode === 'no_sources' ? null : (
          <View style={styles.section}>
            <SectionHeader
              title={evening ? t('sections.carryOver') : t('sections.priorities')}
              count={t('sections.itemCount', { count: data.overview.hero_count })}
            />
            {shown.length === 0 ? (
              <EmptyState
                icon="check_circle"
                tone="success"
                title={states('empty.today.title')}
                body={states('empty.today.body')}
                action={{
                  label: states('empty.today.cta'),
                  onPress: () => {
                    router.navigate('/flow');
                  },
                }}
                testID="today.empty"
              />
            ) : (
              shown.map((item) => <PriorityItem key={item.id} item={item} localDate={localDate} />)
            )}
            <View style={styles.footerActions}>
              {data.overview.hero_count > MAX_PRIORITIES ? (
                <TextAction
                  label={t('footer.seeAllInFlow')}
                  onPress={() => {
                    track('today_section_tapped', { section: 'priorities' });
                    router.navigate('/flow');
                  }}
                  testID="today.seeAll"
                />
              ) : null}
              {isScreenAvailable(captureRoute) ? (
                <TextAction
                  label={t('footer.add')}
                  icon="add"
                  onPress={() => {
                    router.push(captureRoute);
                  }}
                  testID="today.capture"
                />
              ) : null}
            </View>
          </View>
        )}
        {data.overview.next_meeting === null ? null : (
          <View style={styles.section}>
            <SectionHeader
              title={t('sections.schedule')}
              count={t('sections.eventCount', { count: 1 })}
            />
            <Card
              {...(isScreenAvailable(`/event/${data.overview.next_meeting.id}`)
                ? {
                    onPress: () => {
                      track('today_section_tapped', { section: 'meeting' });
                      router.push(`/event/${data.overview.next_meeting?.id ?? ''}`);
                    },
                  }
                : {})}
              accessibilityLabel={t('meetingA11y', {
                time: time(data.overview.next_meeting.start_at),
                title: data.overview.next_meeting.title,
              })}
              testID="today.meeting"
            >
              <TimelineRow
                time={time(data.overview.next_meeting.start_at)}
                title={data.overview.next_meeting.title}
                {...((data.overview.next_meeting.attendee_count ?? 0) > 1
                  ? {
                      status: t('attendees', {
                        count: data.overview.next_meeting.attendee_count ?? 0,
                      }),
                    }
                  : {})}
              />
            </Card>
          </View>
        )}
        {deadlines.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader title={t('sections.deadlines')} />
            <GroupedList testID="today.deadlines">
              {deadlines.map((d) => (
                <ListRow
                  key={d.insight_id}
                  title={d.title}
                  {...(d.due_at === null ? {} : { subtitle: time(d.due_at) })}
                  icon="flag"
                  onPress={() => {
                    track('today_section_tapped', { section: 'deadline' });
                    sheets.open(INSIGHT_WHY_SHEET, {
                      targetType: 'insight',
                      targetId: d.insight_id,
                    });
                  }}
                />
              ))}
            </GroupedList>
          </View>
        )}
        {followUps.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader title={t('sections.followUps')} />
            <GroupedList testID="today.followUps">
              {followUps.map((f) => (
                <ListRow
                  key={f.insight_id}
                  title={f.title}
                  icon="schedule_send"
                  onPress={() => {
                    track('today_section_tapped', { section: 'follow_up' });
                    sheets.open(INSIGHT_WHY_SHEET, {
                      targetType: 'insight',
                      targetId: f.insight_id,
                    });
                  }}
                />
              ))}
            </GroupedList>
          </View>
        )}
        {life.length === 0 ? null : (
          <View style={styles.section}>
            <SectionHeader
              title={t('sections.digitalLife')}
              action={
                <TextAction
                  label={common('actions.all')}
                  compact
                  onPress={() => {
                    track('today_section_tapped', { section: 'life' });
                    router.navigate('/flow?filter=kisisel');
                  }}
                  testID="today.lifeAll"
                />
              }
            />
            <GroupedList testID="today.life">
              {life.map((l) => {
                const route = routeForSource('life_event', l.id);
                return (
                  <ListRow
                    key={l.id}
                    title={l.title}
                    {...((l.event_at ?? l.due_at) === null
                      ? {}
                      : { subtitle: time(l.event_at ?? l.due_at) })}
                    icon={
                      l.type === 'flight'
                        ? 'flight'
                        : l.type === 'shipment'
                          ? 'local_shipping'
                          : l.type === 'payment'
                            ? 'account_balance_wallet'
                            : l.type === 'reservation'
                              ? 'restaurant'
                              : l.type === 'security'
                                ? 'shield'
                                : 'redeem'
                    }
                    {...(route === null
                      ? {}
                      : {
                          onPress: () => {
                            track('today_section_tapped', { section: 'life' });
                            router.push(route);
                          },
                          trailing: { kind: 'chevron' as const },
                        })}
                  />
                );
              })}
            </GroupedList>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void refresh();
          }}
          tintColor={theme.color.brand.primary}
          colors={[theme.color.brand.primary]}
        />
      }
      testID="tab.today"
    >
      {header}
      <View style={[styles.body, { paddingHorizontal: theme.layout.screenX }]}>
        <SyncLine
          phase={syncPhase}
          doneLabel={t('refresh.updated', {
            time: format.dateTime(now(), { hour: '2-digit', minute: '2-digit' }),
          })}
          onDoneHidden={() => {
            setSyncPhase('idle');
          }}
        />
        {online ? null : (
          <OfflineBanner
            message={states('offline.blockedReason')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void today.refetch();
            }}
            testID="today.offline"
          />
        )}
        {body}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  body: { gap: 16 },
  sections: { gap: 20 },
  section: { gap: 10 },
  footerActions: { flexDirection: 'row', justifyContent: 'space-between' },
});
