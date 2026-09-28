/**
 * Live platform capability state for screens (KNOWN_PLATFORM_LIMITATIONS KPL-07, KPL-09), read
 * through `da-platform`: the Android exact-alarm special access and the iOS Time Sensitive
 * notification setting. Re-read on mount and on every return to the foreground, so the notes
 * disappear as soon as the user turned the access on in the system settings. `null` = unknown
 * (module missing or unreadable): screens show nothing for an unknown state.
 *
 * Scheduling itself needs no switch here: `expo-notifications` schedules with
 * `setExactAndAllowWhileIdle` when `canScheduleExactAlarms()` is true and with
 * `setAndAllowWhileIdle` otherwise, and the foreground reconciliation reschedules the pending
 * reminders, so they become exact once the access is granted (`NotificationBridge`).
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  exactAlarmState,
  timeSensitiveSetting,
  type ExactAlarmState,
  type TimeSensitiveSetting,
} from '../../modules/da-platform/src';

export interface PlatformState {
  readonly exactAlarm: ExactAlarmState | null;
  readonly timeSensitive: TimeSensitiveSetting | null;
}

export function usePlatformState(): PlatformState {
  const [state, setState] = useState<PlatformState>(() => ({
    exactAlarm: exactAlarmState(),
    timeSensitive: null,
  }));
  useEffect(() => {
    let alive = true;
    const read = () => {
      const exactAlarm = exactAlarmState();
      void timeSensitiveSetting().then((timeSensitive) => {
        if (alive) setState({ exactAlarm, timeSensitive });
      });
    };
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return state;
}
