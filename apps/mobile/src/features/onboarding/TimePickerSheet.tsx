/**
 * M-ON-10T time picker (sheet(host) `time_picker`): a 24-hour local time on the 5-minute grid with
 * hour and minute steppers (each an adjustable control for assistive tech), validated against the
 * field's range and the briefing order before "Kaydet" (schedule.ts).
 */
import { BottomSheet, Button, IconButton, InlineErrorCard, Text, useTheme } from '@da/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';
import {
  clampToRange,
  fromMinutes,
  toMinutes,
  validateTime,
  type ScheduleField,
  type ScheduleTimes,
} from './schedule';

export const TIME_PICKER_SHEET = 'time_picker';

export interface TimePickerParams {
  readonly field: ScheduleField;
  readonly times: ScheduleTimes;
  readonly onSave: (value: string) => void;
}

function Stepper({
  label,
  value,
  onStep,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly onStep: (delta: 1 | -1) => void;
  readonly testID: string;
}) {
  const actions = useTranslations('onboarding.schedule.picker');
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        onStep(event.nativeEvent.actionName === 'increment' ? 1 : -1);
      }}
      testID={testID}
    >
      <IconButton
        icon="expand_less"
        accessibilityLabel={actions('increase', { unit: label })}
        onPress={() => {
          onStep(1);
        }}
        testID={`${testID}.up`}
      />
      <Text variant="numericXl" numeric>
        {value}
      </Text>
      <IconButton
        icon="expand_more"
        accessibilityLabel={actions('decrease', { unit: label })}
        onPress={() => {
          onStep(-1);
        }}
        testID={`${testID}.down`}
      />
    </View>
  );
}

function TimePickerSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<TimePickerParams>) {
  const t = useTranslations('onboarding.schedule');
  const common = useTranslations('common.actions');
  const theme = useTheme();
  const [minutes, setMinutes] = useState(() => toMinutes(params.times[params.field]));
  const value = fromMinutes(minutes);
  const error = validateTime(params.field, value, params.times);

  const step = (delta: number) => {
    setMinutes((current) => clampToRange(params.field, current + delta));
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t(`pickerTitle.${params.field}`)}
      testID="sheet.timePicker"
      footer={
        <Button
          label={common('save')}
          fullWidth
          disabled={error !== null}
          onPress={() => {
            params.onSave(value);
            onDismiss();
          }}
          testID="timePicker.save"
        />
      }
    >
      <View style={[styles.row, { gap: theme.space[4] }]}>
        <Stepper
          label={t('picker.hour')}
          value={value.slice(0, 2)}
          onStep={(d) => {
            step(d * 60);
          }}
          testID="timePicker.hour"
        />
        <Text variant="numericXl">:</Text>
        <Stepper
          label={t('picker.minute')}
          value={value.slice(3, 5)}
          onStep={(d) => {
            step(d * 5);
          }}
          testID="timePicker.minute"
        />
      </View>
      {error === null ? null : (
        <InlineErrorCard
          icon="error"
          tone="warning"
          title={
            error.kind === 'range'
              ? t(`picker.range.${error.field}`)
              : t(`picker.order.${error.second === 'midday' ? 'midday' : 'evening'}`)
          }
          testID="timePicker.error"
        />
      )}
    </BottomSheet>
  );
}

registerSheet<TimePickerParams>(TIME_PICKER_SHEET, (props) => <TimePickerSheet {...props} />, {
  analyticsKey: 'time_picker',
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  stepper: { alignItems: 'center' },
});
