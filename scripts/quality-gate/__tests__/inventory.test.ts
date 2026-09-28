/**
 * QG-16b No-Dead-Action inventory ↔ mobile route files (DELIVERY_CHECKLIST §4.1, T-12.07): route
 * coverage by Target path or screen ID (SCREEN_AND_FLOW_MAP and the route-screens map), Target
 * resolution (route file, api route or suffix, M-GL-07 link prefix), map-entry validation, Expo
 * group precision, and the repository itself being clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../run.ts';
import {
  inventoryCheck,
  inventoryRows,
  routeGroup,
  routeSegments,
  screenIds,
  screenRoutes,
  targetTokens,
} from '../checks/inventory.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'qg-inventory-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const row = (id: string, target: string) => `| ${id} | Element | tap | ${target} | ok | t | ☐ |`;
function checklist(...rows: string[]): string {
  return [
    '### 4.2 Part 1',
    '',
    '| Screen | Element | Action | Target | Success state | Test ID | PASS/FAIL |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '### 4.6 Part 5',
    '',
  ].join('\n');
}
const screen = (...rows: string[]) =>
  ['| ID | Name | Route | Presentation |', '|---|---|---|---|', ...rows, ''].join('\n');
const API = "export const r = {\n  'POST /integrations/:accountId/sync': {},\n};\n";

async function findings(files: Record<string, string>): Promise<string[]> {
  return (await scan(repo(files), [inventoryCheck])).map((f) => `${f.file}:${f.line} ${f.match}`);
}

test('parses screen IDs with ranges, route tokens and groups', () => {
  assert.deepEqual(screenIds('M-ON-01…04, M-SET-10…M-SET-12 and M-ON-05E'), [
    'M-ON-01',
    'M-ON-02',
    'M-ON-03',
    'M-ON-04',
    'M-SET-10',
    'M-SET-11',
    'M-SET-12',
    'M-ON-05E',
  ]);
  assert.deepEqual(routeSegments('mail/[id]/reply?tone={default_reply_tone}'), [
    'mail',
    ':p',
    'reply',
  ]);
  assert.deepEqual(routeSegments('app/(tabs)/today/index.tsx'), ['today']);
  assert.deepEqual(routeSegments('reminders/new…'), ['reminders', 'new']);
  assert.equal(routeSegments('ToastHost'), null);
  assert.equal(routeSegments('app/+native-intent.tsx'), null);
  assert.equal(routeSegments('/app/*'), null);
  assert.equal(routeGroup('(auth)/sign-in?mode=signin'), 'auth');
  assert.equal(routeGroup('app/(onboarding)/vip'), 'onboarding');
  assert.equal(routeGroup('/vip'), null);
  assert.deepEqual(
    targetTokens(
      '`POST /captures` → `/captures/:id/analyze`; `openBrowserAsync(terms/privacy)`; `mail/{id}`; `https://x.example/a`; `/r/{code}`',
    ).map((t) => [t.token, t.ref?.segments.join('/') ?? null]),
    [
      ['/captures/:id/analyze', 'captures/:id/analyze'],
      ['mail/{id}', 'mail/:p'],
      ['/r/{code}', null],
    ],
  );
});

test('reads §4.2–§4.5 rows with their line numbers and SCREEN_AND_FLOW_MAP routes', () => {
  const text = `intro\n${checklist(row('M-A-01…02', '`/x`'))}`;
  const rows = inventoryRows(text);
  assert.deepEqual(rows, [{ line: 6, ids: ['M-A-01', 'M-A-02'], target: '`/x`' }]);
  assert.equal(inventoryRows('no inventory here'), null);
  const pairs = screenRoutes(
    [
      screen('| M-A-01 | Home | `(tabs)/today/index` | tab |'),
      '### M-B-01 · Block',
      '',
      '- **Route** — `app/waiting.tsx`; param `focus`.',
      '',
      '### M-C-01 · Vertical',
      '',
      '| Field | Spec |',
      '|---|---|',
      '| Route | `app/settings/index` → `/settings` |',
    ].join('\n'),
  );
  assert.deepEqual(
    pairs.map((p) => `${p.id} ${p.route.group ?? '-'} /${p.route.segments.join('/')}`),
    ['M-A-01 tabs /today', 'M-B-01 - /waiting', 'M-C-01 - /settings', 'M-C-01 - /settings'],
  );
});

test('a route is covered by a Target path or by a screen ID with rows; otherwise a finding', async () => {
  const base = {
    'apps/mobile/app/_layout.tsx': 'export default null;\n',
    'apps/mobile/app/index.tsx': 'export default null;\n',
    'apps/mobile/app/waiting.tsx': 'export default null;\n',
    'apps/mobile/app/memory.tsx': 'export default null;\n',
    'packages/validation/src/api/routes.ts': API,
  };
  assert.deepEqual(
    await findings({
      ...base,
      'docs/DELIVERY_CHECKLIST.md': checklist(row('M-GL-02', '`/waiting`'), row('M-MEM-01', 'x')),
      'docs/SCREEN_AND_FLOW_MAP.md': screen(
        '| M-GL-02 | Launch | `app/index.tsx` | — |',
        '| M-MEM-01 | Memory | `memory` | stack |',
      ),
    }),
    [],
  );
  assert.deepEqual(
    await findings({
      ...base,
      'docs/DELIVERY_CHECKLIST.md': checklist(row('M-GL-02', '`/sync` and `router.back()`')),
      'docs/SCREEN_AND_FLOW_MAP.md': screen(
        '| M-GL-02 | Launch | `app/index.tsx` | — |',
        '| M-MEM-01 | Memory | `memory` | stack |',
      ),
    }),
    [
      'apps/mobile/app/memory.tsx:1 /memory has no No-Dead-Action row (no Target path; no rows for M-MEM-01)',
      'apps/mobile/app/waiting.tsx:1 /waiting has no No-Dead-Action row (no Target path, no screen ID)',
    ],
  );
});

test('every Target path resolves to a route file, an api route (or suffix) or a link prefix', async () => {
  const out = await findings({
    'apps/mobile/app/index.tsx': 'export default null;\n',
    'apps/mobile/app/settings/index.tsx': 'export default null;\n',
    'packages/validation/src/api/routes.ts': API,
    'docs/SCREEN_AND_FLOW_MAP.md': screen('| M-GL-02 | Launch | `app/index.tsx` | — |'),
    'docs/DELIVERY_CHECKLIST.md': checklist(
      row('M-GL-02', '`settings/index` · `/integrations/:accountId/sync` · `/sync` · `/app/*`'),
      row('M-GL-02', '`settings/archive` · `/settings/gone` · `/devices/register`'),
      row('M-GL-02', '`GET /not/checked` · `mailto:` · `dijitalasistan://x/y`'),
    ),
  });
  assert.deepEqual(out, [
    'docs/DELIVERY_CHECKLIST.md:6 `settings/archive` → no route file, api route or link prefix',
    'docs/DELIVERY_CHECKLIST.md:6 `/settings/gone` → no route file, api route or link prefix',
    'docs/DELIVERY_CHECKLIST.md:6 `/devices/register` → no route file, api route or link prefix',
  ]);
});

test('Expo groups are precise: `(onboarding)/vip` does not cover `vip`', async () => {
  const out = await findings({
    'apps/mobile/app/index.tsx': 'export default null;\n',
    'apps/mobile/app/vip.tsx': 'export default null;\n',
    'apps/mobile/app/(onboarding)/vip.tsx': 'export default null;\n',
    'docs/SCREEN_AND_FLOW_MAP.md': screen('| M-GL-02 | Launch | `app/index.tsx` | — |'),
    'docs/DELIVERY_CHECKLIST.md': checklist(row('M-GL-02', '`(onboarding)/vip`')),
  });
  assert.deepEqual(out, [
    'apps/mobile/app/vip.tsx:1 /vip has no No-Dead-Action row (no Target path, no screen ID)',
  ]);
});

test('route-screens.map entries must name a route file, screen IDs with rows and a reason', async () => {
  const files = {
    'apps/mobile/app/index.tsx': 'export default null;\n',
    'apps/mobile/app/auth/callback.tsx': 'export default null;\n',
    'docs/SCREEN_AND_FLOW_MAP.md': screen('| M-GL-02 | Launch | `app/index.tsx` | — |'),
    'docs/DELIVERY_CHECKLIST.md': checklist(row('M-GL-02', 'x'), row('M-GL-07', 'y')),
  };
  assert.deepEqual(
    await findings({
      ...files,
      'scripts/quality-gate/route-screens.map':
        '# comment\napps/mobile/app/auth/callback.tsx | M-GL-07 | link target of M-GL-07\n',
    }),
    [],
  );
  assert.deepEqual(
    await findings({
      ...files,
      'scripts/quality-gate/route-screens.map': [
        'apps/mobile/app/auth/callback.tsx | M-GL-07 |',
        'apps/mobile/app/gone.tsx | M-GL-07 | removed screen',
        'apps/mobile/app/index.tsx | M-ZZ-01 | no rows',
        'apps/mobile/app/index.tsx | none | no IDs',
      ].join('\n'),
    }),
    [
      'scripts/quality-gate/route-screens.map:1 apps/mobile/app/auth/callback.tsx has no justification',
      'scripts/quality-gate/route-screens.map:2 apps/mobile/app/gone.tsx names no route file',
      'scripts/quality-gate/route-screens.map:3 apps/mobile/app/index.tsx screen ID without a §4 row: M-ZZ-01',
      'scripts/quality-gate/route-screens.map:4 apps/mobile/app/index.tsx names no screen ID',
    ],
  );
});

test('a repository without the §4 inventory is one finding', async () => {
  assert.deepEqual(
    await findings({
      'apps/mobile/app/index.tsx': 'export default null;\n',
      'docs/SCREEN_AND_FLOW_MAP.md': '# Map\n',
    }),
    ['docs/DELIVERY_CHECKLIST.md:1 No-Dead-Action inventory §4.2–§4.5 not found'],
  );
  assert.deepEqual(
    await findings({
      'apps/mobile/app/index.tsx': 'export default null;\n',
      'docs/DELIVERY_CHECKLIST.md': '# Delivery Checklist\n\n## 4. Inventory\n',
    }),
    ['docs/DELIVERY_CHECKLIST.md:1 No-Dead-Action inventory §4.2–§4.5 not found'],
  );
});

test('a partial tree without docs/ is not checked (like QG-26 without packages/domain)', async () => {
  assert.deepEqual(await findings({ 'apps/mobile/app/index.tsx': 'export default null;\n' }), []);
});

test('the repository inventory covers every mobile route and resolves every target', async () => {
  assert.deepEqual(await scan(ROOT, [inventoryCheck]), []);
});
