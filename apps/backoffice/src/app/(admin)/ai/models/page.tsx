import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { KeyValueList, Panel, ReadError, SegmentedLinks, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { EnumLabel, StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { retiresSoon, slotRoles, slotSummary } from '@/lib/ai-features';
import { parseRange } from '@/lib/ranges';
import { requestTime } from '@/server/clock';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { AiTabs } from '../ai-tabs';
import { ModelRowActions, RoutingProfileControl } from './model-controls';

/*
 * AI model config (BACKOFFICE_PLAN §6.10; M§57, M§81; R-01, R-02, R-18; T-10.10): the per-plan
 * routing profile, provider credential presence (configured / not configured, never values), the
 * M§57 model slots (classifier, reasoning, embedding, TTS, STT) and one row per (profile, feature).
 * Edits are validated before sending: embedding rows accept only 1024-d models, forbidden model
 * families are refused (R-02), and admin-api re-checks the eval gate and the catalogue.
 */

const PROFILES = ['balanced', 'lean'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.models');
  return { title: t('title') };
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, tai, f, params, result] = await Promise.all([
    getTranslations('backoffice.models'),
    getTranslations('backoffice.ai'),
    getFormatters(),
    searchParams,
    readAdmin('GET /ai/models'),
  ]);
  const profile = parseRange(params.profile, PROFILES, 'balanced');
  const header = <PageHeader title={tai('title')} description={t('description')} />;
  if (!result.ok) {
    return (
      <>
        {header}
        <AiTabs active="models" />
        <Card>
          <ReadError error={result.error} />
        </Card>
      </>
    );
  }
  const {
    configs,
    plan_profiles: planProfiles,
    credentials,
    profile_costs: profileCosts,
  } = result.data;
  const rows = configs.filter((row) => row.profile === profile);
  const now = requestTime();
  return (
    <>
      {header}
      <AiTabs active="models" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('routing')} description={t('routingHint')}>
          <RoutingProfileControl
            free={planProfiles.free}
            pro={planProfiles.pro}
            costs={{
              balanced: profileCosts.balanced.monthly_usd,
              lean: profileCosts.lean.monthly_usd,
            }}
          />
        </Panel>
        <Panel title={t('providers')}>
          <ul className="flex flex-col gap-2" data-testid="provider-credentials">
            {(['anthropic', 'openai', 'voyage', 'stt', 'tts'] as const).map((provider) => {
              const state = credentials[provider];
              return (
                <li key={provider} className="flex items-center justify-between gap-2">
                  <span className="text-bo-body text-ink">
                    <EnumLabel group="modelProvider" value={provider} />
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge group="credential" value={state} />
                    {state === 'configured' ? null : (
                      <span className="text-bo-meta text-ink-3">{t('credentialRequired')}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <Panel
        title={t('slots')}
        actions={
          <SegmentedLinks
            label={t('profile')}
            active={profile}
            items={PROFILES.map((key) => ({
              key,
              href: withParam('/ai/models', params, { profile: key }),
              label: t(`profiles.${key}`),
            }))}
          />
        }
      >
        <KeyValueList
          columns={3}
          items={slotRoles(rows).map((role) => {
            const summary = slotSummary(rows.filter((row) => row.role === role));
            return {
              label: t(`roles.${role}`),
              value: (
                <span className="flex flex-col">
                  <span className="font-mono text-bo-mono">{summary.model ?? '—'}</span>
                  {summary.exceptions.length === 0 ? null : (
                    <span className="text-bo-meta text-ink-3">
                      {t('exceptions', { count: summary.exceptions.length })}
                    </span>
                  )}
                </span>
              ),
            };
          })}
        />
      </Panel>
      <Panel title={t('routingTable')} description={t('routingTableHint')}>
        <div className="overflow-x-auto">
          <table className="w-full text-bo-table tabular-nums" data-testid="model-config">
            <caption className="sr-only">{t('routingTable')}</caption>
            <thead>
              <tr className="text-left text-bo-meta text-ink-2">
                {(
                  [
                    'feature',
                    'role',
                    'tier',
                    'primary',
                    'fallbacks',
                    'escalation',
                    'batch',
                    'cache',
                    'maxInput',
                    'enabled',
                    'eval',
                    'retires',
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className="py-1.5 pr-3 font-semibold whitespace-nowrap">
                    {t(`columns.${key}`)}
                  </th>
                ))}
                <th scope="col" className="py-1.5 font-semibold">
                  <span className="sr-only">{t('columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.profile}-${row.feature}`}
                  className="border-t border-border-row align-top"
                  data-testid={`model-${row.feature}`}
                >
                  <td className="py-1.5 pr-3 text-ink">
                    <EnumLabel group="aiFeature" value={row.feature} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{t(`roles.${row.role}`)}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink uppercase">{row.tier}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {row.primary_target.provider}/{row.primary_target.model}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {row.fallback_targets
                      .map((target) => `${target.provider}/${target.model}`)
                      .join(', ') || '—'}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {row.escalation_target === null
                      ? '—'
                      : `${row.escalation_target.provider}/${row.escalation_target.model}`}
                  </td>
                  <td className="py-1.5 pr-3 text-ink">
                    <EnumLabel group="batchPolicy" value={row.batch_policy} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{row.cache_ttl ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right text-ink">
                    {f.number(row.max_input_tokens)}
                  </td>
                  <td className="py-1.5 pr-3 text-ink">{row.enabled ? t('on') : t('off')}</td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge group="evalStatus" value={row.eval_status} />
                  </td>
                  <td className="py-1.5 pr-3 text-ink">
                    {row.retires_not_before === null ? (
                      '—'
                    ) : retiresSoon(row.retires_not_before, now) ? (
                      <span className="rounded-pill bg-tone-warning-soft px-2 text-bo-meta text-tone-warning-text">
                        {t('retiresSoon', { date: f.dateTime(row.retires_not_before) })}
                      </span>
                    ) : (
                      f.dateTime(row.retires_not_before)
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <ModelRowActions row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
