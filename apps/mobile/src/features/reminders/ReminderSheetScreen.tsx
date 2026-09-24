/**
 * M-REM-01 Akıllı Hatırlatıcı (`/reminders/new`, a `transparentModal` route drawn as the kit sheet)
 * with its pages M-REM-02 "Kendin seç" and M-REM-03 "Nereye". The product's single reminder
 * component (SREQ-35): the six M§29 presets with absolute times (`@da/domain` `resolvePreset`),
 * "Uygun zamanda" resolved by the server (`POST /reminders/resolve-time`, 8 s timeout) with its
 * reason, "Kendin seç", and an explicit confirm (M§29, C-08) — nothing is created before the CTA.
 * External destinations (Apple Anımsatıcılar, Google Görevler, Microsoft To Do) become approvals
 * (`reminder_create` / `task_create`) shown in the inline approval sheet. Snooze mode (`mode=snooze`)
 * offers the evening / morning / smart / custom presets and the "Zamanı gelince bildir" switch.
 */
import { qk } from '@da/api-client';
import { reminderResolveTimeMutationOptions } from '@da/api-client/react';
import { resolvePreset, type PresetResolution } from '@da/domain';
import { formatRelativeDay } from '@da/i18n';
import { BottomSheet, Button, InlineErrorCard, ListRow, OptionRow, Text, useTheme } from '@da/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { useApiClient } from '@da/api-client/react';
import { installationId } from '../../lib/auth/first-run-purge';
import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { DateTimeFields, useLang, userTimeZone } from '../common/DateTimeFields';
import { propose, type ProposeBody } from '../approvals/api';
import { handleDecisionError } from '../approvals/decide';
import { openApprovalSheet } from '../approvals/ApprovalSheet';
import { reminderListHash } from '../approvals/device-executor';
import { createInAppReminder, snooze, type ReminderOrigin, type ReminderPresetKey } from './create';
import {
  ensureNotificationPermission,
  notificationPermission,
  openNotificationSettings,
} from '../../lib/notifications/local-reminders';

const REMIND_PRESETS: readonly ReminderPresetKey[] = [
  'before_30m',
  'before_1h',
  'this_evening',
  'tomorrow_morning',
  'smart',
  'custom',
];
const SNOOZE_PRESETS: readonly ReminderPresetKey[] = [
  'this_evening',
  'tomorrow_morning',
  'smart',
  'custom',
];
const YEAR_MS = 365 * 86_400_000;
const MINUTE = 60_000;

const ORIGINS: readonly ReminderOrigin[] = [
  'email_detail',
  'today',
  'deadline',
  'meeting',
  'commitment',
  'life_event',
  'followup',
  'assistant',
  'plan',
];

type Destination =
  | { readonly kind: 'in_app' }
  | { readonly kind: 'apple_reminders'; readonly listId: string; readonly listTitle: string }
  | {
      readonly kind: 'google_tasks' | 'microsoft_todo';
      readonly accountId: string;
      readonly email: string;
      readonly listId: string;
    };

type Step = 'main' | 'custom' | 'destination';

export interface ReminderParams {
  readonly targetType?: string;
  readonly targetId?: string;
  readonly title?: string;
  readonly anchorAt?: string;
  readonly anchorDateOnly?: string;
  readonly preset?: string;
  readonly mode?: string;
  readonly origin?: string;
}

function presetKey(value: string | undefined): ReminderPresetKey | null {
  return (REMIND_PRESETS as readonly (string | undefined)[]).includes(value)
    ? (value as ReminderPresetKey)
    : null;
}

/** The in-app route a reminder's notification opens (`data.deeplink`). */
export function reminderTargetRoute(targetType: string | undefined, targetId: string | undefined) {
  if (targetId === undefined || targetId === '') return null;
  switch (targetType) {
    case 'email_message':
      return `/mail/${targetId}`;
    case 'commitment':
      return `/commitments/${targetId}`;
    case 'life_event':
      return `/life/${targetId}`;
    case 'calendar_event':
      return `/event/${targetId}`;
    case 'capture_item':
      return `/capture/${targetId}`;
    default:
      return '/today';
  }
}

interface SmartState {
  readonly status: 'idle' | 'loading' | 'ready' | 'none' | 'error';
  readonly fireAt: Date | null;
  readonly reason: string | null;
}

function useExistingReminder(targetType: string | undefined, targetId: string | undefined) {
  return useQuery({
    queryKey: qk.reminders.forTarget(targetType ?? '', targetId ?? ''),
    enabled: targetType !== undefined && targetId !== undefined && targetId !== '',
    queryFn: async () => {
      const { data } = (await getSupabase()
        .from('reminders')
        .select('id, remind_at')
        .eq('target_type', targetType ?? '')
        .eq('target_id', targetId ?? '')
        .eq('status', 'scheduled')
        .order('remind_at', { ascending: true })
        .limit(1)) as { data: { id: string; remind_at: string }[] | null };
      return data?.[0] ?? null;
    },
  });
}

async function providerListId(accountId: string, provider: 'google' | 'microsoft') {
  const { data } = (await getSupabase()
    .from('tasks')
    .select('provider_list_id')
    .eq('connected_account_id', accountId)
    .limit(20)) as { data: { provider_list_id: string | null }[] | null };
  const known = (data ?? []).map((r) => r.provider_list_id).find((id) => id !== null && id !== '');
  if (known !== undefined && known !== null) return known;
  // Google Tasks accepts `@default`; Microsoft To Do needs a known list id.
  return provider === 'google' ? '@default' : null;
}

export function ReminderSheetScreen() {
  const params = useLocalSearchParams() as ReminderParams;
  const t = useTranslations('reminder');
  const common = useTranslations('common');
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();
  const api = useApiClient();
  const lang = useLang();
  const tz = userTimeZone();
  const bootstrap = cachedBootstrap();
  const snoozeMode = params.mode === 'snooze';
  const title = params.title ?? '';
  const anchorAt =
    params.anchorAt !== undefined && !Number.isNaN(Date.parse(params.anchorAt))
      ? params.anchorAt
      : null;
  const origin: ReminderOrigin = (ORIGINS as readonly (string | undefined)[]).includes(
    params.origin,
  )
    ? (params.origin as ReminderOrigin)
    : 'today';
  const [visible, setVisible] = useState(true);
  const [step, setStep] = useState<Step>('main');
  const [selected, setSelected] = useState<ReminderPresetKey | null>(presetKey(params.preset));
  const [customAt, setCustomAt] = useState<Date | null>(null);
  const [draftCustom, setDraftCustom] = useState<Date>(() => {
    const anchor = anchorAt === null ? null : new Date(anchorAt);
    const inHour = anchor === null ? null : new Date(anchor.getTime() - 60 * MINUTE);
    if (inHour !== null && inHour.getTime() > now().getTime()) return inHour;
    const morning = resolvePreset('tomorrow_morning', { now: now(), timeZone: tz }).fireAt;
    return morning ?? new Date(now().getTime() + 60 * MINUTE);
  });
  const [destination, setDestination] = useState<Destination>({ kind: 'in_app' });
  const [notify, setNotify] = useState(true);
  const [smart, setSmart] = useState<SmartState>(() => ({
    status: 'idle',
    fireAt: null,
    reason: null,
  }));
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined'>('granted');
  const [submitting, setSubmitting] = useState(false);
  const [appleDenied, setAppleDenied] = useState(false);
  const opened = useRef(false);
  const existing = useExistingReminder(params.targetType, params.targetId);
  const calendarConnected = (bootstrap?.accounts ?? []).some((a) =>
    (a.capabilities_granted as readonly string[]).includes('calendar_read'),
  );
  const resolveTime = useMutation(reminderResolveTimeMutationOptions(api));

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    track('reminder_sheet_open', { origin, mode: snoozeMode ? 'snooze' : 'remind' });
    void notificationPermission()
      .then(setPermission)
      .catch(() => undefined);
  }, [origin, snoozeMode]);

  const requestSmart = () => {
    resolveTime.mutate(
      { body: { presets: ['smart'], ...(anchorAt === null ? {} : { anchor_at: anchorAt }) } },
      {
        onSuccess: (data) => {
          const option = data.options.find((o) => o.preset === 'smart');
          if (option?.valid === true && option.fire_at !== null) {
            setSmart({
              status: 'ready',
              fireAt: new Date(option.fire_at),
              reason: option.reason_text,
            });
            track('reminder_smart_resolve', { result: 'slot' });
          } else {
            setSmart({ status: 'none', fireAt: null, reason: null });
            track('reminder_smart_resolve', { result: 'no_slot' });
          }
        },
        onError: () => {
          setSmart({ status: 'error', fireAt: null, reason: null });
          track('reminder_smart_resolve', { result: 'error' });
        },
      },
    );
  };
  const runSmart = () => {
    if (!online || !calendarConnected) return;
    setSmart({ status: 'loading', fireAt: null, reason: null });
    requestSmart();
  };
  const smartRequested = useRef(false);
  useEffect(() => {
    // Resolve once when the sheet opens; an explicit retry runs `runSmart`.
    if (smartRequested.current || !online || !calendarConnected) return;
    smartRequested.current = true;
    requestSmart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefs = bootstrap?.preferences;
  const quiet = bootstrap?.notification_preferences;
  const context = {
    now: now(),
    timeZone: tz,
    anchorAt,
    anchorDateOnly: params.anchorDateOnly === 'true',
    prefs: {
      ...(prefs === undefined
        ? {}
        : {
            eveningTime: prefs.evening_time.slice(0, 5),
            morningTime: prefs.morning_time.slice(0, 5),
            workingHours: {
              start: prefs.working_hours_start.slice(0, 5),
              end: prefs.working_hours_end.slice(0, 5),
              days: prefs.work_days,
            },
          }),
      quietHours:
        quiet === undefined
          ? null
          : {
              enabled: quiet.quiet_hours_enabled,
              start: quiet.quiet_start.slice(0, 5),
              end: quiet.quiet_end.slice(0, 5),
            },
    },
    calendarConnected,
    customAt,
  };
  const label = (at: Date) =>
    formatRelativeDay(at, { locale: lang, now: now().getTime(), timeZone: tz });
  const resolutions = new Map<ReminderPresetKey, PresetResolution>(
    (snoozeMode ? SNOOZE_PRESETS : REMIND_PRESETS)
      .filter((p) => p !== 'smart')
      .map((p) => [p, resolvePreset(p, context)]),
  );
  const fireAtOf = (preset: ReminderPresetKey | null): Date | null => {
    if (preset === null) return null;
    if (preset === 'smart') return smart.fireAt;
    const resolution = resolutions.get(preset);
    return resolution?.valid === true ? resolution.fireAt : null;
  };
  const fireAt = fireAtOf(selected);
  const external = destination.kind !== 'in_app';

  const close = () => {
    setVisible(false);
  };
  const submit = async () => {
    if (selected === null || fireAt === null || submitting) return;
    const timeLabel = label(fireAt);
    const subject =
      params.targetType !== undefined && params.targetId !== undefined
        ? { type: params.targetType, id: params.targetId }
        : null;
    const deeplink = reminderTargetRoute(params.targetType, params.targetId);
    if (external) {
      if (!online) return;
      setSubmitting(true);
      const payload =
        destination.kind === 'apple_reminders'
          ? {
              action_type: 'reminder_create',
              destination: {
                kind: 'device',
                provider: 'apple_device',
                installation_id: installationId() ?? '',
                reminder_list_hash: await reminderListHash(destination.listId),
              },
              title: title.slice(0, 200),
              preset: selected,
              fire_at: fireAt.toISOString(),
              ...(anchorAt === null ? {} : { anchor_at: anchorAt }),
              time_zone: tz,
            }
          : {
              action_type: 'task_create',
              target: {
                kind: 'provider',
                connected_account_id: destination.accountId,
                task_list_id: destination.listId,
              },
              title: title.slice(0, 1024),
              due:
                destination.kind === 'google_tasks'
                  ? {
                      kind: 'date',
                      date: new Intl.DateTimeFormat('en-CA', {
                        timeZone: tz,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      }).format(fireAt),
                    }
                  : { kind: 'date_time', at: fireAt.toISOString(), time_zone: tz },
            };
      const result = await propose({
        payload,
        origin: 'reminder_sheet',
        origin_ref_id: null,
      } as unknown as ProposeBody);
      setSubmitting(false);
      if (!result.ok) {
        handleDecisionError(null, result.error);
        return;
      }
      track('reminder_created', {
        preset: selected,
        destination: destination.kind,
        mode: snoozeMode ? 'snooze' : 'remind',
        queued: false,
      });
      close();
      openApprovalSheet({ approvals: [result.model], mode: 'single', origin: 'reminder_sheet' });
      return;
    }
    setSubmitting(true);
    const granted = await ensureNotificationPermission().catch(() => 'denied' as const);
    setPermission(granted);
    const inApp = {
      title: title === '' ? t('title') : title,
      preset: selected,
      fireAt,
      anchorAt,
      timeLabel,
      origin,
      subject,
      deeplink,
      mode: snoozeMode ? ('snooze' as const) : ('remind' as const),
      replaces: existing.data?.id ?? null,
    };
    if (snoozeMode && (params.targetType === 'insight' || params.targetType === 'commitment')) {
      const ok = await snooze({
        targetType: params.targetType,
        targetId: params.targetId ?? '',
        until: fireAt,
        timeLabel,
        notify: notify ? inApp : null,
      });
      setSubmitting(false);
      if (ok) close();
      return;
    }
    await createInAppReminder(inApp);
    setSubmitting(false);
    close();
  };

  const presetMeta = (preset: ReminderPresetKey): { meta?: string; disabled?: string } => {
    if (preset === 'smart') {
      if (!calendarConnected) return { disabled: t('meta.noCalendar') };
      if (!online) return { disabled: t('meta.offline') };
      if (smart.status === 'loading' || resolveTime.isPending)
        return { meta: t('smart.resolving') };
      if (smart.status === 'error') return { meta: t('meta.smartFailed') };
      if (smart.status === 'none') return { disabled: t('smart.noSlot') };
      if (smart.fireAt !== null) return { meta: label(smart.fireAt) };
      return {};
    }
    if (preset === 'custom') {
      return customAt === null ? {} : { meta: label(customAt) };
    }
    const resolution = resolutions.get(preset);
    if (resolution === undefined) return {};
    if (!resolution.valid) {
      return {
        disabled: resolution.invalidReason === 'no_anchor' ? t('meta.noTime') : t('meta.past'),
      };
    }
    const at = resolution.fireAt;
    if (at === null) return {};
    return { meta: resolution.inQuietHours ? t('meta.quiet', { time: label(at) }) : label(at) };
  };

  const destinationLabel =
    destination.kind === 'in_app'
      ? t('destination.inApp')
      : destination.kind === 'apple_reminders'
        ? t('destination.apple')
        : destination.kind === 'google_tasks'
          ? t('destination.googleWith', { email: destination.email })
          : t('destination.microsoftWith', { email: destination.email });

  const cta =
    fireAt === null
      ? external
        ? t('cta.approval')
        : snoozeMode
          ? t('cta.snoozePlain')
          : t('confirm')
      : external
        ? t('cta.approval')
        : snoozeMode
          ? t('cta.snooze', { time: label(fireAt) })
          : t('cta.remind', { time: label(fireAt) });

  const main = (
    <View style={styles.body} accessibilityRole="radiogroup" testID="reminder.main">
      {existing.data !== null && existing.data !== undefined ? (
        <Text variant="meta" tone="tertiaryStrong" testID="reminder.existing">
          {t('existing', { time: label(new Date(existing.data.remind_at)) })}
        </Text>
      ) : null}
      {(snoozeMode ? SNOOZE_PRESETS : REMIND_PRESETS).map((preset) => {
        const resolution = resolutions.get(preset);
        if (resolution?.hidden === true) return null;
        const { meta, disabled } = presetMeta(preset);
        return (
          <OptionRow
            key={preset}
            label={t(`presets.${preset}`)}
            {...(meta === undefined ? {} : { meta })}
            {...(preset === 'smart' ? { ai: true } : {})}
            {...(preset === 'smart' && smart.reason !== null
              ? { subtitle: smart.reason, twoLine: true }
              : {})}
            selected={selected === preset}
            role="radio"
            {...(disabled === undefined ? {} : { disabled: true, disabledReason: disabled })}
            onPress={() => {
              if (preset === 'custom') {
                setStep('custom');
                return;
              }
              if (preset === 'smart' && smart.status === 'error') {
                runSmart();
                return;
              }
              setSelected(preset);
            }}
            testID={`reminder.preset.${preset}`}
          />
        );
      })}
      {snoozeMode ? (
        <ListRow
          title={t('snoozeNotify')}
          trailing={{ kind: 'switch', value: notify }}
          onPress={() => {
            setNotify(!notify);
          }}
          testID="reminder.notify"
        />
      ) : (
        <ListRow
          title={t('destination.row', { destination: destinationLabel })}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            setStep('destination');
          }}
          testID="reminder.destination"
        />
      )}
      {permission === 'denied' && !external ? (
        <InlineErrorCard
          icon="notifications_off"
          tone="warning"
          title={t('permissionDenied')}
          primaryAction={{
            label: common('actions.openSettings'),
            onPress: openNotificationSettings,
          }}
          testID="reminder.permissionDenied"
        />
      ) : null}
    </View>
  );

  const customPast = draftCustom.getTime() <= now().getTime() + MINUTE;
  const customTooFar = draftCustom.getTime() > now().getTime() + YEAR_MS;
  const custom = (
    <View style={styles.body} testID="reminder.custom">
      <DateTimeFields
        value={draftCustom}
        onChange={setDraftCustom}
        days={60}
        testID="reminder.picker"
      />
      {customPast || customTooFar ? (
        <Text variant="bodyXs" tone="critical" accessibilityRole="alert">
          {customPast ? t('custom.past') : t('custom.tooFar')}
        </Text>
      ) : null}
      <Button
        label={t('custom.choose')}
        disabled={customPast || customTooFar}
        onPress={() => {
          const lead = draftCustom.getTime() - now().getTime();
          track('reminder_custom_pick', {
            lead_bucket:
              lead < 3_600_000
                ? '<1h'
                : lead < 86_400_000
                  ? '<1d'
                  : lead < 7 * 86_400_000
                    ? '<1w'
                    : '>1w',
          });
          setCustomAt(draftCustom);
          setSelected('custom');
          setStep('main');
        }}
        testID="reminder.custom.choose"
      />
    </View>
  );

  const accounts = (bootstrap?.accounts ?? []).filter(
    (a) => a.provider === 'google' || a.provider === 'microsoft',
  );
  const pickApple = async () => {
    if (!online) return;
    const current = await Calendar.getRemindersPermissionsAsync();
    const granted = current.granted || (await Calendar.requestRemindersPermissionsAsync()).granted;
    if (!granted) {
      setAppleDenied(true);
      return;
    }
    const lists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    const list = lists.find((l) => l.allowsModifications) ?? lists[0];
    if (list === undefined) {
      setAppleDenied(true);
      return;
    }
    track('reminder_destination_select', { destination: 'apple_reminders' });
    setDestination({ kind: 'apple_reminders', listId: list.id, listTitle: list.title });
    setStep('main');
  };
  const destinations = (
    <View style={styles.body} accessibilityRole="radiogroup" testID="reminder.destinations">
      <OptionRow
        label={t('destination.inApp')}
        meta={t('destination.inAppMeta')}
        role="radio"
        selected={destination.kind === 'in_app'}
        onPress={() => {
          track('reminder_destination_select', { destination: 'in_app' });
          setDestination({ kind: 'in_app' });
          setStep('main');
        }}
        testID="reminder.dest.in_app"
      />
      {Platform.OS === 'ios' ? (
        <OptionRow
          label={t('destination.apple')}
          meta={appleDenied ? t('destination.appleDenied') : t('destination.appleMeta')}
          role="radio"
          selected={destination.kind === 'apple_reminders'}
          {...(online ? {} : { disabled: true, disabledReason: t('meta.offline') })}
          onPress={() => {
            void pickApple();
          }}
          testID="reminder.dest.apple"
        />
      ) : null}
      {accounts.map((account) => {
        const kind = account.provider === 'google' ? 'google_tasks' : 'microsoft_todo';
        const email = account.account_email ?? account.display_name ?? '';
        return (
          <OptionRow
            key={account.id}
            label={
              kind === 'google_tasks'
                ? t('destination.googleWith', { email })
                : t('destination.microsoftWith', { email })
            }
            meta={
              kind === 'google_tasks' ? t('destination.googleMeta') : t('destination.microsoftMeta')
            }
            role="radio"
            selected={
              destination.kind === kind &&
              'accountId' in destination &&
              destination.accountId === account.id
            }
            {...(online ? {} : { disabled: true, disabledReason: t('meta.offline') })}
            onPress={() => {
              void providerListId(
                account.id,
                account.provider === 'google' ? 'google' : 'microsoft',
              ).then((listId) => {
                if (listId === null) return;
                track('reminder_destination_select', { destination: kind });
                setDestination({ kind, accountId: account.id, email, listId });
                setStep('main');
              });
            }}
            testID={`reminder.dest.${account.id}`}
          />
        );
      })}
      {accounts.length === 0 && isScreenAvailable('/settings/accounts') ? (
        <ListRow
          title={t('destination.connect')}
          subtitle={t('destination.notConnected')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            close();
            router.push('/settings/accounts');
          }}
          testID="reminder.dest.connect"
        />
      ) : null}
    </View>
  );

  const footer =
    step === 'main' ? (
      <View style={styles.footer}>
        {external && !online ? (
          <Text variant="meta" tone="warning">
            {t('meta.offline')}
          </Text>
        ) : null}
        <Button
          label={cta}
          onPress={() => {
            void submit();
          }}
          disabled={fireAt === null || (external && !online)}
          loading={submitting}
          fullWidth
          accessibilityLabel={cta}
          testID="reminder.submit"
        />
      </View>
    ) : (
      <Button
        label={common('actions.back')}
        variant="neutralTonal"
        onPress={() => {
          setStep('main');
        }}
        fullWidth
        testID="reminder.back"
      />
    );

  return (
    <View style={styles.root} testID="screen.reminder">
      <BottomSheet
        visible={visible}
        presentation="inline"
        onDismiss={close}
        onHidden={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/today');
        }}
        title={
          step === 'custom'
            ? t('custom.title')
            : step === 'destination'
              ? t('destination.label')
              : snoozeMode
                ? t('snoozeTitle')
                : t('title')
        }
        {...(title === '' || step !== 'main' ? {} : { subtitle: title })}
        footer={footer}
        testID="sheet.reminder"
      >
        <View style={{ gap: theme.space[2] }}>
          {step === 'main' ? main : step === 'custom' ? custom : destinations}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { gap: 4 },
  footer: { gap: 8 },
});
