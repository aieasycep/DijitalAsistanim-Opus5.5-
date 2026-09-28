/**
 * Small helpers shared by the screen-state tests: in-app navigation like a user tap (open a tab
 * root, then push), back navigation, scripted response sequences, pull-to-refresh and safe
 * indexing into query results.
 */
import { router as appRouter } from 'expo-router';
import { act, screen } from 'expo-router/testing-library';

import { json, renderApp, type Responder } from '../helpers/app';
import { errorBody } from '../helpers/fixtures';

export { appRouter };

/** Opens `root` first (so "back" has somewhere to go), then pushes `path` like an in-app tap. */
export async function openFrom(root: string, rootTestId: string, path: string) {
  const rendered = await renderApp(root);
  await screen.findByTestId(rootTestId);
  await act(async () => {
    appRouter.push(path);
    await Promise.resolve();
  });
  return rendered;
}

export async function back(): Promise<void> {
  await act(async () => {
    appRouter.back();
    await Promise.resolve();
  });
}

/** Answers with the given responses in order (then a 500). */
export function sequence(...responses: Response[]): Responder {
  return () => responses.shift() ?? json(500, errorBody('INTERNAL_ERROR'));
}

/** The item at `index` (negative counts from the end), failing the test when it is missing. */
export function nth<T>(list: readonly T[], index: number): T {
  const value = list.at(index);
  if (value === undefined) throw new Error(`no item at ${String(index)}`);
  return value;
}

/** Calls the `RefreshControl` of a scroll view or list rendered with `testID`. */
export async function pullToRefresh(testID: string): Promise<void> {
  const host = screen.getByTestId(testID);
  const control = (host.props as { refreshControl?: { props: { onRefresh?: () => unknown } } })
    .refreshControl;
  if (control?.props.onRefresh === undefined) throw new Error(`${testID} has no refresh control`);
  const refresh = control.props.onRefresh;
  await act(async () => {
    await Promise.resolve(refresh());
  });
}
