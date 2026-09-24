/**
 * Test-only parsers for the admin role × permission matrix as it appears in the plan documents
 * (Markdown tables) and in migration 0012 (`insert into private.admin_role_permissions … values`).
 */
import { ADMIN_ROLE_VALUES, type AdminRole } from '../../src/enums.ts';
import { markdownSection, markdownTable } from './doc-sources.ts';

export type RoleMatrix = Map<AdminRole, Set<string>>;

const PERMISSION_TOKEN = /[a-z_]+(?:\.[a-z_]+){1,2}/g;
const BACKOFFICE_ROLE_COLUMNS: Readonly<Record<string, AdminRole>> = {
  SA: 'super_admin',
  OP: 'operations',
  SU: 'support',
  FI: 'finance',
  AI: 'ai_ops',
  AN: 'analyst',
  RO: 'readonly',
};

function emptyMatrix(): RoleMatrix {
  return new Map(ADMIN_ROLE_VALUES.map((role) => [role, new Set<string>()]));
}

function roleForHeader(header: string): AdminRole | null {
  const direct = ADMIN_ROLE_VALUES.find((role) => role === header);
  return direct ?? BACKOFFICE_ROLE_COLUMNS[header] ?? null;
}

/** Parses a "| Permission | <role columns> |" table in the given Markdown section. */
export function parseMatrixTable(markdown: string, heading: RegExp): RoleMatrix {
  const section = markdownSection(markdown, heading);
  const rows = markdownTable(section, (cells) => cells[0] === 'Permission' && cells.length === 8);
  const header = rows[0] ?? [];
  const roles = header.slice(1).map((cell) => {
    const role = roleForHeader(cell);
    if (role === null) throw new Error(`unknown role column: ${cell}`);
    return role;
  });
  const matrix = emptyMatrix();
  for (const row of rows.slice(1)) {
    const permissions = (row[0] ?? '').match(PERMISSION_TOKEN) ?? [];
    if (permissions.length === 0) throw new Error(`no permission in row: ${row.join(' | ')}`);
    roles.forEach((role, index) => {
      if ((row[index + 1] ?? '').includes('✓')) {
        for (const permission of permissions) matrix.get(role)?.add(permission);
      }
    });
  }
  return matrix;
}

const SEED_STATEMENT = /insert\s+into\s+private\.admin_role_permissions\b[\s\S]*?;/gi;
const SEED_TUPLE = /\(\s*'([a-z_]+)'(?:::[a-z_.]+)?\s*,\s*'([a-z_.]+)'(?:::text)?\s*\)/g;

/**
 * Extracts `(role, permission)` tuples from every `insert into private.admin_role_permissions`
 * statement in the SQL. Throws when there is no such statement or it holds no tuple, so a seed
 * written in a form this parser does not understand fails loudly instead of passing silently.
 */
export function parseSeedSql(sql: string): RoleMatrix {
  const statements = sql.match(SEED_STATEMENT) ?? [];
  if (statements.length === 0) {
    throw new Error('no `insert into private.admin_role_permissions` statement found');
  }
  const matrix = emptyMatrix();
  let tuples = 0;
  for (const statement of statements) {
    for (const match of statement.matchAll(SEED_TUPLE)) {
      const role = roleForHeader(match[1] ?? '');
      if (role === null) throw new Error(`unknown role in seed: ${match[1] ?? ''}`);
      matrix.get(role)?.add(match[2] ?? '');
      tuples++;
    }
  }
  if (tuples === 0)
    throw new Error('the admin_role_permissions seed contains no (role, permission) tuple');
  return matrix;
}

export interface MatrixDifference {
  role: AdminRole;
  permission: string;
  /** `extra`: granted by the compared source but not by rbac.ts; `missing`: the reverse. */
  kind: 'extra' | 'missing';
}

export function diffMatrices(
  expected: Readonly<Record<AdminRole, readonly string[]>>,
  actual: RoleMatrix,
): MatrixDifference[] {
  const out: MatrixDifference[] = [];
  for (const role of ADMIN_ROLE_VALUES) {
    const want = new Set(expected[role]);
    const got = actual.get(role) ?? new Set<string>();
    for (const permission of got)
      if (!want.has(permission)) out.push({ role, permission, kind: 'extra' });
    for (const permission of want)
      if (!got.has(permission)) out.push({ role, permission, kind: 'missing' });
  }
  return out;
}
