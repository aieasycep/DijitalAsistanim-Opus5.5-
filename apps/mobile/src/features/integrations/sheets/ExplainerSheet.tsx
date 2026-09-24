/**
 * Permission explainers before every OAuth or OS prompt (M-ON-06G Gmail, M-ON-06O Outlook,
 * M-ON-07E calendar with provider chips, M-SET-11 "explain" step; sheet(host)
 * `integration_explainer`). The CTA starts the flow; the sheet stays open with a spinner until the
 * auth session returns, then closes. Chips are platform-filtered (C-35): Apple on iOS, "Cihaz
 * takvimi" on Android.
 */
import type { Provider } from '@da/domain/enums';
import { BottomSheet, PermissionExplainer, type IconName } from '@da/ui';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../../lib/events';
import { useOnline } from '../../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';
import type { AccountRow } from '../accounts';
import { connectCloud, connectDeviceCalendar } from '../flow';
import type { ReturnTo } from '../pending';

export const INTEGRATION_EXPLAINER_SHEET = 'integration_explainer';

export type CalendarChip = 'google' | 'microsoft' | 'apple' | 'device';

export type ExplainerParams =
  | {
      readonly kind: 'mail';
      readonly provider: 'google' | 'microsoft' | 'demo';
      readonly returnTo: ReturnTo;
      readonly accounts: readonly AccountRow[];
      readonly reconnect?: AccountRow;
    }
  | {
      readonly kind: 'calendar';
      readonly chip: CalendarChip;
      readonly returnTo: ReturnTo;
      readonly accounts: readonly AccountRow[];
      readonly reconnect?: AccountRow;
    }
  | {
      readonly kind: 'tasks';
      readonly provider: 'google' | 'microsoft';
      readonly returnTo: ReturnTo;
      readonly accounts: readonly AccountRow[];
      readonly reconnect?: AccountRow;
    };

export function calendarChips(): readonly CalendarChip[] {
  return Platform.OS === 'ios'
    ? ['google', 'microsoft', 'apple']
    : ['google', 'microsoft', 'device'];
}

function chipProvider(chip: CalendarChip): Provider {
  switch (chip) {
    case 'google':
      return 'google';
    case 'microsoft':
      return 'microsoft';
    case 'apple':
      return 'apple_device';
    case 'device':
      return 'android_device';
  }
}

function ExplainerSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<ExplainerParams>) {
  const t = useTranslations('onboarding.explainer');
  const common = useTranslations('common');
  const online = useOnline();
  const [chip, setChip] = useState<CalendarChip>(
    params.kind === 'calendar' ? params.chip : 'google',
  );
  const [busy, setBusy] = useState(false);
  const provider: Provider = params.kind === 'calendar' ? chipProvider(chip) : params.provider;
  const capability =
    params.kind === 'mail' ? 'mail_read' : params.kind === 'tasks' ? 'tasks_read' : 'calendar_read';

  useEffect(() => {
    track('integration_explainer_viewed', { provider, capability });
    // Viewed once per opening; chip changes are tracked separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (busy) return;
    track('integration_explainer_dismissed', { provider });
    onDismiss();
  };

  const run = async () => {
    setBusy(true);
    try {
      if (provider === 'apple_device' || provider === 'android_device') {
        onDismiss();
        await connectDeviceCalendar();
        return;
      }
      await connectCloud({
        provider: provider === 'microsoft' ? 'microsoft' : provider === 'demo' ? 'demo' : 'google',
        capability,
        returnTo: params.returnTo,
        accounts: params.accounts,
        ...(params.reconnect === undefined ? {} : { reconnect: params.reconnect }),
      });
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  const device = provider === 'apple_device' || provider === 'android_device';
  const assurance = [
    {
      key: 'send',
      icon: 'verified_user' as IconName,
      text: params.kind === 'calendar' ? t('trustCalendar') : t('trustSend'),
    },
    ...(params.kind === 'mail' && params.provider === 'microsoft'
      ? [{ key: 'org', icon: 'work' as IconName, text: t('outlook.orgPolicy') }]
      : []),
    { key: 'remove', icon: 'link_off' as IconName, text: t('trustRemove') },
    {
      key: 'ads',
      icon: 'block' as IconName,
      text: params.kind === 'calendar' ? t('calendar.ads') : t('trustAds'),
    },
  ];

  let title: string;
  let kicker: string;
  let icon: IconName;
  let reasons: { key: string; icon: IconName; text: string }[];
  let cta: string;
  let footnote: string;
  if (params.kind === 'mail') {
    const ms = params.provider === 'microsoft';
    kicker = ms ? t('outlook.kicker') : t('gmail.kicker');
    title = ms ? t('outlook.title') : t('gmail.title');
    icon = 'mail';
    const base = ms ? 'outlook' : 'gmail';
    reasons = [
      { key: 'important', icon: 'priority_high', text: t(`${base}.reasons.important`) },
      { key: 'awaiting', icon: 'forum', text: t(`${base}.reasons.awaiting`) },
      { key: 'deadlines', icon: 'event', text: t(`${base}.reasons.deadlines`) },
    ];
    cta = ms ? t('outlook.cta') : t('gmail.cta');
    footnote = ms ? t('outlook.note') : t('gmail.note');
  } else if (params.kind === 'tasks') {
    kicker = t('tasks.kicker');
    title = t('tasks.title');
    icon = 'task_alt';
    reasons = [
      { key: 'today', icon: 'today', text: t('tasks.reasons.today') },
      { key: 'briefing', icon: 'wb_twilight', text: t('tasks.reasons.briefing') },
    ];
    cta = params.provider === 'microsoft' ? t('tasks.ctaMicrosoft') : t('tasks.ctaGoogle');
    footnote = params.provider === 'microsoft' ? t('outlook.note') : t('gmail.note');
  } else {
    kicker = t('calendar.kicker');
    title = t('calendar.title');
    icon = 'calendar_today';
    reasons = [
      { key: 'schedule', icon: 'today', text: t('calendar.reasons.schedule') },
      { key: 'conflicts', icon: 'event_busy', text: t('calendar.reasons.conflicts') },
      { key: 'briefing', icon: 'wb_twilight', text: t('calendar.reasons.briefing') },
      { key: 'slots', icon: 'schedule', text: t('calendar.reasons.slots') },
    ];
    cta = t(`calendar.cta.${chip}`);
    footnote = t(`calendar.note.${chip}`);
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={dismiss}
      onHidden={onHidden}
      dismissible={!busy}
      accessibilityLabel={title}
      testID="sheet.integrationExplainer"
    >
      <PermissionExplainer
        icon={icon}
        kicker={kicker}
        title={title}
        {...(params.kind === 'calendar'
          ? {
              providers: calendarChips().map((key) => ({
                key,
                label: common(
                  `providers.${key === 'google' ? 'googleCalendar' : key === 'microsoft' ? 'outlookCalendar' : key === 'apple' ? 'appleCalendar' : 'deviceCalendar'}`,
                ),
              })),
              selectedProvider: chip,
              onSelectProvider: (key: string) => {
                const next = calendarChips().find((c) => c === key);
                if (next === undefined || busy) return;
                setChip(next);
                track('integration_explainer_chip_changed', { chip: next });
              },
            }
          : {})}
        reasons={reasons}
        assurance={assurance}
        primaryAction={{
          label: cta,
          onPress: () => {
            void run();
          },
          loading: busy,
          loadingLabel: common('a11y.loading'),
        }}
        secondaryAction={{ label: t('notNow'), onPress: dismiss }}
        footnote={!online && !device ? t('offlineHint') : footnote}
        testID="explainer"
      />
    </BottomSheet>
  );
}

registerSheet<ExplainerParams>(INTEGRATION_EXPLAINER_SHEET, (props) => (
  <ExplainerSheet {...props} />
));
