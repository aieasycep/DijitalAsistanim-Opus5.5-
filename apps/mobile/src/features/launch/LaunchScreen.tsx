/**
 * Launch view: the brand tile exactly where the native splash draws it (centred, 96 pt), with the
 * app name and the PRIMARY brand line beneath. Colours, type and spacing come from the tokens, so
 * the handover from the native splash is seamless in light and dark. When the entry route takes
 * longer than 3 s (a slow bootstrap), a 16 px spinner appears so the app never looks frozen
 * (M-GL-02); there is no timed navigation.
 */
import {
  color,
  layout,
  letterSpacing,
  nativeFontFamily,
  space,
  typography,
  type TextStyleToken,
} from '@da/design-tokens';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

import brandTile from '../../../assets/splash.png';
import { useSchemeName } from '../../lib/useSchemeName';

/** Matches `imageWidth` of the expo-splash-screen plugin in `app.config.ts`. */
export const BRAND_TILE_SIZE = 96;

const platform = Platform.OS === 'android' ? 'android' : 'ios';

function textStyle(token: TextStyleToken) {
  return {
    fontFamily: nativeFontFamily(token, platform),
    fontSize: token.size,
    lineHeight: token.lineHeight,
    letterSpacing: letterSpacing(token),
  };
}

export interface LaunchScreenProps {
  /** Shows the loading spinner (the entry route is still resolving after 3 s). */
  readonly busy?: boolean;
}

export function LaunchScreen({ busy = false }: LaunchScreenProps) {
  const t = useTranslations('common.app');
  const palette = color[useSchemeName()];

  return (
    <View
      style={[styles.root, { backgroundColor: palette.bg }]}
      testID="launch-screen"
      accessibilityLabel={busy ? t('loadingA11y') : undefined}
    >
      <Image
        source={brandTile}
        style={styles.tile}
        accessible={false}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.copy}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={typography.h1.maxScale}
          style={[styles.name, { color: palette.text.primary }]}
        >
          {t('name')}
        </Text>
        <Text
          maxFontSizeMultiplier={typography.body.maxScale}
          style={[styles.tagline, { color: palette.text.secondary }]}
        >
          {t('tagline')}
        </Text>
        {busy ? (
          <ActivityIndicator
            testID="launch-spinner"
            size={16}
            color={palette.brand.primary}
            accessibilityRole="progressbar"
            accessibilityLabel={t('loadingA11y')}
            style={styles.spinner}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    width: BRAND_TILE_SIZE,
    height: BRAND_TILE_SIZE,
  },
  copy: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: BRAND_TILE_SIZE / 2 + space[6],
    paddingHorizontal: layout.onboardingX,
    alignItems: 'center',
    gap: space[2],
  },
  name: {
    ...textStyle(typography.h1),
    textAlign: 'center',
  },
  tagline: {
    ...textStyle(typography.body),
    textAlign: 'center',
  },
  spinner: {
    marginTop: space[4],
  },
});
