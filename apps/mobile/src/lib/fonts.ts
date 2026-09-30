/**
 * App fonts (DESIGN_AUDIT §8.6): Geist 400/500/600/700 for UI and Lora 400/500/600/400 italic
 * for editorial text. The `expo-font` config plugin embeds the same files natively; loading them
 * here registers them under the per-weight family names the tokens use
 * (`@da/design-tokens` `fontFamily`), which iOS would otherwise only know by PostScript name.
 */
import { fontFamily } from '@da/design-tokens';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { Lora_400Regular } from '@expo-google-fonts/lora/400Regular';
import { Lora_400Regular_Italic } from '@expo-google-fonts/lora/400Regular_Italic';
import { Lora_500Medium } from '@expo-google-fonts/lora/500Medium';
import { Lora_600SemiBold } from '@expo-google-fonts/lora/600SemiBold';

export const APP_FONTS: Readonly<Record<string, number>> = {
  [fontFamily.sans[400]]: Geist_400Regular,
  [fontFamily.sans[500]]: Geist_500Medium,
  [fontFamily.sans[600]]: Geist_600SemiBold,
  [fontFamily.sans[700]]: Geist_700Bold,
  [fontFamily.serif[400]]: Lora_400Regular,
  [fontFamily.serif[500]]: Lora_500Medium,
  [fontFamily.serif[600]]: Lora_600SemiBold,
  [fontFamily.serif['400italic']]: Lora_400Regular_Italic,
};
