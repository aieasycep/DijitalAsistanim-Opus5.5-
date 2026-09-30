'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useSyncExternalStore, useTransition } from 'react';

import { setThemeAction } from '@/actions/preferences';
import { useMessage } from '@/components/admin-provider';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export type Theme = 'light' | 'dark';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    observer.disconnect();
  };
}

/** The live `<html data-theme>` value; `initial` is what the server rendered. */
export function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => initial,
  );
}

/**
 * Applies a theme immediately (charts and tokens follow `data-theme` without a reload) and persists it:
 * the theme cookie for flash-free SSR plus `admin_preferences.theme` through admin-api (§6.24).
 */
export function useSetTheme(): { setTheme: (theme: Theme) => void; pending: boolean } {
  const toast = useToast();
  const message = useMessage();
  const [pending, startTransition] = useTransition();
  const setTheme = useCallback(
    (theme: Theme) => {
      document.documentElement.dataset.theme = theme;
      startTransition(async () => {
        const result = await setThemeAction(theme);
        if (!result.ok) toast.show(message(result.error.messageKey, result.error.values), 'error');
      });
    },
    [message, toast],
  );
  return { setTheme, pending };
}

/** Topbar theme toggle "Açık / Koyu" (BACKOFFICE_PLAN §5.1, M§72). */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useTranslations('backoffice.theme');
  const theme = useTheme(initial);
  const { setTheme, pending } = useSetTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={next === 'dark' ? t('switchToDark') : t('switchToLight')}
      title={`${t('label')}: ${theme === 'dark' ? t('dark') : t('light')}`}
      disabled={pending}
      onClick={() => {
        setTheme(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
    </Button>
  );
}
