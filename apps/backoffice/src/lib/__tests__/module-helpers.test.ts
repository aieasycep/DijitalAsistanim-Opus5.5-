import { describe, expect, it } from 'vitest';

import { ageTone } from '@/app/(admin)/data-requests/data-requests-table';
import { regenerateBlock } from '@/components/regenerate-briefing';
import { loadTableState } from '@/components/data-table/url-state';
import { roleOf, retiresSoon, slotSummary } from '@/lib/ai-features';
import { auditQuery } from '@/lib/audit-query';
import { autoMask, maskPhone } from '@/lib/automask';
import {
  aiRamp,
  breakdownEntries,
  OTHER_KEY,
  pivotTop,
  weightedRate,
} from '@/lib/chart-transforms';
import { canWriteFlagKey, isAiFlag, targetingSummary } from '@/lib/flags';
import {
  confirmToken,
  createFormatters,
  daysBetween,
  formatRelative,
  localDateIn,
  shortId,
} from '@/lib/formatters';
import { effectiveStatus, isStale, overallHealth } from '@/lib/health';
import { BULK_RETRY_TYPED_THRESHOLD, cancelBlock, retryBlock } from '@/lib/job-policy';
import { promptVariables } from '@/lib/prompt-lint';
import { parseRange } from '@/lib/ranges';
import { pageOf, toTableData } from '@/lib/read-result';
import { statusTone } from '@/lib/status-tone';

/* Page data mapping and module policy helpers (BACKOFFICE_PLAN §5–§7, T-10.15). */

const NOW = Date.parse('2026-09-24T09:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatters', () => {
  it('formats numbers, money, ratios and dates per locale and timezone', () => {
    const tr = createFormatters('tr', 'Europe/Istanbul');
    expect(tr.number(12_480)).toBe('12.480');
    expect(tr.usd(412.37)).toContain('412,37');
    expect(tr.percent(0.97)).toContain('97');
    expect(tr.number(null)).toBe('—');
    expect(tr.localDate('2026-09-24')).toBe('24.09.2026');
    expect(createFormatters('en').localDate('2026-09-24')).toBe('09/24/2026');
    expect(tr.dateTime('2026-09-24T09:00:00Z')).toContain('12:00');
    expect(tr.duration(950)).toMatch(/950/);
    expect(tr.duration(90_000)).toMatch(/1,5/);
  });

  it('computes relative times, local days and confirmation tokens', () => {
    expect(formatRelative('en', ago(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(formatRelative('tr', ago(-2 * 3_600_000), NOW)).toBe('2 saat sonra');
    expect(localDateIn('Europe/Istanbul', Date.parse('2026-09-23T22:30:00Z'))).toBe('2026-09-24');
    expect(daysBetween('2026-09-20', '2026-09-24')).toBe(4);
    expect(shortId('0190f5e0-1111-7000-8000-00000000abcd')).toBe('0190f5e0');
    expect(confirmToken('0190f5e0-1111-7000-8000-00000000abcd')).toBe('00abcd');
  });
});

describe('chart transforms', () => {
  it('keeps the top series and folds the rest into "Diğer"', () => {
    const entries = ['a', 'b', 'c'].flatMap((key, i) => [
      { t: '2026-09-23', key, value: 10 - i },
      { t: '2026-09-24', key, value: 10 - i },
    ]);
    const pivoted = pivotTop(entries, 2);
    expect(pivoted.keys).toEqual(['a', 'b', OTHER_KEY]);
    expect(pivoted.rows).toEqual([
      { t: '2026-09-23', a: 10, b: 9, other: 8 },
      { t: '2026-09-24', a: 10, b: 9, other: 8 },
    ]);
  });

  it('uses the breakdown when present and weights rates by requests', () => {
    expect(
      breakdownEntries(
        [
          { t: 't1', value: 3, breakdown: { x: 1, y: 2 } },
          { t: 't2', value: 5 },
        ],
        'total',
      ),
    ).toEqual([
      { t: 't1', key: 'x', value: 1 },
      { t: 't1', key: 'y', value: 2 },
      { t: 't2', key: 'total', value: 5 },
    ]);
    expect(
      weightedRate([
        { requests: 100, rate: 0.1 },
        { requests: 300, rate: 0.02 },
      ]),
    ).toBeCloseTo(0.04);
    expect(weightedRate([])).toBeNull();
    expect(aiRamp(0)).toBe(1);
    expect(aiRamp(9)).toBe(0.2);
  });
});

describe('health', () => {
  const probe = (
    status: Parameters<typeof effectiveStatus>[0]['status'],
    minutes = 2,
    component = 'api',
  ) => ({
    component,
    status,
    checked_at: ago(minutes * 60_000),
  });

  it('treats stale probes as unknown and never shows green by default', () => {
    expect(isStale(ago(11 * 60_000), NOW)).toBe(true);
    expect(effectiveStatus(probe('healthy', 11), NOW)).toBe('unknown');
    expect(overallHealth([], NOW, false)).toBe('unknown');
    expect(overallHealth([probe('healthy')], NOW, false)).toBe('operational');
    expect(overallHealth([probe('healthy'), probe('degraded')], NOW, false)).toBe('partial');
    expect(overallHealth([probe('healthy'), probe('down')], NOW, false)).toBe('outage');
  });

  it('a missing required credential is partial in production only', () => {
    const probes = [probe('healthy'), probe('external_credential_required', 2, 'revenuecat')];
    expect(overallHealth(probes, NOW, false)).toBe('operational');
    expect(overallHealth(probes, NOW, true)).toBe('partial');
    const optional = [probe('healthy'), probe('external_credential_required', 2, 'ai_openai')];
    expect(overallHealth(optional, NOW, true)).toBe('operational');
  });
});

describe('module policies', () => {
  it('job retry and cancel mirror the admin policy', () => {
    expect(retryBlock({ type: 'gmail_sync', status: 'dead_letter' })).toBeNull();
    expect(retryBlock({ type: 'gmail_sync', status: 'completed' })).toBe('status');
    expect(retryBlock({ type: 'push_receipts', status: 'failed' })).toBe('periodic');
    expect(retryBlock({ type: 'export', status: 'failed' })).toBe('data_request');
    expect(cancelBlock({ status: 'running' })).toBe('running');
    expect(cancelBlock({ status: 'queued' })).toBeNull();
    expect(cancelBlock({ status: 'completed' })).toBe('status');
    expect(BULK_RETRY_TYPED_THRESHOLD).toBe(10);
  });

  it("regenerate applies to the user's failed or skipped briefing of today (±1 day)", () => {
    expect(regenerateBlock('failed', '2026-09-24', '2026-09-24')).toBeNull();
    expect(regenerateBlock('skipped', '2026-09-23', '2026-09-24')).toBeNull();
    expect(regenerateBlock('delivered', '2026-09-24', '2026-09-24')).toBe('status');
    expect(regenerateBlock('failed', '2026-09-20', '2026-09-24')).toBe('date');
  });

  it('data request age and badge tones escalate', () => {
    expect(ageTone(3)).toBe('neutral');
    expect(ageTone(10)).toBe('warning');
    expect(ageTone(26)).toBe('critical');
    expect(statusTone('dead_letter')).toBe('critical');
    expect(statusTone('retrying')).toBe('warning');
    expect(statusTone('delivered')).toBe('success');
  });

  it('flags: ai.* and voice.* keys are writable with flags.write_ai only', () => {
    const aiOnly = (permission: string) => permission === 'flags.write_ai';
    expect(isAiFlag('voice.stt_server')).toBe(true);
    expect(canWriteFlagKey(aiOnly, 'ai.batch.enabled')).toBe(true);
    expect(canWriteFlagKey(aiOnly, 'feature.voice')).toBe(false);
    expect(
      targetingSummary({
        rollout_percent: 25,
        platforms: ['ios'],
        plans: ['pro'],
        min_version: '1.4.0',
        max_version: null,
      }),
    ).toBe('%25 · ios · pro · ≥1.4.0');
  });

  it('AI slots group features by role and flag retiring models', () => {
    expect(roleOf('email_triage')).toBe('classifier');
    expect(roleOf('embedding_query')).toBe('embedding');
    expect(roleOf('briefing_morning')).toBe('reasoning');
    const rows = [
      { feature: 'a', primary_target: { provider: 'anthropic', model: 'm1' } },
      { feature: 'b', primary_target: { provider: 'anthropic', model: 'm1' } },
      { feature: 'c', primary_target: { provider: 'openai', model: 'm2' } },
    ];
    const summary = slotSummary(rows);
    expect(summary.model).toBe('anthropic/m1');
    expect(summary.exceptions.map((r) => r.feature)).toEqual(['c']);
    expect(retiresSoon(new Date(NOW + 10 * 86_400_000).toISOString(), NOW)).toBe(true);
    expect(retiresSoon(null, NOW)).toBe(false);
  });

  it('prompt variables and free-text masking', () => {
    expect(promptVariables('Merhaba {{ user_first_name }}, {{items_json}} {{items_json}}')).toEqual(
      ['user_first_name', 'items_json'],
    );
    expect(autoMask('Yaz: ayse.kaya@example.com, tel +90 532 111 22 33')).not.toMatch(
      /ayse\.kaya|532 111/,
    );
    expect(maskPhone('+90 532 111 22 33')).toMatch(/^\+•+33$/);
  });
});

describe('page data mapping', () => {
  it('maps list reads to table data, forbidden and aggregates-only states', () => {
    const ok = toTableData({
      ok: true,
      data: [{ id: 1 }],
      meta: { total: 40, total_is_estimate: true },
    });
    expect(ok).toMatchObject({
      rows: [{ id: 1 }],
      total: 40,
      totalIsEstimate: true,
      status: 'ready',
    });
    const denied = {
      ok: false as const,
      error: { code: 'FORBIDDEN', correlationId: 'c1', forbidden: true, notFound: false },
    };
    expect(toTableData(denied).status).toBe('forbidden');
    expect(toTableData(denied, { aggregatesVisible: true }).status).toBe('aggregatesOnly');
    const failed = toTableData({
      ok: false,
      error: { code: 'UPSTREAM', correlationId: 'c2', forbidden: false, notFound: false },
    });
    expect(failed).toMatchObject({ status: 'error', error: { correlationId: 'c2' } });
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual({ rows: [3, 4], total: 5 });
  });

  it('builds the audit query from the URL (single values, day bounds, no free-text search)', () => {
    const state = loadTableState(
      {
        'f.result': 'denied,success',
        'f.from': '2026-09-20',
        'f.to': '2026-09-24',
        q: 'x',
        sort: 'ts',
      },
      ['action', 'result', 'actor_role', 'actor_id', 'target_type', 'target_id', 'from', 'to'],
    );
    expect(auditQuery(state)).toMatchObject({
      'filter[result]': 'denied',
      'filter[from]': '2026-09-20T00:00:00Z',
      'filter[to]': '2026-09-24T23:59:59Z',
      sort: 'ts',
    });
    expect(auditQuery(state)).not.toHaveProperty('q');
    expect(parseRange(['30d'], ['24h', '7d', '30d'] as const, '7d')).toBe('30d');
    expect(parseRange('1y', ['24h', '7d'] as const, '7d')).toBe('7d');
  });
});
