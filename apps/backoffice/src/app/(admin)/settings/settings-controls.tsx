'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { setDensityAction, setLocaleAction, setTimezoneAction } from '@/actions/preferences';
import { ActionButton } from '@/components/action-dialog';
import { useMessage } from '@/components/admin-provider';
import { RadioField, SelectField } from '@/components/form-fields';
import { useSessionActions } from '@/components/session-actions';
import { useSetTheme, useTheme, type Theme } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** Timezones offered in the preference (the admin's zone formats every date, §5.8). */
const TIMEZONES = [
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
] as const;

/*
 * Preferences (§6.24, L1): theme "Açık / Koyu", language, timezone and density. Each change is
 * stored in `admin_preferences` (theme and language also in their cookies) and follows the admin to
 * other browsers and devices.
 */
export function PreferenceControls({
  theme: initialTheme,
  locale,
  timezone,
  density,
}: {
  theme: Theme;
  locale: 'tr' | 'en';
  timezone: string;
  density: 'comfortable' | 'compact';
}) {
  const t = useTranslations('backoffice.settings.preferences');
  const theme = useTheme(initialTheme);
  const { setTheme } = useSetTheme();
  const toast = useToast();
  const message = useMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(
    action: () => Promise<{
      ok: boolean;
      error?: { messageKey: string; values: Readonly<Record<string, string | number>> };
    }>,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.show(t('saved'));
        router.refresh();
        return;
      }
      if (result.error !== undefined)
        toast.show(message(result.error.messageKey, result.error.values), 'error');
    });
  }

  return (
    <div className="grid max-w-xl gap-4" aria-busy={pending}>
      <RadioField
        legend={t('theme')}
        value={theme}
        onChange={(next) => {
          setTheme(next);
        }}
        options={[
          { value: 'light', label: t('light') },
          { value: 'dark', label: t('dark') },
        ]}
      />
      <RadioField
        legend={t('language')}
        value={locale}
        onChange={(next) => {
          save(() => setLocaleAction(next));
        }}
        options={[
          { value: 'tr', label: t('turkish') },
          { value: 'en', label: t('english') },
        ]}
      />
      <SelectField
        label={t('timezone')}
        value={
          TIMEZONES.includes(timezone as (typeof TIMEZONES)[number]) ? timezone : 'Europe/Istanbul'
        }
        onChange={(next) => {
          save(() => setTimezoneAction(next));
        }}
        options={TIMEZONES.map((value) => ({ value, label: value }))}
      />
      <RadioField
        legend={t('density')}
        value={density}
        onChange={(next) => {
          save(() => setDensityAction(next));
        }}
        options={[
          { value: 'comfortable', label: t('comfortable') },
          { value: 'compact', label: t('compact') },
        ]}
      />
    </div>
  );
}

/*
 * Own security (§6.24): regenerate recovery codes (step-up; the new codes are shown once), sign out
 * the other sessions (L2) and sign out everywhere (the shared confirmation).
 */
export function SecurityControls() {
  const t = useTranslations('backoffice.settings.security');
  const session = useSessionActions();
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <ActionButton
          route="POST /me/recovery-codes"
          label={t('regenerate')}
          title={t('regenerateTitle')}
          effects={t('regenerateEffects')}
          confirmLabel={t('regenerate')}
          successMessage={null}
          onSuccess={(data) => {
            setCodes(data.codes);
          }}
        />
        <ActionButton
          route="POST /session/logout-all"
          body={{ scope: 'others' }}
          label={t('others')}
          title={t('othersTitle')}
          effects={t('othersEffects')}
          confirmLabel={t('others')}
          successMessage={(data) => t('othersDone', { count: data.ended_sessions })}
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            session.confirmLogoutAll();
          }}
        >
          {t('all')}
        </Button>
      </div>
      {codes === null ? null : (
        <div className="grid gap-2 rounded-tile bg-surface-sunken p-3" role="status">
          <p className="text-bo-body font-semibold text-ink">{t('newCodes')}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-bo-mono text-ink">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <p className="text-bo-meta text-ink-3">{t('newCodesHint')}</p>
        </div>
      )}
    </div>
  );
}
