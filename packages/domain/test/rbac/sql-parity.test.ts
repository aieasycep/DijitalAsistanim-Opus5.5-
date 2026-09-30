/**
 * UT-RBAC-01 / UT-RBAC-02: the TypeScript matrix (source of truth) against
 * 1. BACKOFFICE_PLAN §4.2 (authoritative for admin permissions, R-20) — exact equality;
 * 2. the SQL seed of `private.admin_role_permissions`:
 *    - when `supabase/migrations/*admin*` exists, its `insert into private.admin_role_permissions`
 *      statement must equal the TypeScript matrix exactly;
 *    - until then, the documented seed in DATABASE_AND_RLS_PLAN §4.9 is the assertion target, and
 *      it may differ only by the drift listed (and justified) in `DOCUMENTED_SEED_DRIFT`.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, renderAdminRolePermissionSeed } from '../../src/rbac.ts';
import { adminMigrationFiles, readRepoFile } from './doc-sources.ts';
import {
  diffMatrices,
  parseMatrixTable,
  parseSeedSql,
  type MatrixDifference,
} from './seed-parser.ts';

/**
 * DATABASE_AND_RLS_PLAN §4.9 marks `push.test` for `support`. BACKOFFICE_PLAN §4.2 (the source per
 * R-20), BACKOFFICE_PLAN §6.8 ("push test `push.test` (SA, OP)") and API_CONTRACTS ADM-07
 * ("support … get 403 on test-push (`push.test` is SA and OP only)") do not. rbac.ts follows
 * BACKOFFICE_PLAN; migration 0012 must be seeded from rbac.ts, not from the §4.9 table.
 */
const DOCUMENTED_SEED_DRIFT: readonly MatrixDifference[] = [
  { role: 'support', permission: 'push.test', kind: 'extra' },
];

const byKey = (d: MatrixDifference): string => `${d.role}:${d.permission}:${d.kind}`;

describe('RBAC parity with BACKOFFICE_PLAN §4.2', () => {
  it('the role × permission matrix equals ROLE_PERMISSIONS exactly', () => {
    const matrix = parseMatrixTable(readRepoFile('docs/BACKOFFICE_PLAN.md'), /^### 4\.2 /);
    expect(diffMatrices(ROLE_PERMISSIONS, matrix)).toEqual([]);
  });
});

describe('RBAC parity with the admin_role_permissions seed', () => {
  const migrations = adminMigrationFiles();

  if (migrations.length > 0) {
    it(`migration seed (${migrations.join(', ')}) equals ROLE_PERMISSIONS exactly`, () => {
      const sql = migrations.map((file) => readRepoFile(file)).join('\n');
      expect(diffMatrices(ROLE_PERMISSIONS, parseSeedSql(sql))).toEqual([]);
    });
  } else {
    it('no supabase/migrations/*admin* yet: the DATABASE_AND_RLS_PLAN §4.9 seed is the target', () => {
      expect(migrations).toEqual([]);
      const documented = parseMatrixTable(
        readRepoFile('docs/DATABASE_AND_RLS_PLAN.md'),
        /^### 4\.9 Admin/,
      );
      const diff = diffMatrices(ROLE_PERMISSIONS, documented).map(byKey).sort();
      expect(diff).toEqual(DOCUMENTED_SEED_DRIFT.map(byKey).sort());
    });
  }

  it('the generated seed statement round-trips through the migration parser', () => {
    const parsed = parseSeedSql(renderAdminRolePermissionSeed());
    expect(diffMatrices(ROLE_PERMISSIONS, parsed)).toEqual([]);
  });

  it('the migration parser refuses SQL without a seed statement', () => {
    expect(() => parseSeedSql('create table private.admin_role_permissions (role text);')).toThrow(
      /no `insert into private.admin_role_permissions`/,
    );
    expect(() =>
      parseSeedSql('insert into private.admin_role_permissions (role, permission) select 1;'),
    ).toThrow(/no \(role, permission\) tuple/);
  });
});
