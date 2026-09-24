/**
 * The `admin_api` catalogue against the migrations, and the route table's access rules
 * (TEST_PLAN UT-RBAC-03): every catalogued function exists with the catalogued arguments and is
 * listed in `private.admin_function_permissions`; every registry route declares exactly one primary
 * permission (or `own` / `any_admin` / `aal1` / BFF only).
 */
import { assert, assertEquals } from '@std/assert';
import { admin as adminSchemas, type AdminRouteContract, adminRoutes } from '@da/validation';
import { ADMIN_API_FN } from '../../_shared/db/admin-functions.ts';

const MIGRATIONS = new URL('../../../migrations/', import.meta.url);

async function migrationTexts(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map((name) => Deno.readTextFile(new URL(name, MIGRATIONS))));
}

const normalise = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();

/** The latest `create [or replace] function admin_api.<name>(args) returns <type>` per name. */
async function definedFunctions(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const re =
    /create (?:or replace )?function admin_api\.(\w+)\((.*?)\)\s*returns\s+(\w+(?:\[\])?)/gs;
  for (const text of await migrationTexts()) {
    for (const m of text.matchAll(re))
      out.set(m[1] ?? '', normalise(`(${m[2] ?? ''}) returns ${m[3] ?? ''}`));
  }
  return out;
}

/** Function names in the latest `private.admin_function_permissions` view. */
async function permissionMap(): Promise<Set<string>> {
  let latest = '';
  for (const text of await migrationTexts()) {
    const at = text.lastIndexOf('view private.admin_function_permissions as');
    if (at >= 0) latest = text.slice(at, text.indexOf(';', at));
  }
  return new Set([...latest.matchAll(/\(\s*'([a-z_]+)'\s*,/g)].map((m) => m[1] ?? ''));
}

Deno.test('catalogue: every admin_api function exists with the catalogued arguments', async () => {
  const defined = await definedFunctions();
  const mismatched: string[] = [];
  for (const [name, fn] of Object.entries(ADMIN_API_FN)) {
    assertEquals(fn.name, name);
    assertEquals(fn.schema, 'admin_api');
    const actual = defined.get(name);
    if (actual === undefined || actual !== normalise(fn.signature))
      mismatched.push(`${name}: ${actual ?? 'missing'}`);
  }
  assertEquals(mismatched, []);
});

Deno.test(
  'catalogue: every admin_api function has a guard row in admin_function_permissions',
  async () => {
    const mapped = await permissionMap();
    assert(mapped.size > 100);
    assertEquals(
      Object.keys(ADMIN_API_FN).filter((name) => !mapped.has(name)),
      [],
    );
  },
);

Deno.test('UT-RBAC-03: every admin route declares exactly one permission, own or BFF only', () => {
  const permissions = new Set<string>(adminSchemas.ADMIN_PERMISSION_VALUES);
  const classes = new Set(['own', 'any_admin', 'aal1', 'bff']);
  const bad: string[] = [];
  for (const [key, value] of Object.entries(adminRoutes)) {
    const access = (value as AdminRouteContract).access;
    if (typeof access.require !== 'string') bad.push(`${key}: no primary permission`);
    else if (!classes.has(access.require) && !permissions.has(access.require))
      bad.push(`${key}: ${access.require}`);
    for (const extra of [...(access.also ?? []), ...(access.or ?? [])]) {
      if (!permissions.has(extra)) bad.push(`${key}: ${extra}`);
    }
    if (
      classes.has(access.require) &&
      ((access.also ?? []).length > 0 || (access.or ?? []).length > 0)
    ) {
      bad.push(`${key}: own/BFF routes carry no module permission`);
    }
  }
  assertEquals(bad, []);
  const bff = Object.entries(adminRoutes)
    .filter(([, v]) => (v as AdminRouteContract).access.require === 'bff')
    .map(([k]) => k)
    .sort();
  assertEquals(bff, ['POST /auth/attempt', 'POST /auth/invite/redeem', 'POST /auth/preflight']);
});
