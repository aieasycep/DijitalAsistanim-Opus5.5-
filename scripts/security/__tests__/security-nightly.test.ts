import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllowlist, splitByExpiry } from '../allowlist.ts';
import { ALLOWLIST_PATH, advisoriesOf, describe, evaluate } from '../audit.ts';
import { evaluateSarif, findingsOf } from '../sarif-gate.ts';
import { alertsOf, DAST_ALLOWLIST_PATH, evaluateZap, ZAP_IMAGE } from '../zap.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOW = new Date('2026-09-28T08:00:00Z');
const entry = <T extends Record<string, string>>(over: T) => ({
  reason: 'Dev-only tool, never reachable from a deployed surface.',
  expires: '2026-12-28',
  ...over,
});

test('allow-lists: every field, a real date and an explanatory reason are required', () => {
  assert.throws(() => parseAllowlist({}, ['advisory'], 'audit'), /expected a JSON array/);
  assert.throws(
    () => parseAllowlist([{ advisory: 'GHSA-x' }], ['advisory'], 'audit'),
    /missing reason/,
  );
  assert.throws(
    () => parseAllowlist([entry({ advisory: 'GHSA-x', expires: '28.12.2026' })], ['advisory'], 'a'),
    /YYYY-MM-DD/,
  );
  assert.throws(
    () => parseAllowlist([entry({ advisory: 'GHSA-x', reason: 'dev' })], ['advisory'], 'a'),
    /must explain/,
  );
  const ok = parseAllowlist([entry({ advisory: 'GHSA-x' })], ['advisory'], 'audit');
  assert.equal(ok[0]?.advisory, 'GHSA-x');
  const { live, expired } = splitByExpiry(
    [entry({ id: 'a' }), entry({ id: 'b', expires: '2026-09-28' })],
    NOW,
  );
  assert.deepEqual(
    [live.map((e) => e.id), expired.map((e) => e.id)],
    [['a'], ['b']],
    'an entry stops applying at the start of its expiry day',
  );
});

test('TST-CI-03 audit: high/critical block unless allow-listed; expired entries block; unused reported', () => {
  const report = {
    advisories: {
      '1': {
        id: 1,
        github_advisory_id: 'GHSA-aaa',
        module_name: 'fastify',
        severity: 'high',
        title: 'DoS',
      },
      '2': {
        id: 2,
        github_advisory_id: 'GHSA-bbb',
        module_name: 'xmldom',
        severity: 'critical',
        title: 'RCE',
        patched_versions: '>=0.8.15',
      },
      '3': { id: 3, module_name: 'lodash', severity: 'moderate', title: 'Proto' },
    },
  };
  const advisories = advisoriesOf(report);
  assert.equal(advisories.length, 3);
  assert.deepEqual(advisoriesOf({}), []);
  const verdict = evaluate(
    advisories,
    [
      entry({ advisory: 'GHSA-aaa', package: 'fastify' }),
      entry({ advisory: 'GHSA-zzz', package: 'gone' }),
      entry({ advisory: '2', package: 'xmldom', expires: '2026-09-01' }),
    ] as never,
    NOW,
  );
  assert.deepEqual(
    verdict.allowed.map((a) => a.module_name),
    ['fastify'],
  );
  assert.deepEqual(
    verdict.blocking.map((a) => a.module_name),
    ['xmldom'],
    'the expired entry no longer excuses',
  );
  assert.deepEqual(
    verdict.expired.map((e) => e.package),
    ['xmldom'],
  );
  assert.deepEqual(
    verdict.unused.map((e) => e.package),
    ['gone'],
  );
  const critical = advisories[1];
  assert.ok(critical);
  assert.equal(describe(critical), 'critical xmldom GHSA-bbb: RCE (fixed in >=0.8.15)');
  // A matching id with another package name does not excuse.
  assert.equal(
    evaluate(advisories, [entry({ advisory: 'GHSA-aaa', package: 'other' })] as never, NOW).blocking
      .length,
    2,
  );
});

test('the committed allow-lists parse, and every audit exception is dated within 6 months', () => {
  const audit = parseAllowlist(
    JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as unknown,
    ['advisory', 'package'],
    'audit',
  );
  for (const e of audit) {
    const days = (Date.parse(`${e.expires}T00:00:00Z`) - NOW.getTime()) / 86_400_000;
    assert.ok(days <= 190, `${e.advisory} expires too far out (${e.expires})`);
  }
  parseAllowlist(
    JSON.parse(readFileSync(DAST_ALLOWLIST_PATH, 'utf8')) as unknown,
    ['plugin', 'target'],
    'dast',
  );
  parseAllowlist(
    JSON.parse(readFileSync(join(ROOT, 'security', 'sast-allowlist.json'), 'utf8')) as unknown,
    ['rule', 'path'],
    'sast',
  );
});

test('TST-CI-08 ZAP: only high-risk alerts block; allow-list per plugin and target', () => {
  const alerts = alertsOf({
    site: [
      {
        alerts: [
          { pluginid: '10038', alert: 'CSP header not set', riskcode: '2' },
          {
            pluginid: '40012',
            alert: 'Reflected XSS',
            riskcode: '3',
            instances: [{ uri: 'http://x/a' }],
          },
          { pluginid: '90022', alert: 'Application error disclosure', riskcode: '3' },
        ],
      },
      { alerts: 'not an array' },
    ],
  });
  assert.equal(alerts.length, 3);
  const verdict = evaluateZap(
    alerts,
    'web',
    [
      entry({ plugin: '90022', target: '*' }),
      entry({ plugin: '40012', target: 'backoffice' }),
    ] as never,
    NOW,
  );
  assert.deepEqual(
    verdict.blocking.map((a) => a.pluginid),
    ['40012'],
  );
  assert.deepEqual(
    verdict.allowed.map((a) => a.pluginid),
    ['90022'],
  );
  assert.match(
    verdict.summary,
    /blocking 40012 Reflected XSS \(1 instance\(s\), e\.g\. http:\/\/x\/a\)/,
  );
  assert.equal(evaluateZap([], 'web', [], NOW).summary, 'no high-risk alerts');
  assert.match(
    ZAP_IMAGE,
    /^ghcr\.io\/zaproxy\/zaproxy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
    'pinned by digest',
  );
});

test('TST-CI-08 CodeQL SARIF: results of rules at security-severity ≥ 7.0 block', () => {
  const sarif = {
    runs: [
      {
        tool: {
          driver: {
            rules: [{ id: 'js/sql-injection', properties: { 'security-severity': '8.8' } }],
          },
          extensions: [
            {
              rules: [
                { id: 'js/unused-local', properties: {} },
                { id: 'js/xss', properties: { 'security-severity': '6.1' } },
              ],
            },
          ],
        },
        results: [
          {
            ruleId: 'js/sql-injection',
            message: { text: 'q' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'supabase/functions/api/x.ts' },
                  region: { startLine: 4 },
                },
              },
            ],
          },
          { ruleId: 'js/xss', message: { text: 'x' } },
          { rule: { id: 'js/unused-local' } },
        ],
      },
    ],
  };
  const findings = findingsOf(sarif);
  assert.deepEqual(
    findings.map((f) => [f.rule, f.severity]),
    [
      ['js/sql-injection', 8.8],
      ['js/xss', 6.1],
      ['js/unused-local', 0],
    ],
  );
  assert.deepEqual(findingsOf(null), []);
  const blocked = evaluateSarif(findings, [], NOW);
  assert.deepEqual(
    blocked.blocking.map((f) => `${f.path}:${String(f.line)}`),
    ['supabase/functions/api/x.ts:4'],
  );
  const excused = evaluateSarif(
    findings,
    [entry({ rule: 'js/sql-injection', path: 'supabase/functions/api/*' })] as never,
    NOW,
  );
  assert.deepEqual([excused.blocking.length, excused.allowed.length], [0, 1]);
});
