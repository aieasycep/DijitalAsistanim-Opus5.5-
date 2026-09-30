import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  loadPrompts,
  MIGRATION,
  MIGRATION_PART2,
  PART1_KEYS,
  parsePromptFile,
  renderParts,
  schemaHash,
} from '../gen-prompt-migration.ts';
import { PROMPT_KEY_VALUES } from '../../packages/validation/src/ai/index.ts';

test('prompt sources render the committed migrations (no drift)', () => {
  const prompts = loadPrompts();
  assert.equal(prompts.length, PROMPT_KEY_VALUES.length);
  assert.deepEqual(prompts.map((p) => p.prompt_key).sort(), [...PROMPT_KEY_VALUES].sort());
  const parts = renderParts(prompts);
  assert.deepEqual(
    parts.map((p) => p.file),
    [MIGRATION, MIGRATION_PART2],
  );
  for (const part of parts) assert.equal(part.sql, readFileSync(part.file, 'utf8'));
  assert.equal(PART1_KEYS.length, 9);
});

test('schema hashes are sha256 hex of the wire schema', () => {
  assert.match(schemaHash('EmailTriageV1'), /^[a-f0-9]{64}$/);
  assert.notEqual(schemaHash('EmailTriageV1'), schemaHash('ThreadSummaryV1'));
});

test('invalid sources are rejected', () => {
  const ok = [
    '---',
    'prompt_key: thread_summary',
    'version: 1',
    'output_schema_ref: ThreadSummaryV1',
    'model_role: reasoning',
    'changelog: x',
    '---',
    '',
    '# System',
    '',
    'Özetle.',
    '',
    '# User template',
    '',
    'Yaz.',
  ].join('\n');
  assert.equal(parsePromptFile(ok, 'thread_summary.md').system, 'Özetle.');
  assert.throws(() => parsePromptFile(ok, 'other.md'), /file name/);
  assert.throws(
    () => parsePromptFile(ok.replace('Özetle.', 'Use claude-x please.'), 'thread_summary.md'),
    /model identifiers/,
  );
  assert.throws(
    () => parsePromptFile(ok.replace('ThreadSummaryV1', 'NopeV9'), 'thread_summary.md'),
    /schema/,
  );
});
