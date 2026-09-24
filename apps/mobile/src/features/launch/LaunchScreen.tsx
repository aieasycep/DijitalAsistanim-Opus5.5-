/**
 * Launch view: the brand tile exactly where the native splash draws it (centred, 96 pt), with the
 * app name and the PRIMARY brand line beneath. Colours, type and spacing come from the tokens, so
 * the handover from the native splash is seamless in light and dark.
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
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
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

export function LaunchScreen() {
  const t = useTranslations('common.app');
  const palette = color[useSchemeName()];

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]} testID="launch-screen">
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
});
