/**
 * The backoffice contract gaps (BACKOFFICE_PLAN §3.3, §5.5, §6.6, §6.17, §6.22, §10): bulk retry of
 * selected jobs, the backup MFA factor limits, the flag re-enable after a kill switch, Sentry
 * crash data (configured / missing credentials / failure), the risk-threshold unit conversion and
 * the audit action catalogue (SQL view = TS catalogue; every admin-api emitter uses a catalogue
 * name).
 */
import { assert, assertEquals } from '@std/assert';
import { admin } from '@da/validation';
import { jsonResponse } from '../../_shared/testing/fetch.ts';
import { riskToContract } from '../routes/system.ts';
import {
  crashFreeByVersion,
  crashFreeFromSessions,
  resetSentryCache,
} from '../services/sentry-releases.ts';
import { ADMIN_ID, createHarness, errorOf, FACTOR_ID } from './harness.ts';

const REASON = 'Kullanıcı talebi üzerine inceleme yapıldı.';
const JOB_A = '00000000-0000-4000-8000-000000000070';
const JOB_B = '00000000-0000-4000-8000-000000000071';
const OTHER_FACTOR = '00000000-0000-4000-8000-000000000121';

// ── Jobs: bulk retry of the selected rows (§6.6) ─────────────────────────────

Deno.test(
  'retry-bulk: selected job ids go through job_retry_selected with per-job skips',
  async () => {
    const h = await createHarness({
      sql: {
        job_retry_selected: () => ({
          retried: [JOB_A],
          skipped: [{ id: JOB_B, reason_key: 'invalid_state' }],
        }),
      },
    });
    const res = await h.request('POST', '/jobs/retry-bulk', {
      body: { job_ids: [JOB_A, JOB_B], reason: REASON, confirm: true },
    });
    assertEquals(res.status, 200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    assertEquals(body.data, {
      retried: 1,
      retried_ids: [JOB_A],
      skipped: [{ id: JOB_B, reason_key: 'invalid_state' }],
    });
    assertEquals(h.rpc.find((r) => r.fn === 'job_retry_selected')?.args, {
      p_job_ids: [JOB_A, JOB_B],
      p_reason: REASON,
    });
    assert(!h.rpcNames().includes('job_retry_bulk'), 'the filter path is not used');
  },
);

Deno.test('retry-bulk: ids and a filter together are refused before the handler', async () => {
  const h = await createHarness();
  const err = await errorOf(
    await h.request('POST', '/jobs/retry-bulk', {
      body: {
        job_ids: [JOB_A],
        filter: {
          type: 'gmail_sync',
          status: 'failed',
          from: '2026-09-24T00:00:00Z',
          to: '2026-09-25T00:00:00Z',
        },
        max: 10,
        reason: REASON,
        confirm: true,
      },
    }),
  );
  assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
  assertEquals(h.rpcNames(), ['admin_me']);
});

// ── Backup MFA factor (§3.3) ─────────────────────────────────────────────────

const factors =
  (list: { id: string; status?: string }[]) => (call: { method: string; url: string }) =>
    call.method === 'GET' && /\/factors$/.test(new URL(call.url).pathname)
      ? jsonResponse(
          list.map((f) => ({
            id: f.id,
            factor_type: 'totp',
            status: f.status ?? 'verified',
          })),
        )
      : null;

Deno.test('mfa factor: a third verified factor is removed again and refused', async () => {
  const h = await createHarness({
    outbound: factors([{ id: FACTOR_ID }, { id: OTHER_FACTOR }, { id: JOB_A }]),
  });
  const err = await errorOf(
    await h.request('POST', '/me/mfa-factors', { body: { factor_id: JOB_A } }),
  );
  assertEquals([err.status, err.code, err.details.reason], [409, 'STATE_CONFLICT', 'max_factors']);
  const deletes = h.calls.filter((c) => c.method === 'DELETE').map((c) => new URL(c.url).pathname);
  assertEquals(deletes, [`/auth/v1/admin/users/${ADMIN_ID}/factors/${JOB_A}`]);
  assert(!h.rpcNames().includes('audit_write'));
});

Deno.test('mfa factor: an unverified factor cannot be confirmed', async () => {
  const h = await createHarness({
    outbound: factors([
      { id: FACTOR_ID },
      {
        id: OTHER_FACTOR,
        status: 'unverified',
      },
    ]),
  });
  const err = await errorOf(
    await h.request('POST', '/me/mfa-factors', {
      body: { factor_id: OTHER_FACTOR },
    }),
  );
  assertEquals([err.status, err.details.reason], [409, 'factor_not_verified']);
});

Deno.test('mfa factor: the last verified factor cannot be removed', async () => {
  const h = await createHarness({ outbound: factors([{ id: FACTOR_ID }]) });
  const err = await errorOf(
    await h.request('DELETE', `/me/mfa-factors/${FACTOR_ID}`, {
      body: { reason: REASON, confirm: true },
    }),
  );
  assertEquals([err.status, err.details.reason], [409, 'last_factor']);
  assertEquals(h.calls.filter((c) => c.method === 'DELETE').length, 0);
});

Deno.test('mfa factor: removal needs a fresh step-up', async () => {
  const h = await createHarness({
    stepUpUntil: null,
    outbound: factors([{ id: FACTOR_ID }, { id: OTHER_FACTOR }]),
  });
  const err = await errorOf(
    await h.request('DELETE', `/me/mfa-factors/${FACTOR_ID}`, {
      body: { reason: REASON, confirm: true },
    }),
  );
  assertEquals(err.status, 403);
  assertEquals(h.calls.filter((c) => c.method === 'DELETE').length, 0);
});

// ── Feature flags: re-enable after a kill switch (§6.17) ─────────────────────

Deno.test('flag kill: on=false re-enables the flag through flag_kill', async () => {
  const h = await createHarness({
    sql: {
      flag_kill: () => ({
        key: 'ai.global.enabled',
        description: 'AI',
        enabled: true,
        is_kill_switch: true,
        rollout_percent: 100,
        platforms: null,
        plans: null,
        min_app_version: null,
        max_app_version: null,
        payload: {},
        archived_at: null,
        overrides_count: 0,
        updated_at: '2026-09-24T08:00:00Z',
        updated_by: ADMIN_ID,
      }),
    },
  });
  const res = await h.request('POST', '/flags/ai.global.enabled/kill', {
    body: { on: false, reason: REASON, confirm: true },
  });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(h.rpc.find((r) => r.fn === 'flag_kill')?.args, {
    p_key: 'ai.global.enabled',
    p_reason: REASON,
    p_on: false,
  });
});

// ── App versions: Sentry crash data (§6.22) ──────────────────────────────────

const SENTRY_ENV = {
  SENTRY_AUTH_TOKEN: 'sentry_token_for_tests',
  SENTRY_ORG: 'dijital-asistan',
  SENTRY_PROJECT: 'da-mobile',
};

Deno.test('sentry: missing credentials report the key names and no numbers', async () => {
  resetSentryCache();
  let called = false;
  const report = await crashFreeByVersion(
    { SENTRY_ORG: 'dijital-asistan' },
    '30d',
    () => {
      called = true;
      return Promise.resolve(new Response('{}'));
    },
    0,
  );
  assertEquals(report, {
    status: 'external_credential_required',
    missing: ['SENTRY_AUTH_TOKEN', 'SENTRY_PROJECT'],
  });
  assert(!called, 'no request without credentials');
});

Deno.test(
  'sentry: crash-free rates per version, lowest build wins, cached 10 minutes',
  async () => {
    resetSentryCache();
    const urls: string[] = [];
    const fetchStub = (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      assertEquals(
        new Headers(init?.headers).get('authorization'),
        'Bearer sentry_token_for_tests',
      );
      if (url.includes('/projects/')) {
        return Promise.resolve(jsonResponse({ id: '4501' }));
      }
      return Promise.resolve(
        jsonResponse({
          groups: [
            {
              by: { release: 'com.dijitalasistan.app@1.4.0+120' },
              totals: {
                'crash_free_rate(session)': 0.998,
                'crash_free_rate(user)': 0.997,
              },
            },
            {
              by: { release: 'com.dijitalasistan.app@1.4.0+121' },
              totals: {
                'crash_free_rate(session)': 0.991,
                'crash_free_rate(user)': null,
              },
            },
            {
              by: { release: 'nightly' },
              totals: { 'crash_free_rate(session)': 0.5 },
            },
          ],
        }),
      );
    };
    const first = await crashFreeByVersion(SENTRY_ENV, '7d', fetchStub as typeof fetch, 1_000);
    assert(first.status === 'configured');
    assertEquals(
      [...first.byVersion.entries()],
      [
        [
          '1.4.0',
          {
            sessions: 0.991,
            users: 0.997,
          },
        ],
      ],
    );
    assertEquals(urls.length, 2);
    const sessionsUrl = new URL(urls[1] ?? '');
    assertEquals(sessionsUrl.pathname, '/api/0/organizations/dijital-asistan/sessions/');
    assertEquals(sessionsUrl.searchParams.get('project'), '4501');
    assertEquals(sessionsUrl.searchParams.get('groupBy'), 'release');
    assertEquals(sessionsUrl.searchParams.get('statsPeriod'), '7d');
    await crashFreeByVersion(SENTRY_ENV, '7d', fetchStub as typeof fetch, 60_000);
    assertEquals(urls.length, 2, 'served from the 10-minute cache');
  },
);

Deno.test('sentry: an API failure is unavailable (not cached)', async () => {
  resetSentryCache();
  let calls = 0;
  const failing = () => {
    calls += 1;
    return Promise.resolve(new Response('no', { status: 502 }));
  };
  assertEquals(await crashFreeByVersion(SENTRY_ENV, '30d', failing, 0), {
    status: 'unavailable',
  });
  await crashFreeByVersion(SENTRY_ENV, '30d', failing, 1);
  assertEquals(calls, 2);
  assertEquals(crashFreeFromSessions(null).size, 0);
});

Deno.test(
  'app-versions: configured Sentry fills the crash columns of the matching version',
  async () => {
    resetSentryCache();
    const h = await createHarness({
      env: SENTRY_ENV,
      outbound: (call) => {
        if (!call.url.startsWith('https://sentry.io/')) return null;
        if (call.url.includes('/projects/')) return jsonResponse({ id: 4501 });
        return jsonResponse({
          groups: [
            {
              by: { release: 'com.dijitalasistan.app@1.0.0+7' },
              totals: {
                'crash_free_rate(session)': 0.99,
                'crash_free_rate(user)': 0.98,
              },
            },
          ],
        });
      },
      sql: {
        app_versions_breakdown: () => ({
          versions: [
            {
              platform: 'ios',
              app_version: '1.0.0',
              installations: 3,
              sync_error_rate: 0,
              below_minimum: false,
            },
            {
              platform: 'android',
              app_version: '0.9.0',
              installations: 1,
              sync_error_rate: 0,
              below_minimum: true,
            },
          ],
        }),
      },
    });
    const res = await h.request('GET', '/health/app-versions?range=7d');
    const body = (await res.json()) as {
      data: {
        versions: Record<string, unknown>[];
        crash_reporting: Record<string, unknown>;
      };
    };
    assertEquals(
      body.data.versions.map((v) => [v.app_version, v.crash_free_sessions, v.crash_free_users]),
      [
        ['1.0.0', 0.99, 0.98],
        ['0.9.0', null, null],
      ],
    );
    assertEquals(body.data.crash_reporting, {
      status: 'configured',
      credential_keys: [],
    });
  },
);

// ── Settings: referral.risk_threshold unit (0–1 API, 0–100 DB) ───────────────

Deno.test('settings: the risk threshold is always read as 0–100 and returned as 0–1', () => {
  assertEquals(riskToContract(50), 0.5);
  assertEquals(riskToContract(1), 0.01);
  assertEquals(riskToContract(100), 1);
  assertEquals(riskToContract(null), null);
});

// ── Audit action catalogue (§10) ─────────────────────────────────────────────

const MIGRATIONS = new URL('../../../migrations/', import.meta.url);
const ROUTE_DIRS = ['../routes/', '../middleware/', '../lib/', '../services/'];

Deno.test(
  'audit catalogue: the SQL view lists exactly the TS catalogue, with the same areas',
  async () => {
    let latest = '';
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS)) {
      if (entry.isFile) names.push(entry.name);
    }
    for (const name of names.sort()) {
      const text = await Deno.readTextFile(new URL(name, MIGRATIONS));
      const at = text.lastIndexOf('view private.audit_action_catalogue as');
      if (at >= 0) latest = text.slice(at, text.indexOf(';', at));
    }
    const rows = [
      ...latest.matchAll(/\(\s*'([a-z_.]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z]+)'\s*\)/g),
    ].map((m) => `${m[1] ?? ''}:${m[2] ?? ''}`);
    assertEquals(
      rows,
      admin.AUDIT_ACTION_CATALOGUE.map((a) => `${a.action}:${a.area}`),
    );
    assertEquals(new Set(admin.AUDIT_ACTIONS).size, admin.AUDIT_ACTIONS.length);
  },
);

Deno.test('audit catalogue: every admin-api emitter uses a catalogue action', async () => {
  const found: string[] = [];
  for (const dir of ROUTE_DIRS) {
    const base = new URL(dir, import.meta.url);
    for await (const entry of Deno.readDir(base)) {
      if (!entry.isFile || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      const text = await Deno.readTextFile(new URL(entry.name, base));
      for (const m of text.matchAll(/\b(?:action|p_action):\s*([^,\n]+)/g)) {
        for (const lit of (m[1] ?? '').matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) {
          found.push(lit[1] ?? '');
        }
      }
      for (const m of text.matchAll(/const action = ([^;]+);/g)) {
        for (const lit of (m[1] ?? '').matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) {
          found.push(lit[1] ?? '');
        }
      }
    }
  }
  assert(found.length >= 10, `emitters found: ${found.join(', ')}`);
  assertEquals(
    found.filter((a) => !admin.isCatalogueAction(a)),
    [],
  );
});
