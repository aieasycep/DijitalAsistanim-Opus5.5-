/**
 * M-GL-03: exactly four fixed tabs — Bugün, Akış, Plan, Asistan — each with its own stack
 * (`(tabs)/<tab>/_layout.tsx`), drawn by the custom kit tab bar. Android back on a non-Today tab
 * root returns to Today (`backBehavior="firstRoute"`); the tab bar hides with the keyboard on
 * Asistan.
 */
import { Tabs } from 'expo-router/js-tabs';

import { ShellTabBar } from '../../src/features/shell/ShellTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      backBehavior="firstRoute"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <ShellTabBar {...props} />}
    >
      <Tabs.Screen name="today" />
      <Tabs.Screen name="flow" />
      <Tabs.Screen name="plan" />
      <Tabs.Screen name="assistant" options={{ tabBarHideOnKeyboard: true }} />
    </Tabs>
  );
}
