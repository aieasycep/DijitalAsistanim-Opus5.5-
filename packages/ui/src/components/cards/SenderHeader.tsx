/**
 * `SenderHeader` (Email Detail, SCREEN_AND_FLOW_MAP Part 2 §0.3): avatar 44 + name 15/600 (+ VIP
 * star) + masked address and time meta + optional header badge (4×9). Read as one element.
 */
import type { JSX } from 'react';
import { View } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { Badge, type BadgeCategory } from '../badges/Badge.tsx';

export interface SenderHeaderProps {
  readonly name: string;
  readonly id?: string;
  /** "mehmet.yilmaz@… · 08:42" */
  readonly meta?: string;
  readonly vip?: boolean;
  /** "VIP" spoken label. */
  readonly vipLabel?: string;
  readonly badge?: { readonly label: string; readonly category?: BadgeCategory };
  readonly testID?: string;
}

export function SenderHeader({
  name,
  id,
  meta,
  vip = false,
  vipLabel,
  badge,
  testID,
}: SenderHeaderProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.senderHeader'}
      accessible
      accessibilityLabel={[name, vip ? vipLabel : undefined, meta, badge?.label]
        .filter(Boolean)
        .join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Avatar name={name} id={id} size={44} decorative />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="rowTitle" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {vip ? <Icon name="star" filled size={15} color={theme.color.brand.primary} /> : null}
        </View>
        {meta === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong" numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {badge === undefined ? null : (
        <Badge label={badge.label} category={badge.category} size="header" />
      )}
    </View>
  );
}
