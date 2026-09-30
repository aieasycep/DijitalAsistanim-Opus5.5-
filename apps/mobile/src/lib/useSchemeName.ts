import type { ColorSchemeName } from '@da/design-tokens';
import { useColorScheme } from 'react-native';

/** The token scheme for the system appearance; anything but an explicit dark preference is light. */
export function useSchemeName(): ColorSchemeName {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
