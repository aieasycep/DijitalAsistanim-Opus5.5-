/**
 * `(auth)` group (M-ON-05): sign-in and e-mail code, reachable only while signed out (root guard).
 * Plain stack without headers; each screen draws its own back circle.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';
import { useStackMotion } from '../../src/lib/motion';

export default function AuthLayout() {
  const theme = useTheme();
  const stackMotion = useStackMotion();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.bg },
        ...stackMotion,
      }}
    />
  );
}
