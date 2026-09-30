/**
 * Font loading contract (DESIGN_AUDIT §2.7, §8.6). The kit only references family names; the
 * mobile app loads the files before hiding the splash screen:
 *
 * ```ts
 * import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
 * import { Lora_400Regular, Lora_400Regular_Italic, Lora_500Medium, Lora_600SemiBold } from '@expo-google-fonts/lora';
 * const [loaded] = useFonts({ Geist_400Regular, …, Lora_600SemiBold });
 * ```
 *
 * The keys passed to `useFonts` must be exactly {@link REQUIRED_FONTS}; each maps to the export
 * of the same name in its package (verified by `test/fonts.test.ts`). Monospace uses the platform
 * font (Menlo / monospace) and needs no loading. Android ignores `fontWeight` on single-file
 * families, so every weight is its own family and styles never set `fontWeight`.
 */
import {
  fontFamily,
  letterSpacing,
  nativeFontFamily,
  typography,
  type TextStyleToken,
  type TypographyName,
} from '@da/design-tokens';
import { Platform, type TextStyle } from 'react-native';

/** Every family the type scale can resolve to, with the package that ships it. */
export const REQUIRED_FONTS = {
  [fontFamily.sans[400]]: '@expo-google-fonts/geist',
  [fontFamily.sans[500]]: '@expo-google-fonts/geist',
  [fontFamily.sans[600]]: '@expo-google-fonts/geist',
  [fontFamily.sans[700]]: '@expo-google-fonts/geist',
  [fontFamily.serif[400]]: '@expo-google-fonts/lora',
  [fontFamily.serif[500]]: '@expo-google-fonts/lora',
  [fontFamily.serif[600]]: '@expo-google-fonts/lora',
  [fontFamily.serif['400italic']]: '@expo-google-fonts/lora',
} as const satisfies Record<string, '@expo-google-fonts/geist' | '@expo-google-fonts/lora'>;

export type RequiredFontFamily = keyof typeof REQUIRED_FONTS;

/** The family names to load, in a stable order. */
export const REQUIRED_FONT_FAMILIES = Object.keys(REQUIRED_FONTS) as readonly RequiredFontFamily[];

function platformName(): 'ios' | 'android' {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

/**
 * The React Native text style of a type token: family per weight, size, line height, tracking in
 * points, italic, tabular numerals, and the Android padding fixes (`includeFontPadding: false`,
 * `textAlignVertical: 'center'`). Colour is applied separately from the theme.
 */
export function textStyleFor(token: TextStyleToken): TextStyle {
  const style: TextStyle = {
    fontFamily: nativeFontFamily(token, platformName()),
    fontSize: token.size,
    lineHeight: token.lineHeight,
    letterSpacing: letterSpacing(token),
  };
  if (token.italic) style.fontStyle = 'italic';
  if (token.numeric) style.fontVariant = ['tabular-nums'];
  if (Platform.OS === 'android') {
    style.includeFontPadding = false;
    style.textAlignVertical = 'center';
  }
  return style;
}

/** The text style of a named type token, with an optional weight override (same family). */
export function textStyle(name: TypographyName, weight?: TextStyleToken['weight']): TextStyle {
  const token = typography[name];
  return textStyleFor(weight === undefined ? token : { ...token, weight });
}
