import { getTranslations } from 'next-intl/server';

import {
  BarList,
  KeyValueList,
  Panel,
  ReadError,
  SegmentedLinks,
  withParam,
} from '@/components/module-kit';
import { EnumLabel } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { getFormatters } from '@/server/formatters';
import { readAdmin } from '@/server/read';
import { userIdFrom } from '../data';

/*
 * User › Kullanım (BACKOFFICE_PLAN §6.3d; M§42, M§119): counts only. AI requests, tokens, cost and
 * budget units per feature against the plan's `ai_daily_budget_units`, days the budget was hit,
 * feature usage events, approvals, reminders, captures, content volumes and notification decisions.
 */
const RANGES = ['7d', '30d', '90d'] as const;
type UsageRange = (typeof RANGES)[number];

export default async function UserUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = await userIdFrom(params);
  const sp = await searchParams;
  const range: UsageRange = RANGES.includes(sp.range as UsageRange)
    ? (sp.range as UsageRange)
    : '30d';
  const [t, tr, te, f, result] = await Promise.all([
    getTranslations('backoffice.userDetail.usage'),
    getTranslations('backoffice.dashboard.range'),
    getTranslations('backoffice.enums'),
    getFormatters(),
    readAdmin('GET /users/:id/usage', { params: { id }, query: { range } }),
  ]);
  const picker = (
    <SegmentedLinks
      label={tr('label')}
      active={range}
      items={RANGES.map((key) => ({
        key,
        href: withParam(`/users/${id}/usage`, sp, { range: key }),
        label: tr(`r${key}`),
      }))}
    />
  );
  if (!result.ok) {
    return (
      <>
        {picker}
        <Card>
          <ReadError error={result.error} />
        </Card>
      </>
    );
  }
  const data = result.data;
  const byFeature = new Map<
    string,
    { requests: number; input: number; output: number; cost: number; units: number }
  >();
  const byDay = new Map<string, { requests: number; cost: number; units: number }>();
  for (const day of data.ai.days) {
    const feature = byFeature.get(day.feature) ?? {
      requests: 0,
      input: 0,
      output: 0,
      cost: 0,
      units: 0,
    };
    feature.requests += day.requests;
    feature.input += day.input_tokens;
    feature.output += day.output_tokens;
    feature.cost += day.cost_usd;
    feature.units += day.units;
    byFeature.set(day.feature, feature);
    const total = byDay.get(day.date) ?? { requests: 0, cost: 0, units: 0 };
    total.requests += day.requests;
    total.cost += day.cost_usd;
    total.units += day.units;
    byDay.set(day.date, total);
  }
  const budget = data.ai.daily_budget_units;
  const empty = data.ai.days.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {picker}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={t('ai')}
          description={
            budget === null
              ? t('budgetNone', { days: data.ai.budget_hit_days })
              : t('budget', { units: budget, days: data.ai.budget_hit_days })
          }
          className="xl:col-span-2"
        >
          {empty ? (
            <p className="text-bo-body text-ink-2">{t('empty')}</p>
          ) : (
            <table className="w-full text-bo-table tabular-nums">
              <caption className="sr-only">{t('ai')}</caption>
              <thead>
                <tr className="text-bo-meta text-ink-2">
                  <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                    {t('feature')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t('requests')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t('inputTokens')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t('outputTokens')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    {t('cost')}
                  </th>
                  <th scope="col" className="py-1.5 text-right font-semibold">
                    {t('units')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...byFeature.entries()].map(([feature, row]) => (
                  <tr key={feature} className="border-t border-border-row">
                    <td className="py-1.5 pr-3 text-ink">
                      <EnumLabel group="aiFeature" value={feature} />
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.requests)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.input)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.number(row.output)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink">{f.usd(row.cost)}</td>
                    <td className="py-1.5 text-right text-ink">{f.number(row.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title={t('daily')}>
          <BarList
            label={t('daily')}
            tone="primary"
            emptyText={t('empty')}
            items={[...byDay.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([date, row]) => ({
                key: date,
                label: f.localDate(date),
                value: row.units,
                display:
                  budget !== null && row.units >= budget
                    ? t('unitsOverBudget', { units: f.number(row.units) })
                    : f.number(row.units),
              }))}
          />
        </Panel>
        <Panel title={t('features')}>
          <BarList
            label={t('features')}
            emptyText={t('empty')}
            items={Object.entries(data.feature_usage).map(([key, value]) => ({
              key,
              label: t(`featureEvents.${key as keyof typeof data.feature_usage}`),
              value,
              display: f.number(value),
            }))}
          />
        </Panel>
        <Panel title={t('activity')}>
          <KeyValueList
            items={[
              { label: t('approvalsCreated'), value: f.number(data.approvals.created) },
              { label: t('approvalsApproved'), value: f.number(data.approvals.approved) },
              { label: t('approvalsExecuted'), value: f.number(data.approvals.executed) },
              { label: t('reminders'), value: f.number(data.reminders_created) },
              { label: t('captures'), value: f.number(data.captures.count) },
              { label: t('captureBytes'), value: f.number(data.captures.bytes) },
            ]}
          />
        </Panel>
        <Panel title={t('content')}>
          <KeyValueList
            items={[
              { label: t('emailThreads'), value: f.number(data.content_volumes.email_threads) },
              { label: t('calendarEvents'), value: f.number(data.content_volumes.calendar_events) },
              { label: t('insights'), value: f.number(data.content_volumes.insights) },
              { label: t('memoryChunks'), value: f.number(data.content_volumes.memory_chunks) },
            ]}
          />
        </Panel>
        <Panel title={t('notifications')}>
          <BarList
            label={t('notifications')}
            emptyText={t('empty')}
            items={Object.entries(data.notifications_by_decision).map(([key, value]) => ({
              key,
              label: te(`notificationDecision.${key as 'sent'}`),
              value,
              display: f.number(value),
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}
