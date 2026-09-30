import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEnums } from './enum-parity.ts';

test('identical enums produce no difference', () => {
  assert.deepEqual(
    compareEnums({ platform: ['ios', 'android'] }, { platform: ['ios', 'android'] }),
    [],
  );
});

test('a reordered value, a domain-only enum and a database-only enum are all reported', () => {
  const problems = compareEnums(
    { platform: ['android', 'ios'], only_db: ['x'] },
    { platform: ['ios', 'android'], only_domain: ['y'] },
  );
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /enum platform: database \[android, ios\]/);
  assert.match(problems.join('\n'), /only_domain: in @da\/domain DB_ENUMS but missing/);
  assert.match(problems.join('\n'), /only_db: in the database but missing/);
});
