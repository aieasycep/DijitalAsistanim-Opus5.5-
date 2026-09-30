/**
 * Universal Capture modal stack (T-8.17): the composer (`/capture`) and the analysis, results and
 * success screen of one capture (`/capture/{id}`), pushed inside the modal.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';
import { useStackMotion } from '../../src/lib/motion';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/features/shell/ShellErrorBoundary';

export default function CaptureStackLayout() {
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
