/**
 * M-SET-60 "Görünüm" (`/settings/appearance`): Sistem / Açık / Koyu applied instantly from the
 * encrypted MMKV preference store (synchronous first paint) and mirrored to
 * `user_preferences.theme`; "Hareketi azalt" and "Haptik geri bildirim" the same way. A failed
 * server write keeps the local value and is retried (last write wins). The app follows the OS
 * text size (Dynamic Type); the in-app multiplier (M-SET-61) needs a kit typography multiplier
 * and is shown as the truthful static state.
 */
import { ListRow, ThemePreviewTile, type ThemePreference } from '@da/ui';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { updateUiPrefs, useUiPrefs } from '../../lib/ui-prefs';
import { saveUserPreferences } from './save';
import { Caption, SettingsGroup, SettingsPage } from './ui';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function setTheme(theme: ThemePreference): void {
  track('theme_changed', { mode: theme });
  updateUiPrefs({ theme });
  void saveUserPreferences({ theme }, { silent: true, onFailure: 'keep' });
}

export function AppearanceScreen() {
  const t = useTranslations();
  const prefs = useUiPrefs();
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
          trailing={{ kind: 'value', text: t('settings.appearance.textSizeSystem') }}
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
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10, marginTop: 8 },
  tile: { flex: 1, gap: 6, alignItems: 'center' },
});
