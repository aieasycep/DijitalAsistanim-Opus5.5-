import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ADMIN_ROLE_VALUES } from '../../../packages/domain/src/enums.ts';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../../packages/domain/src/rbac.ts';
import { adminRoutes } from '../../../packages/validation/src/admin/routes.ts';
import {
  BEGIN_MARKER,
  DOC,
  END_MARKER,
  ROLE_CODES,
  describeAccess,
  renderGenerated,
  routeEntries,
  spliceGenerated,
} from '../gen-rbac.ts';

describe('gen-rbac', () => {
  it('docs/BACKOFFICE_RBAC.md carries the current generated block (no drift)', () => {
    const current = readFileSync(DOC, 'utf8');
    assert.equal(spliceGenerated(current, renderGenerated()), current);
  });

  it('renders one matrix row per permission with a cell per role that matches ROLE_PERMISSIONS', () => {
    const lines = renderGenerated().split('\n');
    for (const permission of PERMISSIONS) {
      const row = lines.find((line) => line.startsWith(`| \`${permission}\` |`));
      assert.ok(row !== undefined, `missing row for ${permission}`);
      const cells = row
        .split('|')
        .slice(3, -1)
        .map((cell) => cell.trim());
      assert.equal(cells.length, ADMIN_ROLE_VALUES.length);
      ADMIN_ROLE_VALUES.forEach((role, index) => {
        const held = (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission);
        assert.equal(cells[index], held ? '✓' : '—', `${role} × ${permission}`);
      });
    }
  });

  it('lists every role code once and every admin-api route once', () => {
    const block = renderGenerated();
    for (const role of ADMIN_ROLE_VALUES) {
      assert.ok(block.includes(`| ${ROLE_CODES[role]} | \`${role}\` |`), role);
    }
    const routes = routeEntries();
    assert.equal(routes.length, Object.keys(adminRoutes).length);
    for (const route of routes) {
      const hits = block.split('\n').filter((line) => line.startsWith(`| \`${route.key}\` |`));
      assert.equal(hits.length, 1, route.key);
    }
  });

  it('describes guards by permission and access class', () => {
    assert.equal(describeAccess({ require: 'jobs.read' }), '`jobs.read`');
    assert.equal(
      describeAccess({ require: 'flags.write', or: ['flags.write_ai'] }),
      '`flags.write` or `flags.write_ai`',
    );
    assert.equal(
      describeAccess({ require: 'users.read', also: ['audit.read'] }),
      '`users.read` and `audit.read`',
    );
    assert.equal(describeAccess({ require: 'bff' }), 'BFF key only (pre-sign-in)');
  });

  it('replaces only the marked block and refuses documents without both markers', () => {
    const doc = `intro\n${BEGIN_MARKER}\nold\n${END_MARKER}\noutro\n`;
    assert.equal(
      spliceGenerated(doc, `${BEGIN_MARKER}\nnew\n${END_MARKER}`),
      `intro\n${BEGIN_MARKER}\nnew\n${END_MARKER}\noutro\n`,
    );
    assert.throws(() => spliceGenerated('no markers', 'x'), /markers/);
    assert.throws(
      () => spliceGenerated(`${BEGIN_MARKER}\n${END_MARKER}\n${BEGIN_MARKER}\n${END_MARKER}`, 'x'),
      /exactly once/,
    );
  });
});
