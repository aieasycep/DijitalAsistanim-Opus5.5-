/**
 * Mounted by the root layout: once the user is in the app on an Android device with the listener
 * module, binds the NI foreground/new-signal triggers and runs the first foreground pass
 * (entitlement reconcile, pending registration mirror, upload). Renders nothing.
 */
import { useEffect } from 'react';

import { bindAniLifecycle, onAniForeground } from './lifecycle';

export function AniBridge({ signedIn }: { readonly signedIn: boolean }): null {
  useEffect(() => {
    if (!signedIn) return;
    bindAniLifecycle();
    void onAniForeground();
  }, [signedIn]);
  return null;
}
