/** A clock tick for countdown labels ("{n} dakika kaldı", "Başladı", "Bitti"): every interval and on foreground. */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { now } from '../../lib/clock';

export function useNow(intervalMs = 60_000): number {
  const [tick, setTick] = useState(() => now().getTime());
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(now().getTime());
    }, intervalMs);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setTick(now().getTime());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return tick;
}
