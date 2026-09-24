import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../run.ts';

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

test('flags work markers and banned copy in product code', () => {
  const root = repo({
    'apps/mobile/src/a.ts': `// ${MARK}: wire this\nexport const x = 1;\n`,
    'packages/i18n/messages/tr/common.json': '{ "soon": "Çok yakında" }\n',
    'apps/web/src/b.tsx': 'export const c = "Kredi kartı gerekmez";\n',
  });
  const rules = scan(root).map((f) => f.file);
  assert.deepEqual(rules.sort(), [
    'apps/mobile/src/a.ts',
    'apps/web/src/b.tsx',
    'packages/i18n/messages/tr/common.json',
  ]);
});

test('ignores placeholder props and negated unlimited copy', () => {
  const root = repo({
    'apps/mobile/src/c.tsx': '<TextInput placeholder={t("q")} placeholderTextColor={c} />\n',
    'apps/web/src/d.css': 'input::placeholder { color: var(--ink-3); }\n',
    'packages/i18n/messages/en/paywall.json': '{ "fair": "Fair use — not unlimited" }\n',
  });
  assert.deepEqual(scan(root), []);
});

test('flags positive unlimited claims', () => {
  const root = repo({
    'packages/i18n/messages/tr/paywall.json': '{ "x": "Sınırsız AI analiz" }\n',
  });
  assert.equal(scan(root).length, 1);
});

test('clean repository passes', () => {
  const root = repo({ 'apps/mobile/src/ok.ts': 'export const ok = true;\n' });
  assert.deepEqual(scan(root), []);
});

test('flags retired canonical names in product code only', () => {
  const root = repo({
    'supabase/migrations/0001.sql': 'embedding vector(1536) not null\n',
    'scripts/notes.ts': 'export const s = "get_today";\n',
  });
  const f = scan(root);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.file, 'supabase/migrations/0001.sql');
});
