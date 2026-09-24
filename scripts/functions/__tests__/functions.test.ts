import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFunctions } from '../check-guards.ts';
import {
  buildConfigs,
  FUNCTION_NAMES,
  FUNCTIONS_DIR,
  readBaseMap,
  rebaseTarget,
  syncImportMaps,
} from '../sync-import-maps.ts';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fn-guards-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const MODEL = ['claude', 'x-1'].join('-');

test('local import-map targets are rebased per directory; remote specifiers are kept', () => {
  const fnDir = join(FUNCTIONS_DIR, 'api');
  assert.equal(
    rebaseTarget('../../../packages/domain/src/index.ts', fnDir, FUNCTIONS_DIR),
    '../../packages/domain/src/index.ts',
  );
  assert.equal(
    rebaseTarget('../../../packages/i18n/messages/', fnDir, FUNCTIONS_DIR),
    '../../packages/i18n/messages/',
  );
  assert.equal(
    rebaseTarget('jsr:@hono/hono@4.13.8', fnDir, FUNCTIONS_DIR),
    'jsr:@hono/hono@4.13.8',
  );
});

test('every function gets a generated config with pinned versions; the workspace adds lint rules', () => {
  const configs = buildConfigs(readBaseMap());
  assert.equal(configs.size, FUNCTION_NAMES.length + 1);
  const workspace = configs.get(join(FUNCTIONS_DIR, 'deno.json')) as {
    imports: Record<string, string>;
    lint: unknown;
  };
  assert.ok(workspace.lint !== undefined);
  for (const target of Object.values(workspace.imports)) {
    if (target.startsWith('npm:') || target.startsWith('jsr:'))
      assert.match(target, /@\d+\.\d+\.\d+/);
  }
  assert.equal(workspace.imports['@supabase/supabase-js'], 'npm:@supabase/supabase-js@2.117.0');
});

test('the committed configs have no drift from the base map', async () => {
  assert.deepEqual(await syncImportMaps(true), []);
});

test('serviceClient outside the allow-list and model-ID literals are findings', () => {
  const root = tree({
    'api/routes/bad.ts': "import { serviceClient } from '../../_shared/db/clients.ts';\n",
    'api/routes/sneaky.ts': "import * as db from '../../_shared/db/clients.ts';\n",
    'api/repos/system/index.ts':
      "import { serviceClient } from '../../../_shared/db/clients.ts';\n",
    'worker/index.ts': "import { serviceClient, userClient } from '../_shared/db/clients.ts';\n",
    '_shared/ai/route.ts': `export const m = '${MODEL}';\n`,
    '_shared/ai/providers/anthropic.test.ts': `export const m = '${MODEL}';\n`,
  });
  const findings = scanFunctions(root).map((f) => `${f.file}:${f.rule}`);
  assert.deepEqual(findings.sort(), [
    '_shared/ai/route.ts:model-id-literal',
    'api/routes/bad.ts:service-client-import',
    'api/routes/sneaky.ts:service-client-import',
  ]);
});

test('the real functions tree is clean', () => {
  assert.deepEqual(scanFunctions(), []);
});
