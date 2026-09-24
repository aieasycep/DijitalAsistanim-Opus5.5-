'use client';

import { useSyncExternalStore } from 'react';

/*
 * Theme-aware chart colours (BACKOFFICE_PLAN §5.7): every colour is read from the `--da-*` CSS
 * variables of the current theme, and a `data-theme` switch re-renders charts without a reload.
 * Charts render only after mount (see `useMounted`), so the server never guesses a colour.
 */

export const SERIES_TOKENS = {
  ai: '--da-brand-primary',
  aiSecondary: '--da-brand-glow',
  success: '--da-tone-success-solid',
  failure: '--da-tone-critical-solid',
  warning: '--da-tone-warning-solid',
  info: '--da-tone-info-solid',
  neutral: '--da-tone-neutral-solid',
} as const;

export const CHROME_TOKENS = {
  grid: '--da-border-hairline',
  axis: '--da-text-secondary',
  tooltipBg: '--da-surface',
  tooltipText: '--da-text-primary',
  cursor: '--da-surface-pressed',
} as const;

export type SeriesKind = keyof typeof SERIES_TOKENS;
export type ChartColors = Record<SeriesKind | keyof typeof CHROME_TOKENS, string>;

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    observer.disconnect();
  };
}

/** Resolves every series and chrome token; an unresolved token falls back to `var(--…)`. */
export function resolveChartColors(read: (token: string) => string): ChartColors {
  const out: Partial<ChartColors> = {};
  for (const [key, token] of Object.entries({ ...SERIES_TOKENS, ...CHROME_TOKENS })) {
    const value = read(token).trim();
    out[key as keyof ChartColors] = value === '' ? `var(${token})` : value;
  }
  return out as ChartColors;
}

/** The current theme name (`light` | `dark`), re-read when `<html data-theme>` changes. */
export function useThemeName(): string {
  return useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme ?? 'light',
    () => 'light',
  );
}

export function useChartColors(): ChartColors {
  const theme = useThemeName();
  const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  return resolveChartColors((token) =>
    style === null || theme === '' ? '' : style.getPropertyValue(token),
  );
}

function noopSubscribe(): () => void {
  return () => undefined;
}

/** `false` during SSR and hydration, `true` afterwards. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
