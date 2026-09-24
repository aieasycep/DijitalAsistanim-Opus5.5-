/**
 * M-ON-07D calendar permission denied (sheet(host) `calendar_denied`): an honest denied state with
 * a real Settings handoff (`Linking.openSettings()`); the permission is re-checked when the app
 * becomes active, and a grant closes the sheet and opens the calendar picker.
 */
import { BottomSheet, Button, PermissionCard } from '@da/ui';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../../lib/events';
import { registerSheet, sheets, type SheetRenderProps } from '../../../providers/SheetHost';
import { devicePermission, openSystemSettings } from '../device-calendar';
import { CALENDAR_PICKER_SHEET } from './CalendarPickerSheet';

export const CALENDAR_DENIED_SHEET = 'calendar_denied';

export interface CalendarDeniedParams {
  readonly blocked: boolean;
}

function CalendarDeniedSheet({
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<CalendarDeniedParams>) {
  const t = useTranslations('onboarding.calendar.denied');
  const actions = useTranslations('common.actions');

  useEffect(() => {
    track('calendar_denied_shown');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void devicePermission().then((status) => {
        if (status !== 'granted') return;
        onDismiss();
        sheets.open(CALENDAR_PICKER_SHEET, { kind: 'device' });
      });
    });
    return () => {
      subscription.remove();
    };
  }, [onDismiss]);

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      accessibilityLabel={t('title')}
      testID="sheet.calendarDenied"
      footer={
        <View style={styles.footer}>
          <Button
            label={actions('openSettings')}
            fullWidth
            onPress={() => {
              track('calendar_denied_open_settings');
              openSystemSettings();
            }}
            testID="calendarDenied.settings"
          />
          <Button
            label={t('skip')}
            variant="text"
            fullWidth
            onPress={() => {
              track('calendar_denied_skip');
              onDismiss();
            }}
            testID="calendarDenied.skip"
          />
        </View>
      }
    >
      <PermissionCard icon="event_busy" title={t('title')} body={t('body')} />
    </BottomSheet>
  );
}

registerSheet<CalendarDeniedParams>(CALENDAR_DENIED_SHEET, (props) => (
  <CalendarDeniedSheet {...props} />
));

const styles = StyleSheet.create({ footer: { gap: 8 } });
