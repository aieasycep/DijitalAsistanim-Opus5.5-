import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { KeyValueList, Panel, ReadError, TabNav } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { Card } from '@/components/ui/card';
import { parseRange } from '@/lib/ranges';
import { getFormatters } from '@/server/formatters';
import { THEME_COOKIE, parseTheme } from '@/server/preference-cookies';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { serverSupabase } from '@/server/supabase';
import { BackupFactorControls, type MfaFactorItem } from './backup-factor';
import { PreferenceControls, SecurityControls } from './settings-controls';
import { SystemSettings } from './system-settings';

/*
 * Ayarlar (BACKOFFICE_PLAN §6.24; M§72; ADR-06; T-10.14): the admin's own preferences (theme,
 * language, timezone, density; L1, persisted server-side), own security (sessions, recovery codes,
 * sign-out elsewhere) and the system settings: `app_settings` and `plan_limits`, readable by every
 * admin and changed only with `settings.system.write` (L3, step-up, before/after). Session values
 * can only be tightened; admin-api enforces the bounds.
 */

const TABS = ['preferences', 'security', 'system'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.settings');
  return { title: t('title') };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context, store] = await Promise.all([
    getTranslations('backoffice.settings'),
    searchParams,
    loadAdminContext(),
    cookies(),
  ]);
  const tab = parseRange(params.tab, TABS, 'preferences');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TabNav
        label={t('tabs.label')}
        active={tab}
        items={TABS.map((key) => ({
          key,
          href: key === 'preferences' ? '/settings' : `/settings?tab=${key}`,
          label: t(`tabs.${key}`),
        }))}
      />
      {tab === 'preferences' ? (
        <Panel title={t('preferences.title')}>
          <PreferenceControls
            theme={parseTheme(store.get(THEME_COOKIE)?.value)}
            locale={context.preferences.locale}
            timezone={context.preferences.timezone}
            density={context.preferences.density}
          />
        </Panel>
      ) : null}
      {tab === 'security' ? (
        <Suspense fallback={<LoadingState rows={6} />}>
          <Security />
        </Suspense>
      ) : null}
      {tab === 'system' ? (
        <Suspense fallback={<LoadingState rows={8} />}>
          <System />
        </Suspense>
      ) : null}
    </>
  );
}

/** The admin's verified TOTP factors from their own Auth session (names and dates only). */
async function ownFactors(): Promise<MfaFactorItem[] | null> {
  const supabase = await serverSupabase();
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error !== null) return null;
  return listed.data.totp.map((factor) => ({
    id: factor.id,
    name: factor.friendly_name ?? null,
    createdAt: factor.created_at,
  }));
}

async function Security() {
  const [t, f, context, sessions, factors] = await Promise.all([
    getTranslations('backoffice.settings.security'),
    getFormatters(),
    loadAdminContext(),
    readAdmin('GET /me/sessions'),
    ownFactors(),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title={t('account')}>
        <KeyValueList
          columns={1}
          items={[
            { label: t('email'), value: context.admin.email },
            { label: t('factors'), value: f.number(context.admin.mfaFactorCount) },
            {
              label: t('recoveryRemaining'),
              value: f.number(context.admin.recoveryCodesRemaining),
            },
          ]}
        />
        <SecurityControls />
        {factors === null ? (
          <p className="text-bo-meta text-ink-2">{t('backup.unavailable')}</p>
        ) : (
          <BackupFactorControls factors={factors} />
        )}
      </Panel>
      <Panel title={t('sessions')}>
        {!sessions.ok ? (
          <ReadError error={sessions.error} compact />
        ) : sessions.data.length === 0 ? (
          <p className="text-bo-body text-ink-2">{t('noSessions')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-row" data-testid="own-sessions">
            {sessions.data.map((session) => (
              <li key={session.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex items-center gap-2 text-bo-body text-ink">
                  {session.browser_family}
                  {session.current ? (
                    <span className="rounded-pill bg-primary-soft px-2 text-bo-meta text-on-soft">
                      {t('current')}
                    </span>
                  ) : null}
                </span>
                <span className="text-bo-meta text-ink-3">
                  {t('sessionTimes', {
                    created: f.dateTime(session.created_at),
                    active: f.dateTime(session.last_activity_at),
                  })}
                  {session.ended_at === null
                    ? null
                    : ` · ${t('ended', { time: f.dateTime(session.ended_at) })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

async function System() {
  const [context, result] = await Promise.all([loadAdminContext(), readAdmin('GET /settings')]);
  if (!result.ok) {
    return (
      <Card>
        <ReadError error={result.error} />
      </Card>
    );
  }
  return (
    <SystemSettings
      appSettings={result.data.app_settings}
      planLimits={result.data.plan_limits}
      writable={context.permissions.includes('settings.system.write')}
    />
  );
}
