/**
 * Listener health on M-ANI-01 (KNOWN_PLATFORM_LIMITATIONS KPL-04). The system or an OEM battery
 * manager can unbind a granted listener, which then receives nothing. On focus and every return to
 * the foreground, a listener that is granted and switched on but not bound gets one
 * `requestRebind()`; if it is still not bound after {@link REBIND_WAIT_MS}, the health card
 * appears. A bound listener that has observed no notification for a day (`stale`) shows the same
 * card. The card offers "Yeniden bağla" (another rebind, then the same wait) and the handoff to the
 * battery-optimisation list (never a direct exemption prompt; `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
 * is not declared). Every verdict comes from the module; nothing is simulated.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  batteryOptimization,
  openBatteryOptimizationSettings,
  type BatteryOptimization,
} from '../../../modules/da-platform/src';
import { niCall, niModule, type NiListenerState } from './native';

/** How long a rebind request gets before the card reports the listener as disconnected. */
export const REBIND_WAIT_MS = 10_000;

export type ListenerCard = 'hidden' | 'checking' | 'disconnected' | 'stale';

export function readListenerState(): NiListenerState | null {
  return niCall(null, (ni) => ni.getListenerState?.() ?? null);
}

export function requestRebind(): boolean {
  return niCall(false, (ni) => ni.requestRebind?.() ?? false);
}

/** The card for a state read now: rebinding is decided by the hook, not here. */
export function cardFor(state: NiListenerState | null): ListenerCard {
  if (state === null) return 'hidden';
  if (state.health === 'disconnected') return 'disconnected';
  if (state.health === 'stale') return 'stale';
  return 'hidden';
}

export interface ListenerHealthView {
  readonly card: ListenerCard;
  readonly battery: BatteryOptimization | null;
  readonly lastEventAt: string | null;
  /** "Yeniden bağla": asks for a rebind and re-checks after the wait. */
  readonly rebind: () => void;
  /** "Pil ayarlarını aç": false when no settings screen opened. */
  readonly openBattery: () => boolean;
}

/** `active`: the listener is granted and switched on (the card is meaningless otherwise). */
export function useListenerHealth(active: boolean): ListenerHealthView {
  const [card, setCard] = useState<ListenerCard>('hidden');
  const [battery, setBattery] = useState<BatteryOptimization | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const settle = useCallback(() => {
    const state = readListenerState();
    setLastEventAt(state?.lastEventAt ?? null);
    setBattery(batteryOptimization());
    setCard(cardFor(state));
  }, []);

  /**
   * One rebind request, then the verdict after the wait (a reconnect event settles it sooner). The
   * automatic attempt keeps the card hidden while it waits; the user's "Yeniden bağla" shows
   * progress on the card.
   */
  const rebindAndWait = useCallback(
    (showProgress: boolean) => {
      clearTimer();
      if (!requestRebind()) {
        settle();
        return;
      }
      setCard(showProgress ? 'checking' : 'hidden');
      timer.current = setTimeout(() => {
        timer.current = null;
        settle();
      }, REBIND_WAIT_MS);
    },
    [settle],
  );

  const check = useCallback(() => {
    if (!active) {
      clearTimer();
      setCard('hidden');
      return;
    }
    if (timer.current !== null) return;
    const state = readListenerState();
    setLastEventAt(state?.lastEventAt ?? null);
    setBattery(batteryOptimization());
    if (state?.health === 'disconnected') rebindAndWait(false);
    else setCard(cardFor(state));
  }, [active, rebindAndWait]);

  useFocusEffect(check);
  useEffect(() => {
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    // Bound or unbound by the system: a reconnect clears the card at once.
    const listener = niModule()?.addListener('onListenerChanged', () => {
      const state = readListenerState();
      if (state?.connected === true) {
        clearTimer();
        settle();
      }
    });
    return () => {
      app.remove();
      listener?.remove();
      clearTimer();
    };
  }, [check, settle]);

  return {
    card: active ? card : 'hidden',
    battery,
    lastEventAt,
    rebind: () => {
      rebindAndWait(true);
    },
    openBattery: openBatteryOptimizationSettings,
  };
}
