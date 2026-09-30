/**
 * `IconTile` (DESIGN_AUDIT §2.4, §2.9): a rounded square with a tone background and glyph —
 * 28/r9, 30/r10, 36/r11, 44/r14, 48/r16, 52/r16. Tiles are neutral by default; colour only where
 * it carries meaning (security critical, deadline warning, event info, AI/approval primary).
 */
import type { Tone } from '@da/design-tokens';
import type { JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/generated/index.ts';
import { hiddenFromA11y } from '../theme/a11y.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';

export const ICON_TILE_SIZES = [28, 30, 36, 44, 48, 52] as const;
export type IconTileSize = (typeof ICON_TILE_SIZES)[number];

const RADIUS: Record<IconTileSize, number> = { 28: 9, 30: 10, 36: 11, 44: 14, 48: 16, 52: 16 };
const GLYPH: Record<IconTileSize, number> = { 28: 17, 30: 17, 36: 20, 44: 22, 48: 24, 52: 24 };

export interface IconTileProps {
  readonly icon: IconName;
  readonly size?: IconTileSize;
  readonly tone?: Tone;
  readonly filled?: boolean;
  /** Circle instead of a rounded square (empty-state 60 circles use `EmptyState`). */
  readonly round?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Decorative by itself (the adjacent text carries the meaning). */
export function IconTile({
  icon,
  size = 30,
  tone = 'neutral',
  filled = false,
  round = false,
  style,
  testID,
}: IconTileProps): JSX.Element {
  const theme = useTheme();
  const colors = theme.tone[tone];
  return (
    <View
      testID={testID}
      {...hiddenFromA11y}
      style={[
        {
          width: size,
          height: size,
          borderRadius: round ? size / 2 : RADIUS[size],
          backgroundColor: colors.soft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={icon} size={GLYPH[size]} color={colors.icon} filled={filled} />
    </View>
  );
}
