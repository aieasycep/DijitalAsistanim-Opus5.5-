/**
 * KNOWN_PLATFORM_LIMITATIONS KPL-36/KPL-40: calendars are stored for a rolling window per provider
 * (`calendarSyncWindow` in @da/domain). When the viewed day — or, in the week view, the last day of
 * the week — lies wholly past the window of a connected calendar, Plan says so: "Bu tarih
 * eşitleme aralığının dışında; etkinlikler yaklaştıkça görünür." Past days are not flagged; their
 * events stay stored.
 */
import { beyondSyncWindow } from '@da/domain/calendar/sync-window';
import { PartialDataNotice } from '@da/ui';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { useFormats } from '../../lib/data/session';
import { calendarAccounts, useAccounts } from '../integrations/accounts';
import { dayRange } from './data';

export function OutsideWindowNote({
  lastDay,
  testID = 'plan.outsideWindow',
}: {
  /** The last local date (`YYYY-MM-DD`) on screen. */
  readonly lastDay: string;
  readonly testID?: string;
}) {
  const t = useTranslations('plan');
  const formats = useFormats();
  const accounts = useAccounts();
  const providers = calendarAccounts(accounts.data)
    .filter((account) => account.status !== 'disconnected')
    .map((account) => account.provider);
  const dayStart = new Date(dayRange(lastDay, formats.timeZone).from);
  if (!beyondSyncWindow(providers, dayStart, now())) return null;
  return (
    <PartialDataNotice
      title={t('outsideWindow.title')}
      regionLabel={t('outsideWindow.region')}
      testID={testID}
    />
  );
}
