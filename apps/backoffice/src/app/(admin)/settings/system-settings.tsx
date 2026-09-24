'use client';

import {
  APP_SETTING_VALUE_SCHEMAS,
  PLAN_LIMIT_VALUE_SCHEMAS,
  appSettingValueValid,
  type PlanLimitKey,
} from '@da/validation/admin/system';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton } from '@/components/action-dialog';
import { Panel } from '@/components/module-kit';
import { TextAreaField } from '@/components/form-fields';

/*
 * System settings (BACKOFFICE_PLAN §6.24): `app_settings` keys and `plan_limits` per plan, shown to
 * every admin; with `settings.system.write` each value is edited as JSON, validated against the
 * key's `@da/validation` schema before sending, and saved as L3 (typed key, step-up) with the before
 * → after values. `ai_routing_profile` is switched on the Models page.
 */

function display(value: unknown): string {
  return value === undefined ? '—' : JSON.stringify(value);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function EditValue({
  kind,
  settingKey,
  plan,
  current,
}: {
  kind: 'config' | 'plan';
  settingKey: string;
  plan?: 'free' | 'pro';
  current: unknown;
}) {
  const t = useTranslations('backoffice.settings.system');
  const [text, setText] = useState(display(current === undefined ? null : current));
  const parsed = parseJson(text);
  const validate = () => {
    if (!parsed.ok) return t('invalidJson');
    if (kind === 'config')
      return appSettingValueValid(settingKey, parsed.value) ? null : t('outOfRange');
    const schema = PLAN_LIMIT_VALUE_SCHEMAS[settingKey as PlanLimitKey];
    return schema.safeParse(parsed.value).success ? null : t('outOfRange');
  };
  const effects = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-bo-mono">
      <dt className="text-ink-3">{t('before')}</dt>
      <dd className="break-all">{display(current)}</dd>
      <dt className="text-ink-3">{t('after')}</dt>
      <dd className="break-all">{parsed.ok ? display(parsed.value) : text}</dd>
    </dl>
  );
  const fields = (
    <TextAreaField
      label={t('value')}
      value={text}
      onChange={setText}
      rows={4}
      mono
      help={t('valueHelp')}
    />
  );
  return kind === 'config' ? (
    <ActionButton
      route="PATCH /settings/config/:key"
      params={{ key: settingKey }}
      body={() => ({ value: parsed.ok ? parsed.value : null })}
      label={t('edit')}
      variant="ghost"
      title={t('editTitle', { key: settingKey })}
      effects={effects}
      fields={fields}
      validate={validate}
      typedToken={settingKey}
      confirmLabel={t('save')}
      successMessage={t('saved')}
      testId={`setting-${settingKey}`}
    />
  ) : (
    <ActionButton
      route="PATCH /settings/plan-limits"
      body={() => ({ plan, key: settingKey, value: parsed.ok ? parsed.value : null })}
      label={t('edit')}
      variant="ghost"
      title={t('editLimitTitle', { key: settingKey, plan: plan ?? '' })}
      effects={effects}
      fields={fields}
      validate={validate}
      typedToken={settingKey}
      confirmLabel={t('save')}
      successMessage={t('saved')}
      testId={`limit-${plan ?? ''}-${settingKey}`}
    />
  );
}

export function SystemSettings({
  appSettings,
  planLimits,
  writable,
}: {
  appSettings: Readonly<Record<string, unknown>>;
  planLimits: { free: Readonly<Record<string, unknown>>; pro: Readonly<Record<string, unknown>> };
  writable: boolean;
}) {
  const t = useTranslations('backoffice.settings.system');
  const configKeys = [
    ...new Set([...Object.keys(APP_SETTING_VALUE_SCHEMAS), ...Object.keys(appSettings)]),
  ].sort();
  const limitKeys = Object.keys(PLAN_LIMIT_VALUE_SCHEMAS) as PlanLimitKey[];
  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('config')} description={writable ? t('configHint') : t('readOnly')}>
        <table className="w-full text-bo-table" data-testid="app-settings">
          <caption className="sr-only">{t('config')}</caption>
          <thead>
            <tr className="text-left text-bo-meta text-ink-2">
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                {t('key')}
              </th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                {t('value')}
              </th>
              <th scope="col" className="py-1.5 font-semibold">
                <span className="sr-only">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {configKeys.map((key) => (
              <tr key={key} className="border-t border-border-row align-top">
                <th scope="row" className="py-1.5 pr-3 text-left font-mono font-normal text-ink">
                  {key}
                  {key.startsWith('session.') ? (
                    <span className="block font-sans text-bo-meta text-ink-3">
                      {t('tightenOnly')}
                    </span>
                  ) : null}
                </th>
                <td className="py-1.5 pr-3 font-mono break-all text-ink">
                  {display(appSettings[key])}
                </td>
                <td className="py-1.5 text-right">
                  {writable && key in APP_SETTING_VALUE_SCHEMAS ? (
                    <EditValue kind="config" settingKey={key} current={appSettings[key]} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title={t('limits')} description={t('limitsHint')}>
        <div className="overflow-x-auto">
          <table className="w-full text-bo-table" data-testid="plan-limits">
            <caption className="sr-only">{t('limits')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('key')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('free')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('pro')}
                </th>
              </tr>
            </thead>
            <tbody>
              {limitKeys.map((key) => (
                <tr key={key} className="border-t border-border-row">
                  <th scope="row" className="py-1.5 pr-3 text-left font-mono font-normal text-ink">
                    {key}
                  </th>
                  {(['free', 'pro'] as const).map((plan) => (
                    <td key={plan} className="py-1.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-ink">{display(planLimits[plan][key])}</span>
                        {writable && key !== 'ai_routing_profile' ? (
                          <EditValue
                            kind="plan"
                            settingKey={key}
                            plan={plan}
                            current={planLimits[plan][key]}
                          />
                        ) : null}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
