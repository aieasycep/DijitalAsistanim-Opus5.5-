/**
 * M-SET-60 "Görünüm" (`/settings/appearance`): Sistem / Açık / Koyu applied instantly from the
 * encrypted MMKV preference store (synchronous first paint) and mirrored to
 * `user_preferences.theme`; "Hareketi azalt" and "Haptik geri bildirim" the same way. A failed
 * server write keeps the local value and is retried (last write wins). "Metin boyutu" opens
 * M-SET-61: a device-local multiplier on top of the OS Dynamic Type (Sistem ile aynı 1.0 · Daha
 * küçük 0.9 · Daha büyük 1.15 · En büyük 1.3), applied at once with a live sample; the kit keeps
 * every text within its token cap (total ≤ 2×).
 */
import {
  BottomSheet,
  Button,
  ListRow,
  OptionRow,
  Text,
  ThemePreviewTile,
  type ThemePreference,
} from '@da/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { TEXT_SCALES, updateUiPrefs, useUiPrefs, type TextScale } from '../../lib/ui-prefs';
import { saveUserPreferences } from './save';
import { Caption, SettingsGroup, SettingsPage } from './ui';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function setTheme(theme: ThemePreference): void {
  track('theme_changed', { mode: theme });
  updateUiPrefs({ theme });
  void saveUserPreferences({ theme }, { silent: true, onFailure: 'keep' });
}

const SCALE_EVENT: Readonly<Record<TextScale, 'default' | 'small' | 'large' | 'xlarge'>> = {
  system: 'default',
  sm: 'small',
  lg: 'large',
  xl: 'xlarge',
};

export function setTextScale(scale: TextScale): void {
  track('text_scale_changed', { scale: SCALE_EVENT[scale] });
  updateUiPrefs({ textScale: scale });
}

/** M-SET-61 "Metin boyutu": radio group + the live sample (read aloud). */
function TextSizeSheet({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const prefs = useUiPrefs();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('settings.appearance.textSize')}
      footer={
        <Button
          label={t('common.actions.done')}
          variant="ink"
          onPress={onDismiss}
          fullWidth
          testID="textSize.done"
        />
      }
      testID="sheet.textSize"
    >
      <View style={styles.sheet} accessibilityRole="radiogroup">
        {TEXT_SCALES.map((scale) => (
          <OptionRow
            key={scale}
            label={t(`settings.appearance.textSizes.${scale}`)}
            role="radio"
            selected={prefs.textScale === scale}
            onPress={() => {
              if (prefs.textScale !== scale) setTextScale(scale);
            }}
            testID={`textSize.${scale}`}
          />
        ))}
        <View style={styles.sample} accessible accessibilityLiveRegion="polite">
          <Text variant="body" testID="textSize.sample">
            {t('settings.appearance.textSizeSample')}
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}

export function AppearanceScreen() {
  const t = useTranslations();
  const prefs = useUiPrefs();
  const [textSizeOpen, setTextSizeOpen] = useState(false);
  return (
    <SettingsPage title={t('settings.appearance.title')} testID="screen.settings.appearance">
      <View style={styles.tiles} accessibilityRole="radiogroup">
        {THEMES.map((theme) => (
          <View key={theme} style={styles.tile}>
            <ThemePreviewTile
              label={t(`settings.appearance.${theme}`)}
              mode={theme}
              selected={prefs.theme === theme}
              onPress={() => {
                if (prefs.theme !== theme) setTheme(theme);
              }}
              testID={`appearance.theme.${theme}`}
            />
            <Caption>{t(`settings.appearanceScreen.${theme}Meta`)}</Caption>
          </View>
        ))}
      </View>
      <SettingsGroup>
        <ListRow
          icon="format_size"
          title={t('settings.appearance.textSize')}
          trailing={{
            kind: 'value',
            text: t(`settings.appearance.textSizes.${prefs.textScale}`),
          }}
          onPress={() => {
            setTextSizeOpen(true);
          }}
          testID="appearance.textSize"
        />
        <ListRow
          icon="animation"
          title={t('settings.appearanceScreen.reduceMotion')}
          trailing={{ kind: 'switch', value: prefs.reduceMotion }}
          onPress={() => {
            const next = !prefs.reduceMotion;
            track('reduce_motion_changed', { enabled: next });
            updateUiPrefs({ reduceMotion: next });
            void saveUserPreferences({ reduce_motion: next }, { silent: true, onFailure: 'keep' });
          }}
          testID="appearance.reduceMotion"
        />
        <ListRow
          icon="vibration"
          title={t('settings.appearanceScreen.haptics')}
          trailing={{ kind: 'switch', value: prefs.hapticsEnabled }}
          onPress={() => {
            const next = !prefs.hapticsEnabled;
            track('haptics_changed', { enabled: next });
            updateUiPrefs({ hapticsEnabled: next });
            void saveUserPreferences(
              { haptics_enabled: next },
              { silent: true, onFailure: 'keep' },
            );
          }}
          testID="appearance.haptics"
        />
      </SettingsGroup>
      <Caption>{t('settings.appearanceScreen.reduceMotionCaption')}</Caption>
      <TextSizeSheet
        visible={textSizeOpen}
        onDismiss={() => {
          setTextSizeOpen(false);
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10, marginTop: 8 },
  tile: { flex: 1, gap: 6, alignItems: 'center' },
  sheet: { gap: 4 },
  sample: { paddingTop: 12 },
});
