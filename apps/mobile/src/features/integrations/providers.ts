/**
 * The connectable provider rows by group and platform (Part 4 §2, C-35): Gmail and Outlook for
 * mail; Google Takvim, Outlook Takvim and the device calendar (Apple Takvim on iOS, Cihaz takvimi on
 * Android) for calendars; Google Tasks and Microsoft To Do for tasks. Apple Hatırlatıcılar needs
 * the device reminders snapshot path, which is not part of this build (T-8.07 decision, see the
 * task report); its row is therefore not offered.
 */
import type { Capability, Provider } from '@da/domain/enums';
import { Platform } from 'react-native';

import type { AccountRow } from './accounts';
import type { CalendarChip } from './sheets/ExplainerSheet';
import type { ProviderRowKey } from './status';

export type ProviderGroup = 'mail' | 'calendar' | 'tasks';

export interface ProviderOption {
  readonly key: ProviderRowKey;
  readonly group: ProviderGroup;
  readonly provider: Provider;
  readonly capability: Extract<Capability, 'mail_read' | 'calendar_read' | 'tasks_read'>;
  readonly chip?: CalendarChip;
}

export function providerOptions(): readonly ProviderOption[] {
  const ios = Platform.OS === 'ios';
  return [
    { key: 'gmail', group: 'mail', provider: 'google', capability: 'mail_read' },
    { key: 'outlook', group: 'mail', provider: 'microsoft', capability: 'mail_read' },
    {
      key: 'googleCalendar',
      group: 'calendar',
      provider: 'google',
      capability: 'calendar_read',
      chip: 'google',
    },
    {
      key: 'outlookCalendar',
      group: 'calendar',
      provider: 'microsoft',
      capability: 'calendar_read',
      chip: 'microsoft',
    },
    ios
      ? {
          key: 'appleCalendar',
          group: 'calendar',
          provider: 'apple_device',
          capability: 'calendar_read',
          chip: 'apple',
        }
      : {
          key: 'deviceCalendar',
          group: 'calendar',
          provider: 'android_device',
          capability: 'calendar_read',
          chip: 'device',
        },
    { key: 'googleTasks', group: 'tasks', provider: 'google', capability: 'tasks_read' },
    { key: 'microsoftTodo', group: 'tasks', provider: 'microsoft', capability: 'tasks_read' },
  ];
}

/** Whether an account already provides this option (device calendars by provider). */
export function providesOption(account: AccountRow, option: ProviderOption): boolean {
  if (account.provider !== option.provider) return false;
  if (option.provider === 'apple_device' || option.provider === 'android_device') return true;
  return account.capabilities_granted.includes(option.capability);
}

export function groupOf(account: AccountRow): readonly ProviderGroup[] {
  if (account.provider === 'apple_device' || account.provider === 'android_device') {
    return ['calendar'];
  }
  const groups: ProviderGroup[] = [];
  if (account.capabilities_granted.includes('mail_read')) groups.push('mail');
  if (account.capabilities_granted.includes('calendar_read')) groups.push('calendar');
  if (account.capabilities_granted.includes('tasks_read')) groups.push('tasks');
  return groups.length === 0 ? ['mail'] : groups;
}
