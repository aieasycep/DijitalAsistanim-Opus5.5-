import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GITLEAKS_ASSETS, GITLEAKS_VERSION, assetFor, sha256, summarize } from '../secret-scan.ts';

test('every supported platform pins a release asset with a SHA-256', () => {
  for (const key of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']) {
    const entry = GITLEAKS_ASSETS[key];
    assert.ok(entry, key);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.asset.includes(GITLEAKS_VERSION));
  }
  assert.equal(
    assetFor('linux', 'x64').url,
    `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
  );
  assert.throws(() => assetFor('win32', 'x64'), /no pinned release asset/);
});

test('sha256 hashes the downloaded bytes', () => {
  assert.equal(
    sha256(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('summaries name rule, file, line and commit, never a value', () => {
  assert.deepEqual(
    summarize([{ RuleID: 'jwt', File: 'a.ts', StartLine: 3, Commit: '0123456789abcdef0123' }]),
    ['a.ts:3  [jwt]  commit 0123456789ab'],
  );
});
