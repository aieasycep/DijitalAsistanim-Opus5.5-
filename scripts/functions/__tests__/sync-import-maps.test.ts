/**
 * CodeQL js/file-system-race at sync-import-maps.ts:109 (security-nightly, TST-CI-08): the current
 * config is read once with ENOENT handled instead of an `existsSync` check before read and write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIfExists } from '../sync-import-maps.ts';

test('CodeQL js/file-system-race: readIfExists reads a file once and maps ENOENT to null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fn-maps-'));
  const file = join(dir, 'deno.json');
  assert.equal(readIfExists(file), null);
  writeFileSync(file, '{"imports":{}}\n');
  assert.equal(readIfExists(file), '{"imports":{}}\n');
  assert.throws(
    () => readIfExists(dir),
    (error: NodeJS.ErrnoException) => error.code === 'EISDIR',
  );
});
