/**
 * M-GL-03 tab bar: exactly four fixed tabs, in order Bugün `sunny` · Akış `dynamic_feed` · Plan
 * `calendar_today` · Asistan `auto_awesome`, drawn by the `@da/ui` `TabBar` (filled icon when
 * active). A press emits React Navigation's `tabPress` like the stock bar, so each tab keeps its
 * own stack; re-tapping the active tab emits it on the focused route, which pops that tab's stack
 * to its root and scrolls the root to the top (`useScrollToTop`). While a tab asks for
 * `tabBarHideOnKeyboard` (Asistan) the bar hides with the keyboard. Toasts sit 14 above the bar.
 */
import { TabBar, useTheme, type IconName, type TabBarItem } from '@da/ui';
import type { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { useTabBarToastOffset } from '../../providers/ToastHost';

export type ShellTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TAB_KEYS = ['today', 'flow', 'plan', 'assistant'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_ICONS: Readonly<Record<TabKey, IconName>> = {
  today: 'sunny',
  flow: 'dynamic_feed',
  plan: 'calendar_today',
  assistant: 'auto_awesome',
};

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setVisible(true);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setVisible(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function isTabKey(name: string): name is TabKey {
  return (TAB_KEYS as readonly string[]).includes(name);
}

export function ShellTabBar({ state, navigation, descriptors }: ShellTabBarProps) {
  const t = useTranslations('common.tabs');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const focused = state.routes[state.index];
  const hideForKeyboard =
    keyboardVisible &&
    focused !== undefined &&
    descriptors[focused.key]?.options.tabBarHideOnKeyboard === true;

  useTabBarToastOffset(theme.layout.tabBar.height + insets.bottom, !hideForKeyboard);

  if (hideForKeyboard || focused === undefined) return null;

  const routes = state.routes.filter((route) => isTabKey(route.name));
  const items: TabBarItem[] = routes.map((route, index) => {
    const key = route.name as TabKey;
    const label = t(key);
    return {
      key,
      label,
      icon: TAB_ICONS[key],
      accessibilityLabel: t('a11yLabel', { label, index: index + 1, count: routes.length }),
    };
  });

  const press = (key: string, reselect: boolean) => {
    const route = state.routes.find((r) => r.name === key);
    if (route === undefined || !isTabKey(key)) return;
    track('tab_selected', { tab: key, reselect });
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!reselect && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  return (
    <TabBar
      items={items}
      activeKey={focused.name}
      onTabPress={(key) => {
        press(key, false);
      }}
      onReselect={(key) => {
        press(key, true);
      }}
      testID="shell.tabBar"
    />
  );
}
