/**
 * Sheets shared by the Flow, Mail, Follow-up, Commitment, Life, Plan and Meeting screens, drawn by
 * the global `SheetHost` (M-GL-06):
 * - `m2.menu`: the "···" action list (swipe verbs mirrored as visible options, SREQ-82);
 * - `m2.snooze`: "Ertele" with absolute times (1 saat sonra · Bu akşam · Yarın sabah) → RPC-01 /
 *   RPC-06 snoozed, undo toast;
 * - `m2.reminder`: the in-app reminder with a confirm step (C-08, M§29): non-smart presets with
 *   their absolute time → `POST /reminders` (`channel:'push'`). "Uygun zamanda", "Kendin seç" and
 *   external destinations belong to the Smart Reminder sheet of T-8.18;
 * - `m2.source`: "Bu nereden çıktı?" (M-SRC-01) from RPC-16 `get_explanation`;
 * - `m2.link`: the phishing-safe external link confirmation (M-MAIL-05).
 */
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { assessLink, resolvePreset, type ReminderPreset, type SourceType } from '@da/domain';
import {
  BottomSheet,
  Button,
  GroupedList,
  HintRow,
  OptionRow,
  SkeletonBlock,
  Text,
  WhySheetContent,
  useTheme,
  useToast,
  type DecisionTierKind,
  type IconName,
} from '@da/ui';
import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { now } from '../../lib/clock';
import { callRpc } from '../../lib/data/rpc';
import { makeFormats, useSessionContext, type Formats } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { mountSheet } from './mount';
import { openInBrowser, openWithOs } from './handoff';
import { useCommitmentActions, useInsightActions } from './insights';
import { useOfflineGuard } from './ui';

// ── "···" menu ────────────────────────────────────────────────────────────────────────────

export interface MenuOption {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface MenuParams {
  readonly title?: string;
  readonly options: readonly MenuOption[];
}

function MenuSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<MenuParams>) {
  const tc = useTranslations('common');
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      {...(params.title === undefined ? {} : { title: params.title })}
      accessibilityLabel={params.title ?? tc('a11y.moreOptions')}
      testID="m2.menu"
    >
      <GroupedList>
        {params.options.map((option) => (
          <OptionRow
            key={option.key}
            role="button"
            label={option.label}
            {...(option.icon === undefined ? {} : { icon: option.icon })}
            {...(option.disabled === true ? { disabled: true } : {})}
            {...(option.disabledReason === undefined
              ? {}
              : { disabledReason: option.disabledReason })}
            onPress={() => {
              onDismiss();
              option.onPress();
            }}
            testID={`m2.menu.${option.key}`}
          />
        ))}
      </GroupedList>
    </BottomSheet>
  );
}

registerSheet('m2.menu', mountSheet(MenuSheet), { analyticsKey: 'filter' });

export function openMenu(params: MenuParams): void {
  sheets.open('m2.menu', params);
}

// ── Snooze ─────────────────────────────────────────────────────────────────────────────────

export interface SnoozeParams {
  readonly target: 'insight' | 'commitment';
  readonly id: string;
  /** Cached lists the item disappears from while snoozed. */
  readonly roots: readonly QueryKey[];
  readonly via?: 'swipe' | 'button' | 'a11y';
}

interface TimeOption {
  readonly key: string;
  readonly label: string;
  readonly at: Date;
}

function snoozeOptions(
  formats: Formats,
  prefs: { readonly eveningTime?: string; readonly morningTime?: string },
  t: (key: 'inHour' | 'thisEvening' | 'tomorrowMorning') => string,
): TimeOption[] {
  const at = now();
  const options: TimeOption[] = [
    { key: 'hour', label: t('inHour'), at: new Date(at.getTime() + 60 * 60_000) },
  ];
  const ctx = { now: at, timeZone: formats.timeZone, prefs };
  const evening = resolvePreset('this_evening', ctx);
  if (evening.valid && evening.fireAt !== null) {
    options.push({ key: 'evening', label: t('thisEvening'), at: evening.fireAt });
  }
  const morning = resolvePreset('tomorrow_morning', ctx);
  if (morning.valid && morning.fireAt !== null) {
    options.push({ key: 'morning', label: t('tomorrowMorning'), at: morning.fireAt });
  }
  return options;
}

function SnoozeSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<SnoozeParams>) {
  const t = useTranslations('flow.snooze');
  const session = useSessionContext();
  const formats = makeFormats(session.timeZone, session.locale);
  const insights = useInsightActions(params.roots);
  const commitments = useCommitmentActions(params.roots);
  const options = snoozeOptions(
    formats,
    {
      ...(session.data?.preferences.evening_time === undefined
        ? {}
        : { eveningTime: session.data.preferences.evening_time.slice(0, 5) }),
      ...(session.data?.preferences.morning_time === undefined
        ? {}
        : { morningTime: session.data.preferences.morning_time.slice(0, 5) }),
    },
    (key) => t(key),
  );
  const choose = (option: TimeOption) => {
    onDismiss();
    const when = `${option.label} · ${formats.time(option.at)}`;
    if (params.target === 'insight') {
      insights.setStatus({
        id: params.id,
        to: 'snoozed',
        via: params.via ?? 'button',
        snoozedUntil: option.at.toISOString(),
        message: t('done', { when }),
      });
    } else {
      commitments.change({
        id: params.id,
        status: 'snoozed',
        due: option.at.toISOString(),
        message: t('done', { when }),
      });
    }
  };
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      testID="m2.snooze"
    >
      <GroupedList>
        {options.map((option) => (
          <OptionRow
            key={option.key}
            role="button"
            icon="schedule"
            label={option.label}
            meta={
              formats.relativeDay(option.at) === 'today'
                ? formats.time(option.at)
                : `${formats.dayMonth(option.at)} ${formats.time(option.at)}`
            }
            onPress={() => {
              choose(option);
            }}
            testID={`m2.snooze.${option.key}`}
          />
        ))}
      </GroupedList>
    </BottomSheet>
  );
}

registerSheet('m2.snooze', mountSheet(SnoozeSheet), { analyticsKey: 'snooze' });

export function openSnooze(params: SnoozeParams): void {
  sheets.open('m2.snooze', params);
}

// ── Reminder (in-app, confirm step) ────────────────────────────────────────────────────────

export type ReminderOrigin =
  | 'email_detail'
  | 'today'
  | 'deadline'
  | 'meeting'
  | 'commitment'
  | 'life_event'
  | 'followup'
  | 'assistant'
  | 'plan';

export interface ReminderParams {
  readonly title: string;
  readonly origin: ReminderOrigin;
  readonly anchorAt?: string | null;
  readonly subject?: { readonly type: SourceType; readonly id: string };
  /** Preselected preset (the confirm tap is still required, C-28). */
  readonly preset?: ReminderPreset;
}

const IN_APP_PRESETS: readonly ReminderPreset[] = [
  'before_30m',
  'before_1h',
  'this_evening',
  'tomorrow_morning',
];

function ReminderSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<ReminderParams>) {
  const t = useTranslations('reminder');
  const tr = useTranslations('flow.reminder');
  const toast = useToast();
  const client = useApiClient();
  const online = useOnline();
  const session = useSessionContext();
  const formats = makeFormats(session.timeZone, session.locale);
  const blocked = useOfflineGuard();
  const [selected, setSelected] = useState<ReminderPreset | null>(params.preset ?? null);
  const create = useMutation(apiMutationOptions(client, 'POST /reminders'));
  const prefs = {
    ...(session.data?.preferences.evening_time === undefined
      ? {}
      : { eveningTime: session.data.preferences.evening_time.slice(0, 5) }),
    ...(session.data?.preferences.morning_time === undefined
      ? {}
      : { morningTime: session.data.preferences.morning_time.slice(0, 5) }),
  };
  const anchor = params.anchorAt ?? null;
  const resolutions = IN_APP_PRESETS.map((preset) =>
    resolvePreset(preset, {
      now: now(),
      timeZone: session.timeZone,
      anchorAt: anchor,
      prefs,
    }),
  ).filter((r) => !r.hidden && r.valid && r.fireAt !== null);
  const chosen = resolutions.find((r) => r.preset === selected) ?? null;

  const confirm = () => {
    const fireAt = chosen?.fireAt ?? null;
    if (chosen === null || fireAt === null || blocked('smart_reminder')) return;
    create.mutate(
      {
        input: {
          body: {
            client_reminder_id: Crypto.randomUUID(),
            title: params.title.slice(0, 200),
            preset: chosen.preset,
            fire_at: fireAt.toISOString(),
            ...(anchor === null ? {} : { anchor_at: anchor }),
            channel: 'push',
            ...(params.subject === undefined ? {} : { subject: params.subject }),
            origin: params.origin,
          },
        },
      },
      {
        onSuccess: () => {
          track('reminder_created', {
            target_type: params.subject?.type ?? 'reminder',
            learning_enabled: session.learnFromInteractions,
          });
          onDismiss();
          toast.show({
            message: t('set', { when: `${formats.dayMonth(fireAt)} ${formats.time(fireAt)}` }),
            kind: 'success',
          });
        },
        onError: () => {
          toast.show({ message: tr('failed'), kind: 'error' });
        },
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      subtitle={params.title}
      dismissible={!create.isPending}
      footer={
        <Button
          label={t('confirm')}
          onPress={confirm}
          disabled={chosen === null || !online}
          loading={create.isPending}
          fullWidth
          testID="m2.reminder.confirm"
        />
      }
      testID="m2.reminder"
    >
      {resolutions.length === 0 ? (
        <HintRow text={tr('noTimes')} />
      ) : (
        <GroupedList>
          {resolutions.map((r) => (
            <OptionRow
              key={r.preset}
              role="radio"
              icon="notifications"
              label={t(`presets.${r.preset}`)}
              meta={
                r.fireAt === null ? '' : `${formats.dayMonth(r.fireAt)} ${formats.time(r.fireAt)}`
              }
              selected={selected === r.preset}
              onPress={() => {
                setSelected(r.preset);
              }}
              testID={`m2.reminder.${r.preset}`}
            />
          ))}
        </GroupedList>
      )}
      {online ? null : <HintRow text={tr('offline')} />}
    </BottomSheet>
  );
}

registerSheet('m2.reminder', mountSheet(ReminderSheet), { analyticsKey: 'reminder' });

export function openReminder(params: ReminderParams): void {
  track('reminder_sheet_open', { origin: params.origin, mode: 'remind' });
  sheets.open('m2.reminder', params);
}

// ── Source / explainability ────────────────────────────────────────────────────────────────

export type ExplainTarget =
  | 'insight'
  | 'email_thread'
  | 'email_message'
  | 'commitment'
  | 'life_event'
  | 'approval_action'
  | 'meeting_prep';

export interface SourceParams {
  readonly targetType: ExplainTarget;
  readonly targetId: string;
  readonly origin: 'email_detail' | 'flow' | 'life' | 'commitment' | 'approval' | 'plan';
}

const Explanation = z
  .object({
    reason_text: z.string().nullable(),
    decision_tier: z
      .enum(['explicit_rule', 'learned_preference', 'deterministic_signal', 'ai_classification'])
      .nullable(),
    confidence: z.number().nullable(),
    sources: z.array(
      z.object({
        source_type: z.string(),
        provider: z.string().nullable(),
        account_label: z.string().nullable(),
        display: z.string().nullable(),
        source_timestamp: z.string().nullable(),
        evidence: z.array(z.looseObject({ quote: z.string().optional() })).nullable(),
        in_app_deeplink: z.string().nullable(),
      }),
    ),
  })
  .nullable();

/** `dijitalasistan://mail/<id>` → `/mail/<id>` when that screen exists. */
export function inAppPath(deeplink: string | null | undefined): string | null {
  if (deeplink === null || deeplink === undefined) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/\/?(.*)$/i.exec(deeplink);
  const path = `/${match?.[1] ?? deeplink.replace(/^\//, '')}`;
  return isScreenAvailable(path) ? path : null;
}

function SourceSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<SourceParams>) {
  const t = useTranslations('explain');
  const tc = useTranslations('common');
  const theme = useTheme();
  const router = useRouter();
  const session = useSessionContext();
  const formats = makeFormats(session.timeZone, session.locale);
  const query = useQuery({
    queryKey: ['explain', params.targetType, params.targetId],
    queryFn: async () =>
      Explanation.parse(
        await callRpc('get_explanation', {
          p_target_type: params.targetType,
          p_target_id: params.targetId,
        }),
      ),
  });
  const data = query.data;
  const source = data?.sources[0];
  const tier: DecisionTierKind = data?.decision_tier ?? 'deterministic_signal';
  const path = inAppPath(source?.in_app_deeplink);
  const parts = [
    source?.account_label ?? null,
    source?.display ?? null,
    source?.source_timestamp === null || source?.source_timestamp === undefined
      ? null
      : formats.dayMonth(source.source_timestamp),
  ].filter((p): p is string => p !== null && p !== '');
  const quote = source?.evidence?.find((e) => typeof e.quote === 'string')?.quote;

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('whereFrom')}
      testID="m2.source"
    >
      {query.isPending ? (
        <View style={{ gap: theme.space[2] }}>
          <SkeletonBlock height={16} width="80%" />
          <SkeletonBlock height={14} width="60%" />
        </View>
      ) : data === null || data === undefined ? (
        <HintRow text={tc('provenance.notConfirmed')} />
      ) : (
        <WhySheetContent
          title={t('whyImportant')}
          reason={data.reason_text ?? tc('provenance.notConfirmed')}
          tier={{ kind: tier, text: t(`tiers.${tier}`) }}
          {...(source === undefined
            ? {}
            : {
                source: {
                  icon: source.source_type.startsWith('email') ? 'mail' : 'description',
                  parts,
                  openLabel: t('source.open'),
                  onOpen: () => {
                    onDismiss();
                    if (path !== null) router.push(path);
                  },
                },
              })}
        >
          {quote === undefined ? null : (
            <Text variant="secondary" tone="secondary">
              {t('source.quoted', { quote })}
            </Text>
          )}
          {data.confidence === null ? null : (
            <Text variant="meta" tone="tertiaryStrong">
              {data.confidence < 0.7
                ? tc('provenance.notSure')
                : t('confidence', { percent: Math.round(data.confidence * 100) })}
            </Text>
          )}
        </WhySheetContent>
      )}
    </BottomSheet>
  );
}

registerSheet('m2.source', mountSheet(SourceSheet), { analyticsKey: 'source' });

export function openSource(params: SourceParams): void {
  track('source_sheet_open', { origin: params.origin, target_type: params.targetType });
  sheets.open('m2.source', params);
}

// ── External link confirmation (M-MAIL-05) ─────────────────────────────────────────────────

export interface LinkParams {
  readonly href: string;
  readonly anchorText?: string;
  readonly context: 'email' | 'life' | 'event';
}

function LinkSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<LinkParams>) {
  const t = useTranslations('mail.link');
  const tc = useTranslations('common.actions');
  const toast = useToast();
  const assessment = assessLink(params.href, params.anchorText);
  const httpLike = assessment.scheme === 'https:';
  const openable = assessment.openable || assessment.scheme === 'tel:';
  const mismatch = assessment.warnings.includes('anchor_mismatch');
  const domain = assessment.host?.display ?? '';
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={openable ? t('title') : t('unsupported')}
      {...(openable && domain !== '' ? { subtitle: t('domain', { domain }) } : {})}
      footer={
        <View style={{ gap: 8 }}>
          {openable ? (
            <Button
              label={t('open')}
              fullWidth
              onPress={() => {
                onDismiss();
                track('external_link_open', { context: params.context, mismatch });
                void (httpLike ? openInBrowser(params.href) : openWithOs(params.href)).then(
                  (ok) => {
                    if (!ok) toast.show({ message: t('failed'), kind: 'error' });
                  },
                );
              }}
              testID="m2.link.open"
            />
          ) : null}
          <Button label={tc('nevermind')} variant="text" fullWidth onPress={onDismiss} />
        </View>
      }
      testID="m2.link"
    >
      {mismatch ? <HintRow text={t('mismatch')} /> : null}
    </BottomSheet>
  );
}

registerSheet('m2.link', mountSheet(LinkSheet), { analyticsKey: 'confirm' });

export function openLink(params: LinkParams): void {
  sheets.open('m2.link', params);
}

/** Registers every sheet of this module (imported for its side effect by screens). */
export const M2_SHEETS = ['m2.menu', 'm2.snooze', 'm2.reminder', 'm2.source', 'm2.link'] as const;
