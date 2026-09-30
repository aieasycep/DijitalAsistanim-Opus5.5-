import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKS, scan, selfTest } from '../run.ts';
import { eslintRuleProblem } from '../lib.ts';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'qg-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const MARK = ['TO', 'DO'].join('');

async function ids(files: Record<string, string>): Promise<string[]> {
  return (await scan(repo(files))).map((f) => `${f.id} ${f.file}`);
}

test('self-test: every check ID has a fixture with exactly one finding of that ID', async () => {
  const results = await selfTest();
  assert.equal(results.length, CHECKS.flatMap((c) => c.ids).length);
  for (const r of results) assert.ok(r.ok, `${r.id}: ${JSON.stringify(r.findings)}`);
});

test('flags work markers and banned copy in product code', async () => {
  assert.deepEqual(
    (
      await ids({
        'apps/mobile/src/a.ts': `// ${MARK}: wire this\nexport const x = 1;\n`,
        'packages/i18n/messages/tr/common.json': '{ "soon": "Çok yakında" }\n',
        'apps/web/src/b.tsx': 'export const c = "Kredi kartı gerekmez";\n',
      })
    ).sort(),
    [
      'QG-01 apps/mobile/src/a.ts',
      'QG-04 packages/i18n/messages/tr/common.json',
      'QG-06 apps/web/src/b.tsx',
    ],
  );
});

test('ignores placeholder props, comments about placeholders and negated unlimited copy', async () => {
  assert.deepEqual(
    await ids({
      'apps/mobile/src/c.tsx':
        '// The {{name}} placeholders of a template.\n<TextInput placeholder={t("q")} placeholderTextColor={c} />\n',
      'apps/web/src/d.css': 'input::placeholder { color: var(--ink-3); }\n',
      'packages/i18n/messages/en/paywall.json': '{ "fair": "Fair use — not unlimited" }\n',
      'apps/mobile/modules/x/android/src/X.kt':
        'val placeholder = redactionPlaceholder ?: return false\n',
    }),
    [],
  );
});

test('native module sources are scanned; only the prebuild outputs are skipped', async () => {
  assert.deepEqual(
    await ids({
      'apps/mobile/modules/x/android/src/X.kt': `// ${MARK} remove\n`,
      'apps/mobile/android/app/src/Y.kt': `// ${MARK} generated\n`,
    }),
    ['QG-01 apps/mobile/modules/x/android/src/X.kt'],
  );
});

test('a lowercase URL path segment is not a work marker', async () => {
  assert.deepEqual(
    await ids({ 'supabase/functions/p/tasks.ts': "const url = '/me/todo/lists/';\n" }),
    [],
  );
});

test('flags deferral comments but not "later" in copy', async () => {
  assert.deepEqual(
    await ids({
      'supabase/functions/a.ts': '// Later tasks add the handlers.\nconst copy = "Daha sonra";\n',
    }),
    ['QG-01b supabase/functions/a.ts'],
  );
});

test('flags retired canonical names in product code only', async () => {
  assert.deepEqual(
    await ids({
      'supabase/migrations/0001.sql': 'embedding vector(1536) not null\n',
      'scripts/notes.ts': 'export const s = "get_today";\n',
    }),
    ['QG-27 supabase/migrations/0001.sql'],
  );
});

test('QG-16: dead hrefs and unreachable routes', async () => {
  assert.deepEqual(
    (
      await ids({
        'apps/mobile/app/index.tsx':
          "router.push('/mail/abc?x=1'); router.push(`/person/${id}`);\n",
        'apps/mobile/app/mail/[id].tsx': 'export default null;\n',
        'apps/mobile/app/person/[id].tsx': 'export default null;\n',
        'apps/mobile/app/(tabs)/today/index.tsx': 'export default null;\n',
        'apps/mobile/src/x.tsx': 'export const l = <Link href="/nowhere" />;\n',
      })
    ).sort(),
    ['QG-16 apps/mobile/src/x.tsx'],
  );
});

test('QG-13: demo code only through the gated entry points', async () => {
  const f = await ids({
    'supabase/functions/api/a.ts':
      "import { assertDemoAllowed } from '../_shared/providers/demo/guard.ts';\n",
    'supabase/functions/api/b.ts':
      "import { DemoMailAdapter } from '../_shared/providers/demo/mail.ts';\n",
    'supabase/functions/_shared/ai/f.ts':
      "import x from './fixtures/a.json' with { type: 'json' };\nexport const on = (r: object) => isDemoEnabled(r);\n",
  });
  assert.deepEqual(f, ['QG-13 supabase/functions/api/b.ts']);
});

test('I18N-01: literal, wrapper-prefixed and template keys', async () => {
  const files = {
    'packages/i18n/messages/tr/approvals.json':
      '{ "summary": { "ok": "Tamam" }, "why": { "a": "A", "b": "B" } }\n',
    'packages/i18n/messages/en/approvals.json':
      '{ "summary": { "ok": "OK" }, "why": { "a": "A", "b": "B" } }\n',
    'supabase/functions/x.ts': [
      'function t(ctx: C, key: string): string {',
      '  return translate(ctx.locale, `approvals.${key}`);',
      '}',
      "t(ctx, 'summary.ok');",
      "t(ctx, 'summary.gone');",
      't(ctx, `why.${origin}`);',
      't(ctx, `nope.${origin}`);',
      '',
    ].join('\n'),
  };
  const out = (await scan(repo(files))).map((f) => f.match);
  assert.deepEqual(out.sort(), [
    'approvals.nope.* is missing from tr and en',
    'approvals.summary.gone is missing from tr and en',
  ]);
});

test('eslintRuleProblem: off only in test-scoped blocks', () => {
  const ok = `[{ files: ['**/*.tsx'], rules: { 'r/x': 'error' } }, {\n  // tests\n  files: ['test/**/*.{ts,tsx}'],\n  rules: { 'r/x': 'off' },\n}]`;
  assert.equal(eslintRuleProblem(ok, 'r/x', true), null);
  const bad = `[{ rules: { 'r/x': 'error' } }, { files: ['src/**'], rules: { 'r/x': 'off' } }]`;
  assert.notEqual(eslintRuleProblem(bad, 'r/x', true), null);
  assert.equal(eslintRuleProblem(`{ rules: { 'r/x': 'warn' } }`, 'r/x', true), "'r/x': 'warn'");
});

test('clean repository passes', async () => {
  assert.deepEqual(await scan(repo({ 'apps/mobile/src/ok.ts': 'export const ok = true;\n' })), []);
});
