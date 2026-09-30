/**
 * M-SET-24 "Saat seçici" (shared by quiet hours and briefing times): a 24-hour local time on the
 * 5-minute grid. Hours and minutes are adjustable controls (swipe up/down with a screen reader) with
 * −/+ buttons; "Tamam" returns `HH:mm` to the parent, which saves. The same stepper approach as the
 * onboarding time picker keeps the picker identical on both platforms.
 */
import { BottomSheet, Button, IconButton, Text } from '@da/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

const DAY = 24 * 60;

export function toMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  const minutes = Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
  return Number.isFinite(minutes) ? ((minutes % DAY) + DAY) % DAY : 0;
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Rounds to the 5-minute grid. */
export function snap(minutes: number): number {
  return (Math.round(minutes / 5) * 5) % DAY;
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
  const t = useTranslations();
  return (
    <View style={styles.stepper}>
      <IconButton
        icon="expand_less"
        accessibilityLabel={t('settings.time.increase', { unit: label })}
        onPress={() => {
          onStep(1);
        }}
        testID={`${testID}.up`}
      />
      <View
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
        <Text variant="numericXl" numeric>
          {value}
        </Text>
      </View>
      <IconButton
        icon="expand_more"
        accessibilityLabel={t('settings.time.decrease', { unit: label })}
        onPress={() => {
          onStep(-1);
        }}
        testID={`${testID}.down`}
      />
    </View>
  );
}

export interface TimeSheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly value: string;
  readonly onDone: (value: string) => void;
  readonly onDismiss: () => void;
  readonly testID?: string;
}

/** Mount with a `key` per opening so the draft starts from the current value. */
export function TimeSheet({ visible, title, value, onDone, onDismiss, testID }: TimeSheetProps) {
  const t = useTranslations();
  const [minutes, setMinutes] = useState(() => snap(toMinutes(value)));
  const text = fromMinutes(minutes);
  const [hh = '00', mm = '00'] = text.split(':');
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      testID={testID ?? 'sheet.time'}
      footer={
        <View style={styles.buttons}>
          <Button
            label={t('common.actions.ok')}
            variant="ink"
            fullWidth
            onPress={() => {
              onDone(text);
            }}
            testID="time.done"
          />
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
          />
        </View>
      }
    >
      <View style={styles.row}>
        <Stepper
          label={t('settings.time.hour')}
          value={hh}
          onStep={(delta) => {
            setMinutes((m) => (m + delta * 60 + DAY) % DAY);
          }}
          testID="time.hour"
        />
        <Text variant="numericXl">:</Text>
        <Stepper
          label={t('settings.time.minute')}
          value={mm}
          onStep={(delta) => {
            setMinutes((m) => (m + delta * 5 + DAY) % DAY);
          }}
          testID="time.minute"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16 },
  stepper: { alignItems: 'center', gap: 4 },
  buttons: { gap: 8 },
});
