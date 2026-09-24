/**
 * Android hardware back for in-place overlays (DESIGN_AUDIT §3.0: "Android hardware back closes
 * sheets first"). While `enabled`, the handler runs before navigation; it returns true when it
 * consumed the event. iOS has no hardware back (sheets use `onAccessibilityEscape`).
 */
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

export function useBackHandler(enabled: boolean, handler: () => boolean): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
    return () => {
      subscription.remove();
    };
  }, [enabled]);
}
