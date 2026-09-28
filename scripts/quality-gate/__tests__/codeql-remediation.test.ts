/**
 * CodeQL findings in the quality gate (security-nightly, TST-CI-08):
 * - js/redos at lib.ts:246, the config-block header regex, now a comment/whitespace scanner;
 * - js/incomplete-sanitization at checks/i18n-keys.ts:309, `replace('*', v)` → `replaceAll`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { i18nKeys } from '../checks/i18n-keys.ts';
import { Context, eslintRuleProblem, skipTrivia } from '../lib.ts';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'qg-codeql-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/**
 * Growth-rate check rather than a wall-clock budget (fixed budgets fail on a loaded CI runner):
 * best of three at n / 4 and at n; a linear scan grows about 4×, the exponential original far
 * more. A run under 100 ms passes outright.
 */
function assertLinear(run: (n: number) => void, n = 50_000): void {
  const best = (size: number): number =>
    Math.min(
      ...[0, 1, 2].map(() => {
        const start = performance.now();
        run(size);
        return performance.now() - start;
      }),
    );
  const small = best(n / 4);
  const large = best(n);
  assert.ok(
    large < 100 || large < 8 * Math.max(small, 1),
    `${large.toFixed(1)} ms at n vs ${small.toFixed(1)} ms at n / 4`,
  );
}

test('CodeQL js/redos: lib.ts:246 a config block of "/*" + 50 000 × "*//*" is read quickly', () => {
  assertLinear((n) => {
    const source = `export default [{ /*${'*//*'.repeat(n)}*/ rules: { 'no-console': 'off' } }];`;
    assert.equal(eslintRuleProblem(source, 'no-console', false), "'no-console': 'off'");
  });
});

test('CodeQL js/redos: an unterminated comment run is read quickly and is not a files: block', () => {
  assertLinear((n) => {
    const source = `export default [{ /*${'*//*'.repeat(n)} rules: { 'no-console': 'off' } }];`;
    assert.equal(eslintRuleProblem(source, 'no-console', false), "'no-console': 'off'");
  });
});

test('test-only override blocks are still recognised after comments', () => {
  const source = [
    'export default [',
    "  { rules: { 'no-console': 'error' } },",
    '  {',
    '    // tests and scripts only',
    '    /* see TEST_PLAN §16 */',
    "    files: ['**/*.test.ts', 'scripts/**'],",
    "    rules: { 'no-console': 'off' },",
    '  },',
    '];',
  ].join('\n');
  assert.equal(eslintRuleProblem(source, 'no-console', true), null);
  const product = source.replace("files: ['**/*.test.ts', 'scripts/**']", "files: ['src/**']");
  assert.equal(eslintRuleProblem(product, 'no-console', true), "'no-console': 'off'");
});

test('skipTrivia skips whitespace and comments and rejects unterminated ones', () => {
  assert.equal(skipTrivia('{ // a\n /* b */ files: []', 1), 16);
  assert.equal(skipTrivia('{ /**/ /*x*/x', 1), 12);
  assert.equal(skipTrivia('{ // no newline', 1), -1);
  assert.equal(skipTrivia('{ /* open', 1), -1);
  assert.equal(skipTrivia('{files', 1), 1);
});

test('CodeQL js/incomplete-sanitization: i18n-keys.ts:309 expands declared template keys', async () => {
  const root = repo({
    'packages/domain/src/index.ts':
      "export const ANDROID_CHANNELS = [{ id: 'mail' }, { id: 'brief' }];\n",
    'packages/i18n/messages/tr/push.json': JSON.stringify({
      channels: { mail: { name: 'Posta' }, brief: { name: 'Brifing' } },
    }),
    'packages/i18n/messages/en/push.json': JSON.stringify({
      channels: { mail: { name: 'Mail' } },
    }),
    'supabase/functions/api/push.ts':
      'export const label = (id: string) => translate(`push.channels.${id}.name`);\n',
  });
  const findings = await i18nKeys.run(new Context(root));
  assert.deepEqual(
    findings.map((f) => f.match),
    ['push.channels.brief.name is missing from en'],
  );
});
