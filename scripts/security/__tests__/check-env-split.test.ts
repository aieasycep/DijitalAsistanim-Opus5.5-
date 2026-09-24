import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkClientKeys,
  checkEnvExample,
  checkHeaders,
  objectBlock,
  REQUIRED_HEADERS,
  runChecks,
  serverNamesIn,
} from '../check-env-split.ts';
import { scanDirectories } from '../scan-bundles.ts';

const PEM = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');

test('.env.example: a public key tagged SERVER-ONLY and untagged keys are findings', () => {
  const example = [
    '# SERVER-ONLY',
    'NEXT_PUBLIC_API_URL=',
    '# client-safe',
    'EXPO_PUBLIC_APP_ENV=',
    'LOOSE_KEY=',
  ].join('\n');
  assert.deepEqual(
    checkEnvExample(example).map((f) => `${f.rule}:${f.detail}`),
    ['public-key-tagged-server-only:NEXT_PUBLIC_API_URL', 'untagged-key:LOOSE_KEY'],
  );
});

test('client schemas and client code may not name a server-only key; comments are ignored', () => {
  assert.deepEqual(
    checkClientKeys(
      'schema',
      ['NEXT_PUBLIC_SUPABASE_URL', 'ADMIN_BFF_SECRET'],
      ['ADMIN_BFF_SECRET'],
    ).map((f) => f.detail),
    ['ADMIN_BFF_SECRET'],
  );
  const code = [
    '// verified with TURNSTILE_SECRET_KEY on the server',
    '/* HASH_PEPPER never reaches the browser */',
    "const url = 'https://example.com'; const k = process.env.HASH_PEPPER;",
  ].join('\n');
  assert.deepEqual(serverNamesIn(code, ['TURNSTILE_SECRET_KEY', 'HASH_PEPPER']), ['HASH_PEPPER']);
  assert.deepEqual(serverNamesIn('NEXT_PUBLIC_SUPABASE_URL', ['SUPABASE_URL']), []);
});

test('objectBlock extracts one brace-balanced object literal', () => {
  const text =
    'const SERVER_SHAPE = { A: 1 };\nconst CLIENT_SHAPE = {\n  B: z.object({ c: 1 }),\n};\n';
  assert.equal(
    objectBlock(text, 'CLIENT_SHAPE'),
    'const CLIENT_SHAPE = {\n  B: z.object({ c: 1 }),\n}',
  );
});

test('security headers: every CTL-3.18 header must be set, X-Frame-Options must be DENY', () => {
  const complete = [
    ...REQUIRED_HEADERS.backoffice.map((h) => `'${h}': 'x',`),
    "'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff'",
  ].join('\n');
  assert.deepEqual(checkHeaders('backoffice', [complete]), []);
  const missing = checkHeaders('web', ["{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }"]);
  assert.ok(missing.some((f) => f.detail === 'Strict-Transport-Security'));
  assert.ok(missing.some((f) => f.detail === 'X-Frame-Options DENY'));
});

test('the repository passes the env split and header audit', async () => {
  assert.deepEqual(await runChecks(), []);
});

test('server output: names are not flagged there, secret-shaped values are', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-server-'));
  const server = join(root, 'server', 'app');
  mkdirSync(server, { recursive: true });
  writeFileSync(join(server, 'page.js'), 'const s = process.env.ADMIN_BFF_SECRET;');
  writeFileSync(join(server, 'index.html'), '<p>Missing: API_PUBLIC_BASE_URL</p>');
  writeFileSync(join(server, 'route.js'), `const k = "${PEM}";`);
  const result = scanDirectories([], ['ADMIN_BFF_SECRET', 'API_PUBLIC_BASE_URL'], [server]);
  assert.equal(result.files, 3);
  assert.deepEqual(
    result.findings.map((f) => `${f.file.split('/').at(-1) ?? ''}:${f.rule}`),
    ['route.js:private-key'],
  );
});
