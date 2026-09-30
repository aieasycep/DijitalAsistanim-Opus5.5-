/**
 * Backoffice RBAC reference generator (IMPLEMENTATION_PLAN T-12.09; BACKOFFICE_PLAN §4).
 *
 * Renders the generated part of `docs/BACKOFFICE_RBAC.md` from the sources of truth, so the
 * document cannot drift from the code:
 * - roles, the permission catalogue and the role × permission matrix: `ADMIN_ROLE_VALUES`
 *   (`packages/domain/src/enums.ts`), `PERMISSIONS`, `ROLE_PERMISSIONS` and `permissionKind`
 *   (`packages/domain/src/rbac.ts`);
 * - the admin-api route guard of every route: `adminRoutes`
 *   (`packages/validation/src/admin/routes.ts`), the registry `admin-api` mounts.
 *
 * Only the block between `BEGIN_MARKER` and `END_MARKER` is generated; the rest of the document is
 * written by hand.
 *
 * Usage: node scripts/docs/gen-rbac.ts [--check]   (--check fails on drift)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADMIN_ROLE_VALUES, type AdminRole } from '../../packages/domain/src/enums.ts';
import { PERMISSIONS, ROLE_PERMISSIONS, permissionKind } from '../../packages/domain/src/rbac.ts';
import { adminRoutes } from '../../packages/validation/src/admin/routes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOC = join(ROOT, 'docs', 'BACKOFFICE_RBAC.md');

export const BEGIN_MARKER =
  '<!-- BEGIN GENERATED: node scripts/docs/gen-rbac.ts (edit the sources, then regenerate) -->';
export const END_MARKER = '<!-- END GENERATED: gen-rbac -->';

/** Column codes of BACKOFFICE_PLAN §4.2. */
export const ROLE_CODES: Readonly<Record<AdminRole, string>> = {
  super_admin: 'SA',
  operations: 'OP',
  support: 'SU',
  finance: 'FI',
  ai_ops: 'AI',
  analyst: 'AN',
  readonly: 'RO',
};

const YES = '✓';
const NO = '—';

/** The guard fields of one registry route (`AdminAccess`). */
export interface RouteAccess {
  readonly require: string;
  readonly also?: readonly string[];
  readonly or?: readonly string[];
  readonly step_up?: boolean;
}

export interface RouteEntry {
  readonly key: string;
  readonly id: string;
  readonly access: RouteAccess;
  readonly audit?: string;
}

const CLASS_LABELS: Readonly<Record<string, string>> = {
  bff: 'BFF key only (pre-sign-in)',
  aal1: 'admin JWT at `aal1` (MFA not done yet)',
  own: 'any active admin, own account',
  any_admin: 'any active admin',
};

const code = (value: string): string => `\`${value}\``;

/** Human-readable guard of a route: its permission (or access class) plus `or` / `also`. */
export function describeAccess(access: RouteAccess): string {
  const primary = CLASS_LABELS[access.require] ?? code(access.require);
  const parts = [primary];
  if (access.or !== undefined && access.or.length > 0) {
    parts.push(`or ${access.or.map(code).join(', ')}`);
  }
  if (access.also !== undefined && access.also.length > 0) {
    parts.push(`and ${access.also.map(code).join(', ')}`);
  }
  return parts.join(' ');
}

/** Every registry route in registry order. */
export function routeEntries(): RouteEntry[] {
  return Object.entries(adminRoutes).map(([key, contract]) => ({
    key,
    id: contract.id,
    access: contract.access,
    ...(contract.audit === undefined ? {} : { audit: contract.audit }),
  }));
}

function roleTable(): string[] {
  const lines = ['| Code | Role | Permissions held |', '| --- | --- | --- |'];
  for (const role of ADMIN_ROLE_VALUES) {
    lines.push(
      `| ${ROLE_CODES[role]} | ${code(role)} | ${String(ROLE_PERMISSIONS[role].length)} of ${String(PERMISSIONS.length)} |`,
    );
  }
  return lines;
}

function matrixTable(): string[] {
  const header = ['Permission', 'Kind', ...ADMIN_ROLE_VALUES.map((role) => ROLE_CODES[role])];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const permission of PERMISSIONS) {
    const cells = ADMIN_ROLE_VALUES.map((role) =>
      ROLE_PERMISSIONS[role].includes(permission) ? YES : NO,
    );
    lines.push(`| ${code(permission)} | ${permissionKind(permission)} | ${cells.join(' | ')} |`);
  }
  return lines;
}

function routeTable(routes: readonly RouteEntry[]): string[] {
  const lines = [
    '| Route | Contract | Guard | Step-up | Audit action |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const route of routes) {
    lines.push(
      `| ${code(route.key)} | ${route.id} | ${describeAccess(route.access)} | ${route.access.step_up === true ? YES : NO} | ${route.audit === undefined ? NO : code(route.audit)} |`,
    );
  }
  return lines;
}

/** The generated block, markers included. */
export function renderGenerated(routes: readonly RouteEntry[] = routeEntries()): string {
  return [
    BEGIN_MARKER,
    '',
    '### Roles',
    '',
    ...roleTable(),
    '',
    '### Role × permission matrix',
    '',
    `${String(PERMISSIONS.length)} permissions × ${String(ADMIN_ROLE_VALUES.length)} roles. Kind: \`read\` views data (aggregates or masked rows), \`reveal\` unmasks content, \`mutation\` changes state or triggers a side effect.`,
    '',
    ...matrixTable(),
    '',
    '### admin-api route guards',
    '',
    `${String(routes.length)} routes, in registry order. "Guard" is the permission the route requires (\`or\`: any one of the listed permissions is enough; \`and\`: every listed permission is needed as well). "Step-up" means a TOTP re-check within the last 10 minutes.`,
    '',
    ...routeTable(routes),
    '',
    END_MARKER,
  ].join('\n');
}

/** Replaces the generated block of `document` (which must contain both markers exactly once). */
export function spliceGenerated(document: string, generated: string): string {
  const start = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('gen-rbac: the document must contain the BEGIN and END markers, in order');
  }
  if (
    document.slice(start + 1).includes(BEGIN_MARKER) ||
    document.slice(end + 1).includes(END_MARKER)
  ) {
    throw new Error('gen-rbac: the markers must appear exactly once');
  }
  return document.slice(0, start) + generated + document.slice(end + END_MARKER.length);
}

function main(): void {
  const check = process.argv.includes('--check');
  const current = readFileSync(DOC, 'utf8');
  const next = spliceGenerated(current, renderGenerated());
  if (check) {
    if (next !== current) {
      process.stderr.write('gen-rbac: drift — run `node scripts/docs/gen-rbac.ts`\n');
      process.exit(1);
    }
    process.stdout.write('gen-rbac: no drift\n');
    return;
  }
  if (next !== current) writeFileSync(DOC, next);
  process.stdout.write(`gen-rbac: ${next === current ? 'unchanged' : 'wrote'} ${DOC}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
