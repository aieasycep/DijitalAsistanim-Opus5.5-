/**
 * `useAniStatus()` (M-ANI-01 state dependency): the live listener state — the real system grant,
 * the in-app switch, the mode and allowed packages — combined with the entitlement and the
 * `feature.android_ni` kill switch. Re-read on focus, when the app returns to the foreground (for
 * example from the system "Bildirim erişimi" screen) and on the module's `onGrantChanged` event.
 */
import { useBootstrap } from '@da/api-client/react';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { pausedByLapse } from './choice';
import { isNiSupported, niCall, niModule, type NiMode } from './native';

export type AniStatusKind =
  'unsupported' | 'feature_off' | 'not_entitled' | 'lapsed' | 'not_granted' | 'paused' | 'enabled';

export interface AniStatus {
  readonly kind: AniStatusKind;
  readonly granted: boolean;
  readonly enabled: boolean;
  readonly mode: NiMode;
  readonly allowedPackages: readonly string[];
}

export function readAniStatus(input: {
  readonly pro: boolean;
  readonly featureOn: boolean;
}): AniStatus {
  const base = { granted: false, enabled: false, mode: 'selected' as NiMode, allowedPackages: [] };
  if (!isNiSupported()) return { ...base, kind: 'unsupported' };
  const state = niCall(null, (ni) => ni.getState());
  if (state === null) return { ...base, kind: 'unsupported' };
  const facts = {
    granted: state.granted,
    enabled: state.enabled,
    mode: state.mode,
    allowedPackages: state.allowedPackages,
  };
  if (!input.featureOn) return { ...facts, kind: 'feature_off' };
  if (!input.pro) return { ...facts, kind: pausedByLapse() ? 'lapsed' : 'not_entitled' };
  if (!state.granted) return { ...facts, kind: 'not_granted' };
  return { ...facts, kind: state.enabled ? 'enabled' : 'paused' };
}

/** `android_ni_opened.state` of a status (unsupported and disabled builds report nothing). */
export function openedState(
  kind: AniStatusKind,
): 'not_granted' | 'granted' | 'paused' | 'enabled' | 'not_entitled' | null {
  switch (kind) {
    case 'not_granted':
      return 'not_granted';
    case 'paused':
      return 'granted';
    case 'lapsed':
      return 'paused';
    case 'enabled':
      return 'enabled';
    case 'not_entitled':
      return 'not_entitled';
    default:
      return null;
  }
}

export function useAniStatus(): {
  readonly status: AniStatus | null;
  readonly refresh: () => void;
} {
  const bootstrap = useBootstrap();
  const pro = bootstrap.data?.entitlement.is_active ?? false;
  const featureOn = bootstrap.data?.flags['feature.android_ni'] !== false;
  const [status, setStatus] = useState<AniStatus | null>(null);
  const refresh = useCallback(() => {
    setStatus(readAniStatus({ pro, featureOn }));
  }, [pro, featureOn]);

  useFocusEffect(refresh);
  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const grant = niModule()?.addListener('onGrantChanged', refresh);
    return () => {
      app.remove();
      grant?.remove();
    };
  }, [refresh]);

  return { status, refresh };
}
