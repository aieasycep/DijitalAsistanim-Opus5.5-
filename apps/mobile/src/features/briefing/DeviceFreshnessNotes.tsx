/**
 * The KPL-12 notes of a briefing built with device-calendar data (`device-freshness.ts`), shown on
 * the briefing (M-BR-01 / M-BR-04) and under the Today hero for the same briefing:
 * - the change banner "Takvimin bu brifingden sonra değişti." with "Güncel programı gör" (Plan);
 * - the stale note "{kaynak} · son eşitleme {saat}. Sonraki değişiklikler uygulamayı açtığında
 *   eklenir." while the stale source has not synced since the briefing was generated.
 * Both are P3 inline notes; nothing renders when the briefing matches the current schedule.
 */
import { formatDatePattern, toLocalDateString } from '@da/i18n';
import { PartialDataNotice } from '@da/ui';
import { useRouter } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { cachedBootstrap } from '../../lib/postgrest';
import { useDeviceFreshness, type FreshnessInput } from './device-freshness';

export function DeviceFreshnessNotes({
  briefing,
  testID = 'briefing.deviceFreshness',
}: {
  readonly briefing: FreshnessInput | null | undefined;
  readonly testID?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const state = useDeviceFreshness(briefing).data;
  if (state === undefined || state.kind === 'none') return null;

  if (state.kind === 'changed') {
    const plan = isScreenAvailable('/plan');
    return (
      <PartialDataNotice
        title={t('briefing.deviceFreshness.changed')}
        {...(plan
          ? {
              action: {
                label: t('briefing.deviceFreshness.seeCurrent'),
                onPress: () => {
                  router.push('/plan');
                },
              },
            }
          : {})}
        regionLabel={t('briefing.deviceFreshness.region')}
        testID={`${testID}.changed`}
      />
    );
  }

  const lang = locale === 'en' ? 'en' : 'tr';
  const timeZone = cachedBootstrap()?.preferences.timezone;
  const zone = timeZone === undefined ? {} : { timeZone };
  const source =
    state.provider === 'apple_device'
      ? t('common.providers.appleCalendar')
      : t('common.providers.deviceCalendar');
  let title: string;
  if (state.lastSyncAt === null) {
    title = t('briefing.deviceFreshness.neverSynced', { source });
  } else {
    const sameDay =
      toLocalDateString(state.lastSyncAt, timeZone) === toLocalDateString(now(), timeZone);
    const time = formatDatePattern(state.lastSyncAt, sameDay ? 'time' : 'dayMonthTime', {
      locale: lang,
      ...zone,
    });
    title = t('briefing.deviceFreshness.stale', { source, time });
  }
  return (
    <PartialDataNotice
      title={title}
      regionLabel={t('briefing.deviceFreshness.region')}
      testID={`${testID}.stale`}
    />
  );
}
