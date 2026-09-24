/**
 * Every `@da/validation` admin route (TEST_PLAN EF-ADM-01): for each registry key
 * - unauthorized: no admin JWT (BFF routes: no BFF key) → 401, and — for permissioned routes — an
 *   admin without the route permission → 403 `{permission}` with the denial audited through
 *   `audit_denied` and no module function called;
 * - bad input: the registry fixtures' invalid request parts (or a malformed body / path parameter)
 *   → 400/422 before any module function runs;
 * - success: the fixture's valid request against SQL-shaped stubs → the contract status, a
 *   response that parses with the registry schema (strict), `Cache-Control: no-store` and no
 *   contract-mismatch log.
 */
import { assert, assertEquals } from '@std/assert';
import { type AdminRouteKey, adminRoutes } from '@da/validation';
import { adminFixtures } from '../../../../packages/validation/test/fixtures/admin-fixtures.ts';
import type { RouteFixture } from '../../../../packages/validation/test/fixtures/types.ts';
import {
  ALL_PERMISSIONS,
  contractOf,
  createHarness,
  errorOf,
  fillPath,
  queryString,
} from './harness.ts';
import { ROUTE_CASES } from './route-cases.ts';
import { ADMIN_ROUTE_SPECS } from '../routes/index.ts';

const FIXTURES = adminFixtures as unknown as Record<AdminRouteKey, RouteFixture>;
const KEYS = Object.keys(adminRoutes) as AdminRouteKey[];
const CONTEXT_FNS = new Set(['admin_me', 'rate_limit_hit']);
const OWN_CLASSES = new Set(['own', 'any_admin', 'aal1', 'bff']);

type Req = {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

function validRequest(key: AdminRouteKey): Req {
  const valid = FIXTURES[key].valid as Record<string, unknown>;
  const override = ROUTE_CASES[key]?.request ?? {};
  return {
    params: (override.params ?? valid.params) as Record<string, unknown> | undefined,
    query: (override.query ?? valid.query) as Record<string, unknown> | undefined,
    body: override.body ?? valid.body,
    headers: (override.headers ?? valid.headers) as Record<string, string> | undefined,
  };
}

/** CT-04: keys no admin-api response may carry (BACKOFFICE_PLAN §13.2), found by a recursive scan. */
const DENY_KEYS = new Set([
  'token',
  'secret',
  'password',
  'body_html',
  'ciphertext',
  'subscriber_attributes',
  'access_token',
  'refresh_token',
  'ip_hash',
  'ua_hash',
  'api_key',
]);

function deniedKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => deniedKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(DENY_KEYS.has(k.toLowerCase()) ? [`${path}.${k}`] : []),
    ...deniedKeys(v, `${path}.${k}`),
  ]);
}

function send(
  h: Awaited<ReturnType<typeof createHarness>>,
  key: AdminRouteKey,
  req: Req,
  init: { auth?: boolean; bff?: boolean; rawBody?: string } = {},
) {
  const contract = contractOf(key);
  const path = fillPath(contract.path, req.params) + queryString(req.query);
  return h.request(contract.method, path, {
    ...(contract.request.body === undefined || req.body === undefined ? {} : { body: req.body }),
    ...(init.rawBody === undefined ? {} : { rawBody: init.rawBody }),
    ...(req.headers === undefined ? {} : { headers: req.headers }),
    ...(init.auth === false ? { auth: false } : {}),
    ...(init.bff === false ? { bff: false } : {}),
  });
}

function moduleCalls(h: Awaited<ReturnType<typeof createHarness>>): string[] {
  return h.rpcNames().filter((n) => !CONTEXT_FNS.has(n) && n !== 'audit_denied');
}

for (const key of KEYS) {
  const contract = contractOf(key);
  const routeCase = ROUTE_CASES[key] ?? {};

  Deno.test(`${key} · unauthorized`, async () => {
    const h = await createHarness();
    const req = validRequest(key);
    if (contract.access.require === 'bff') {
      const res = await send(h, key, req, { bff: false });
      const err = await errorOf(res);
      assertEquals(
        [err.status, err.code, err.details.reason],
        [401, 'AUTH_REQUIRED', 'bff_required'],
      );
    } else {
      const res = await send(h, key, req, { auth: false });
      const err = await errorOf(res);
      assertEquals(
        [err.status, err.code, err.details.reason],
        [401, 'AUTH_REQUIRED', 'missing_token'],
      );
    }
    assertEquals(h.rpc.length, 0);
  });

  if (!OWN_CLASSES.has(contract.access.require)) {
    Deno.test(`${key} · wrong permission is denied and audited`, async () => {
      const permission = contract.access.require;
      const h = await createHarness({
        permissions: ALL_PERMISSIONS.filter(
          (p) => p !== permission && !((contract.access.or ?? []) as readonly string[]).includes(p),
        ),
      });
      const res = await send(h, key, validRequest(key));
      const err = await errorOf(res);
      assertEquals([err.status, err.code, err.details.permission], [403, 'FORBIDDEN', permission]);
      const denial = h.rpc.find((r) => r.fn === 'audit_denied');
      assertEquals(denial?.args, { p_route: key, p_permission: permission });
      assertEquals(moduleCalls(h), []);
    });
  }

  const invalid = FIXTURES[key].invalid.filter((c) => c.part !== 'response');
  Deno.test(`${key} · bad input is rejected before the handler`, async () => {
    const h = await createHarness();
    const base = validRequest(key);
    const cases: { why: string; req: Req; rawBody?: string }[] = invalid.map((c) => ({
      why: c.why,
      req: { ...base, [c.part]: c.value },
    }));
    if (contract.request.body !== undefined)
      cases.push({ why: 'malformed JSON body', req: base, rawBody: '{"reason":' });
    if (contract.request.params !== undefined && invalid.every((c) => c.part !== 'params')) {
      const bad = Object.fromEntries(
        Object.keys(base.params ?? {}).map((k) => [k, 'not a valid id!'.repeat(20)]),
      );
      if (!contract.request.params.safeParse(bad).success)
        cases.push({ why: 'malformed path parameter', req: { ...base, params: bad } });
    }
    if (contract.request.query !== undefined && cases.length === 0) {
      const bad = { ...(base.query ?? {}), page_size: '30', range: '1y' };
      if (!contract.request.query.safeParse(bad).success)
        cases.push({ why: 'invalid query', req: { ...base, query: bad } });
    }
    if (cases.length === 0) {
      // No request input at all (e.g. `GET /me/sessions`): nothing a caller can send malformed.
      assertEquals(
        Object.keys(contract.request).filter(
          (p) => (contract.request as Record<string, unknown>)[p] !== undefined,
        ),
        [],
      );
      return;
    }
    for (const c of cases) {
      const before = h.rpc.length;
      const res = await send(h, key, c.req, c.rawBody === undefined ? {} : { rawBody: c.rawBody });
      const err = await errorOf(res);
      // An empty path segment cannot reach the route at all: the router answers 404.
      const emptySegment = Object.values(c.req.params ?? {}).some((v) => v === '');
      const accepted = emptySegment
        ? err.status === 404 && err.code === 'NOT_FOUND'
        : [400, 415, 422].includes(err.status) &&
          ['BAD_REQUEST', 'VALIDATION_FAILED', 'UNSUPPORTED_MEDIA_TYPE'].includes(err.code);
      assert(
        accepted,
        `${key} (${c.why}): expected a 400/422, got ${err.status} ${err.code} ${JSON.stringify(err.details)}`,
      );
      const called = h.rpc
        .slice(before)
        .map((r) => r.fn)
        .filter((n) => !CONTEXT_FNS.has(n));
      assertEquals(called, [], `${key} (${c.why}) reached the handler`);
    }
  });

  Deno.test(`${key} · success matches the contract`, async () => {
    const h = await createHarness({
      ...(routeCase.sql === undefined ? {} : { sql: routeCase.sql }),
      ...(routeCase.tables === undefined ? {} : { tables: routeCase.tables }),
      ...(routeCase.env === undefined ? {} : { env: routeCase.env }),
      ...(routeCase.outbound === undefined ? {} : { outbound: routeCase.outbound }),
    });
    const res = await send(h, key, validRequest(key));
    const text = await res.text();
    assertEquals(res.status, contract.status, `${key}: ${res.status} ${text.slice(0, 600)}`);
    const body = JSON.parse(text) as { data: unknown; meta: Record<string, unknown> };
    const parsed = contract.response.safeParse(body);
    assert(
      parsed.success,
      `${key}: response does not match the contract: ${JSON.stringify(parsed.error?.issues.slice(0, 5))}\n${text.slice(0, 800)}`,
    );
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
    assertEquals(deniedKeys(body), [], `${key}: deny-listed keys in the response (CT-04)`);
    assertEquals(h.missing, [], `${key}: unstubbed functions`);
    const mismatch = h.logs().filter((l) => l.msg === 'response_contract_mismatch');
    assertEquals(mismatch, []);
    if (routeCase.calls !== undefined) {
      const seen = [...new Set(moduleCalls(h))];
      for (const fn of routeCase.calls)
        assert(seen.includes(fn), `${key}: ${fn} not called (saw ${seen.join(', ')})`);
    }
    await routeCase.expect?.(h, body);
  });
}

Deno.test('every registry route has a handler and a SQL-shaped case with assertions', () => {
  assertEquals(Object.keys(ADMIN_ROUTE_SPECS).sort(), [...KEYS].sort());
  assertEquals(
    KEYS.filter((key) => ROUTE_CASES[key]?.expect === undefined),
    [],
  );
  assertEquals(
    Object.keys(ROUTE_CASES).filter((key) => !KEYS.includes(key as AdminRouteKey)),
    [],
  );
});
