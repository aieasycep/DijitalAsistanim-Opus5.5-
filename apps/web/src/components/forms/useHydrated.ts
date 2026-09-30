'use client';

import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => undefined;
}

/**
 * `false` in the server HTML and until React has hydrated, then `true`. Form submit buttons stay
 * disabled until then, so a click before hydration cannot fall through to a native form submit
 * (which would put the email address into the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
