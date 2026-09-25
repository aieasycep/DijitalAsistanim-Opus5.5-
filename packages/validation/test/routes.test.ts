import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ADMIN_PERMISSION_VALUES, type AdminRouteContract } from '../src/admin/common.ts';
import {
  AUDIT_ACTIONS,
  isCatalogueAction,
  isKnownAuditAction,
} from '../src/admin/audit-actions.ts';
import { adminRoutes } from '../src/admin/routes.ts';
import { routes } from '../src/api/routes.ts';
import { publicRoutes } from '../src/public/routes.ts';
import type { RouteContract } from '../src/route.ts';
import { adminFixtures } from './fixtures/admin-fixtures.ts';
import { apiFixtures } from './fixtures/api-fixtures.ts';
import { publicFixtures } from './fixtures/public-fixtures.ts';
import type { Part, RouteFixture } from './fixtures/types.ts';

const REQUEST_PARTS = ['params', 'query', 'body', 'headers'] as const;
/** Request bodies that are provider payloads (not ours) and therefore open objects. */
const OPEN_BODIES = new Set(['public-api POST /support/inbound-email']);

type Registry = Readonly<Record<string, RouteContract>>;
type Fixtures = Readonly<Record<string, RouteFixture>>;

const registries: [string, Registry, Fixtures][] = [
  ['api', routes, apiFixtures],
  ['admin-api', adminRoutes, adminFixtures],
  ['public-api', publicRoutes, publicFixtures],
];

function schemaFor(route: RouteContract, part: Part): z.ZodType | undefined {
  return part === 'response' ? route.response : route.request[part];
}

function issues(schema: z.ZodType, value: unknown): unknown[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `true` when a parametrised path (`/a/:id`) also matches a literal path (`/a/b`). */
function shadows(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length || pattern === path) return false;
  return a.every(
    (seg, i) => seg === b[i] || (seg.startsWith(':') && !(b[i] ?? '').startsWith(':')),
  );
}

describe.each(registries)('%s route catalogue', (name, registry, fixtures) => {
  const entries = Object.entries(registry);

  it('keys are "METHOD /path" and match the declared method and path', () => {
    for (const [key, route] of entries) {
      expect(key).toBe(`${route.method} ${route.path}`);
      expect(route.path.startsWith('/')).toBe(true);
    }
  });

  it('has exactly one fixture per route', () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(registry).sort());
  });

  it('registers literal paths before parametrised siblings (Hono order)', () => {
    const list = entries.map(([, route]) => route);
    list.forEach((earlier, i) => {
      list.slice(i + 1).forEach((later) => {
        const clash = earlier.method === later.method && shadows(earlier.path, later.path);
        expect(clash, `${earlier.method} ${earlier.path} shadows ${later.path}`).toBe(false);
      });
    });
  });

  it('declares idempotency and a success status on every route', () => {
    for (const [, route] of entries) {
      expect(['header', 'client_id', 'natural', 'none']).toContain(route.idempotency);
      expect([200, 201, 202, 204]).toContain(route.status);
      if (route.method === 'GET') expect(route.request.body).toBeUndefined();
    }
  });

  describe.each(entries)('%s', (key, route) => {
    const fixture: RouteFixture = fixtures[key] ?? { valid: {}, invalid: [] };

    it('accepts the valid fixture for every declared part', () => {
      for (const part of [...REQUEST_PARTS, 'response'] as const) {
        const schema = schemaFor(route, part);
        if (schema === undefined) {
          expect(fixture.valid[part], `${part} fixture without schema`).toBeUndefined();
          continue;
        }
        expect(issues(schema, fixture.valid[part]), `${key} ${part}`).toEqual([]);
      }
    });

    it('rejects every invalid fixture', () => {
      expect(fixture.invalid.length).toBeGreaterThan(0);
      for (const invalid of fixture.invalid) {
        const schema = schemaFor(route, invalid.part);
        expect(schema, `${invalid.why}: no ${invalid.part} schema`).toBeDefined();
        if (schema !== undefined) {
          expect(
            schema.safeParse(invalid.value).success,
            `${key} ${invalid.part}: ${invalid.why}`,
          ).toBe(false);
        }
      }
    });

    it('rejects unknown keys in strict request parts', () => {
      for (const part of ['params', 'query', 'body'] as const) {
        const schema = route.request[part];
        const valid = fixture.valid[part];
        if (schema === undefined || !isPlainObject(valid) || OPEN_BODIES.has(`${name} ${key}`))
          continue;
        expect(schema.safeParse({ ...valid, __unknown__: 1 }).success, `${key} ${part}`).toBe(
          false,
        );
      }
    });

    it('rejects a response without the envelope meta', () => {
      const valid = fixture.valid.response;
      if (!isPlainObject(valid) || !('meta' in valid)) return;
      expect(route.response.safeParse({ ...valid, meta: {} }).success).toBe(false);
    });
  });
});

describe('api route catalogue coverage', () => {
  const ids = Object.values(routes).map((r) => r.id);

  it('covers every §5b route plus the R-07/R-18/R-24 additions', () => {
    for (const key of [
      'POST /integrations/oauth/complete',
      'POST /approvals/:id/device-execution',
      'POST /captures/:id/discard',
      'GET /widgets/snapshot',
      'POST /assistant/threads/:id/messages',
    ]) {
      expect(Object.keys(routes)).toContain(key);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(64);
  });

  it('streams only the assistant message route', () => {
    const streaming = Object.entries(routes).filter(([, r]) => 'stream' in r);
    expect(streaming.map(([k]) => k)).toEqual(['POST /assistant/threads/:id/messages']);
  });

  it('registers the OAuth completion before every :accountId integration route', () => {
    const keys = Object.keys(routes);
    const complete = keys.indexOf('POST /integrations/oauth/complete');
    keys
      .filter((k) => k.includes('/integrations/:accountId'))
      .forEach((k) => {
        expect(keys.indexOf(k)).toBeGreaterThan(complete);
      });
  });
});

describe('admin-api route access rules', () => {
  const list: AdminRouteContract[] = Object.values(adminRoutes);
  const permissions = new Set<string>(ADMIN_PERMISSION_VALUES);

  it('declares exactly one primary permission or an own-account class (UT-RBAC-03)', () => {
    for (const route of list) {
      const classes = ['own', 'any_admin', 'aal1', 'bff'];
      expect(
        permissions.has(route.access.require) || classes.includes(route.access.require),
        route.path,
      ).toBe(true);
      for (const extra of [...(route.access.also ?? []), ...(route.access.or ?? [])]) {
        expect(permissions.has(extra)).toBe(true);
      }
    }
  });

  it('writes an audit action on every permission-gated mutation (§12.1)', () => {
    const readLike = new Set([
      'POST /users/lookup',
      'POST /announcements/audience-estimate',
      'POST /announcements/:id/preview',
      'POST /ai/prompts/:key/versions/:v/test',
    ]);
    for (const route of list) {
      const key = `${route.method} ${route.path}`;
      const permissionGated = permissions.has(route.access.require);
      if (route.method === 'GET' || !permissionGated || readLike.has(key)) continue;
      expect(route.audit, key).toBeDefined();
      expect(route.idempotency, key).toBe('header');
    }
  });

  it('declares only BACKOFFICE_PLAN §10 catalogue actions (audit names match the catalogue)', () => {
    const outside = list
      .filter((route) => route.audit !== undefined && !isCatalogueAction(route.audit))
      .map((route) => `${route.method} ${route.path}: ${String(route.audit)}`);
    expect(outside).toEqual([]);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(isKnownAuditAction('system.referral.flagged')).toBe(true);
    expect(isKnownAuditAction('admin.user.disabled')).toBe(false);
  });

  it('protects the step-up permissions (§12.2)', () => {
    const stepUpPermissions = new Set([
      'admins.manage',
      'settings.system.write',
      'support.access',
      'users.disable',
      'integrations.disconnect',
    ]);
    for (const route of list) {
      if (route.method === 'GET') continue;
      if (
        stepUpPermissions.has(route.access.require) &&
        route.path !== '/support-access/grants/:id/revoke'
      ) {
        expect(route.access.step_up, `${route.method} ${route.path}`).toBe(true);
      }
    }
  });

  it('has no impersonation, password or audit-mutation route', () => {
    const paths = list.map((r) => `${r.method} ${r.path}`);
    expect(paths.some((p) => /impersonat|password/.test(p))).toBe(false);
    expect(paths.some((p) => /^(PATCH|DELETE|PUT) \/audit/.test(p))).toBe(false);
  });
});
