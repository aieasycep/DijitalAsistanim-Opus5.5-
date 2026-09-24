import { size as sizeTokens } from '@da/design-tokens';
import type { JSX } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import { iconComponents, type IconName } from './generated/index.ts';

export interface IconProps {
  readonly name: IconName;
  /**
   * FILL 1 variant: the active tab, AI markers in kickers and logos, done/selected
   * `check_circle`, VIP `star`, play/pause, the selected radio (DESIGN_AUDIT §2.12.1).
   */
  readonly filled?: boolean;
  /** Glyph size in points; defaults to the 20 pt button/settings size. */
  readonly size?: number;
  /** A semantic colour from the theme (`@da/design-tokens`); there is no scheme-blind default. */
  readonly color: ColorValue;
  /**
   * When set, the icon is announced as an image with this label. Without it the icon is
   * decorative and hidden from assistive technology; icon-only controls put their label on
   * the pressable, not here.
   */
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** A Material Symbols Rounded icon rendered with react-native-svg. */
export function Icon({
  name,
  filled = false,
  size = sizeTokens.icon.default,
  color,
  accessibilityLabel,
  style,
  testID,
}: IconProps): JSX.Element {
  const Glyph = iconComponents[name];
  const labelled = accessibilityLabel !== undefined && accessibilityLabel !== '';
  const a11y = labelled
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : {
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };
  return (
    <Glyph size={size} color={color} filled={filled} style={style} testID={testID} {...a11y} />
  );
}
