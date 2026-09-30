import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectories, scanText, serverOnlyKeys } from '../scan-bundles.ts';

// Secret-shaped fixtures are assembled at runtime so no literal secret lives in the repository.
const SUPABASE_SECRET = ['sb', 'secret', 'Q2x0b3BzZWNyZXRrZXk0NTY3'].join('_');
const PEM = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');

function jwt(payload: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
}

test('reads SERVER-ONLY key names from .env.example tags', () => {
  const example = [
    '# client-safe',
    'NEXT_PUBLIC_SUPABASE_URL=',
    '# SERVER-ONLY',
    'ADMIN_BFF_SECRET=',
    '# SERVER-ONLY',
    'PII_LOOKUP_PEPPER=',
    '# build-time',
    'APP_ENV=development',
  ].join('\n');
  assert.deepEqual(serverOnlyKeys(example), ['ADMIN_BFF_SECRET', 'PII_LOOKUP_PEPPER']);
});

test('flags secret-shaped values and server-only names, never printing the value', () => {
  const text = `var a="${SUPABASE_SECRET}";var b="${PEM}";var c="ADMIN_BFF_SECRET";`;
  const findings = scanText(text, 'chunk.js', ['ADMIN_BFF_SECRET', 'SUPABASE_URL']);
  assert.deepEqual(findings.map((f) => f.rule).sort(), [
    'private-key',
    'server-only-name:ADMIN_BFF_SECRET',
    'supabase-secret-key',
  ]);
  for (const finding of findings) assert.ok(!finding.excerpt.includes(SUPABASE_SECRET));
});

test('flags a service-role JWT but not an anon one', () => {
  const service = scanText(`x="${jwt({ role: 'service_role' })}"`, 'a.js', []);
  const anon = scanText(`x="${jwt({ role: 'anon' })}"`, 'b.js', []);
  assert.deepEqual(
    service.map((f) => f.rule),
    ['service-role-jwt'],
  );
  assert.deepEqual(anon, []);
});

test('a public key name that merely contains a server name is not flagged', () => {
  const findings = scanText('process.env.NEXT_PUBLIC_SUPABASE_URL', 'c.js', ['SUPABASE_URL']);
  assert.deepEqual(findings, []);
});

test('scans directories and reports missing ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  mkdirSync(join(dir, 'chunks'));
  writeFileSync(join(dir, 'chunks', 'ok.js'), 'console.log("hello")');
  writeFileSync(join(dir, 'chunks', 'bad.js'), `const k="${SUPABASE_SECRET}"`);
  const result = scanDirectories([dir, join(dir, 'nope')], []);
  assert.equal(result.files, 2);
  assert.equal(result.findings.length, 1);
  assert.equal(result.missing.length, 1);
});
