/**
 * Asistan tab stack (M-GL-03): the tab keeps its own history; re-tapping the tab pops it to
 * this root. Errors inside the tab are caught here (M-GL-10) so the tab bar stays usable.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';
import { useStackMotion } from '../../../src/lib/motion';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/features/shell/ShellErrorBoundary';

export default function AssistantStackLayout() {
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
