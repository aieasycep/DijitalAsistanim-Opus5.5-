/**
 * `TabBar` (DESIGN_AUDIT §3.4; custom, not native Liquid Glass — DEV-20). "Sekme sayısı 4'te
 * sabit": Bugün `sunny` · Akış `dynamic_feed` · Plan `calendar_today` · Asistan `auto_awesome`.
 * Height `62 + insets.bottom`, items padding 8/8, icon 26 + `tabLabel`, gap 3. Active = primary +
 * FILL 1; inactive = `ink/tertiary-strong` + FILL 0 (DEV-11). iOS: translucent bar over an
 * optional blur (`background`, e.g. an expo-blur `BlurView` from the app) with a top hairline;
 * Android and iOS Reduce Transparency: opaque. Re-tapping the active tab calls `onReselect`
 * (pop to root + scroll to top in the app).
 */
import type { JSX, ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useUiPreferences } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export interface TabBarItem {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** Pending count announced as the tab value (e.g. approvals). */
  readonly badgeText?: string;
  readonly accessibilityLabel?: string;
}

export interface TabBarProps {
  readonly items: readonly TabBarItem[];
  readonly activeKey: string;
  readonly onTabPress: (key: string) => void;
  /** The active tab was tapped again (pop to root, scroll to top). */
  readonly onReselect?: (key: string) => void;
  /** Optional blur layer drawn under the translucent bar on iOS. */
  readonly background?: ReactNode;
  /** The tab list label for screen readers. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function TabBar({
  items,
  activeKey,
  onTabPress,
  onReselect,
  background,
  accessibilityLabel,
  testID,
}: TabBarProps): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceTransparency } = useUiPreferences();
  const tab = theme.layout.tabBar;
  const glass = Platform.OS === 'ios' && !reduceTransparency;
  return (
    <View
      testID={testID ?? 'ui.tabBar'}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: tab.height + insets.bottom,
        paddingBottom: insets.bottom,
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: theme.isDark ? theme.color.onGradient.fill08 : theme.color.border.hairline,
        backgroundColor: glass ? theme.color.overlay.tabBar : theme.color.overlay.tabBarOpaque,
      }}
    >
      {glass && background !== undefined ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {background}
        </View>
      ) : null}
      {items.map((item) => {
        const active = item.key === activeKey;
        const color = active ? theme.color.tabBar.active : theme.color.tabBar.inactive;
        return (
          <PressableScale
            key={item.key}
            testID={`ui.tabBar.${item.key}`}
            feedback="none"
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: active }}
            accessibilityValue={item.badgeText === undefined ? undefined : { text: item.badgeText }}
            haptic={active ? undefined : 'select'}
            onPress={() => {
              if (active) onReselect?.(item.key);
              else onTabPress(item.key);
            }}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: tab.itemPad,
              gap: tab.gap,
            }}
          >
            <Icon name={item.icon} size={tab.icon} color={color} filled={active} />
            <Text variant="tabLabel" style={{ color }} numberOfLines={1}>
              {item.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
