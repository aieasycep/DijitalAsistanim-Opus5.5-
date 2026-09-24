/**
 * `(auth)` group (M-ON-05): sign-in and e-mail code, reachable only while signed out (root guard).
 * Plain stack without headers; each screen draws its own back circle.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg } }}
    />
  );
}
