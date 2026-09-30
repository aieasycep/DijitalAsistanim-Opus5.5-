import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  BootstrapError,
  bootstrap,
  inviteTokenHash,
  parseBootstrapArgs,
  readBootstrapEnv,
  type BootstrapDeps,
  type BootstrapEnv,
} from '../admin-bootstrap.ts';

const ENV: BootstrapEnv = {
  supabaseUrl: 'https://project.supabase.test',
  secretKey: 'test-only-secret-value',
  adminOrigin: 'https://admin.example.test',
  allowedDomains: [],
};
const TOKEN = 'A'.repeat(43);
const USER_ID = '0199a1b2-0000-7000-8000-000000000001';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeSupabase(routes: Record<string, (call: Call) => { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchStub = ((input: string, init?: RequestInit) => {
    const url = input;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: Call = {
      method,
      url,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const path = new URL(url).pathname;
    const handler = routes[`${method} ${path}`];
    const result =
      handler === undefined ? { status: 404, json: { message: 'not stubbed' } } : handler(call);
    return Promise.resolve(
      new Response(result.json === undefined ? null : JSON.stringify(result.json), {
        status: result.status,
      }),
    );
  }) as typeof fetch;
  const deps: BootstrapDeps = {
    fetch: fetchStub,
    now: () => new Date('2026-09-24T10:00:00.000Z'),
    inviteToken: () => TOKEN,
    uuid: () => '0199a1b2-0000-7000-8000-00000000c0de',
  };
  return { calls, deps };
}

describe('admin-bootstrap arguments and environment', () => {
  it('parses --email and --name and normalises the email', () => {
    assert.deepEqual(
      parseBootstrapArgs(['--email', ' Owner@Company.COM ', '--name', 'Ada Yılmaz']),
      {
        email: 'owner@company.com',
        name: 'Ada Yılmaz',
      },
    );
  });

  it('rejects missing or malformed arguments with the usage line', () => {
    assert.throws(
      () => parseBootstrapArgs([]),
      (error: unknown) => error instanceof BootstrapError && error.code === 'usage',
    );
    assert.throws(() => parseBootstrapArgs(['--email', 'nope', '--name', 'A']), /--email/);
    assert.throws(
      () => parseBootstrapArgs(['--email', 'a@b.co', '--name', 'x'.repeat(81)]),
      /--name/,
    );
    assert.throws(
      () => parseBootstrapArgs(['--email', 'a@b.co', '--name', 'A', '--role', 'x']),
      /Usage/,
    );
  });

  it('names missing environment keys without echoing values', () => {
    assert.throws(
      () => readBootstrapEnv({ SUPABASE_URL: 'https://x.test' }),
      (error: unknown) =>
        error instanceof BootstrapError &&
        error.message.includes('SUPABASE_SECRET_KEY, ADMIN_ORIGIN'),
    );
    const env = readBootstrapEnv({
      SUPABASE_URL: 'https://x.test/',
      SUPABASE_SECRET_KEY: 'secret-value',
      ADMIN_ORIGIN: 'https://admin.x.test/path',
      ADMIN_ALLOWED_EMAIL_DOMAINS: 'Company.com, other.org',
    });
    assert.equal(env.supabaseUrl, 'https://x.test');
    assert.equal(env.adminOrigin, 'https://admin.x.test');
    assert.deepEqual(env.allowedDomains, ['company.com', 'other.org']);
  });

  it('hashes the invite token with SHA-256 as a bytea hex literal', () => {
    const hex = createHash('sha256').update(TOKEN).digest('hex');
    assert.equal(inviteTokenHash(TOKEN), `\\x${hex}`);
  });
});

describe('admin-bootstrap run', () => {
  const args = { email: 'owner@company.com', name: 'Ada Yılmaz' };

  it('refuses when an active super_admin exists and writes nothing', async () => {
    const { calls, deps } = fakeSupabase({
      'GET /rest/v1/admin_users': () => ({ status: 200, json: [{ user_id: USER_ID }] }),
    });
    await assert.rejects(
      bootstrap(args, ENV, deps),
      (error: unknown) =>
        error instanceof BootstrapError && error.code === 'active_super_admin_exists',
    );
    assert.deepEqual(
      calls.map((c) => c.method),
      ['GET'],
    );
  });

  it('creates the identity, the invited super_admin row and the audit entry, then returns the link', async () => {
    const { calls, deps } = fakeSupabase({
      'GET /rest/v1/admin_users': () => ({ status: 200, json: [] }),
      'POST /auth/v1/admin/users': () => ({ status: 200, json: { id: USER_ID } }),
      'POST /rest/v1/admin_users': () => ({ status: 201 }),
      'POST /rest/v1/rpc/audit_log_append': () => ({ status: 200, json: 1 }),
    });
    const result = await bootstrap(args, ENV, deps);
    assert.equal(result.inviteUrl, `https://admin.example.test/invite?token=${TOKEN}`);
    assert.equal(result.expiresAt, '2026-09-27T10:00:00.000Z');
    assert.equal(result.reissued, false);

    const identity = calls.find((c) => c.url.endsWith('/auth/v1/admin/users'));
    assert.deepEqual(identity?.body, {
      email: 'owner@company.com',
      email_confirm: true,
      app_metadata: { da_kind: 'admin' },
      user_metadata: { display_name: 'Ada Yılmaz' },
    });
    const row = calls.find((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/admin_users'));
    assert.deepEqual(row?.body, {
      user_id: USER_ID,
      role: 'super_admin',
      status: 'invited',
      display_name: 'Ada Yılmaz',
      email: 'owner@company.com',
      invite_token_hash: inviteTokenHash(TOKEN),
      invite_expires_at: '2026-09-27T10:00:00.000Z',
    });
    const audit = calls.find((c) => c.url.endsWith('/rpc/audit_log_append'));
    assert.equal((audit?.body as { p_actor_type: string }).p_actor_type, 'system');
    assert.equal((audit?.body as { p_action: string }).p_action, 'admin.bootstrap');
    // The secret travels only in headers, never in a body or URL.
    for (const call of calls) {
      assert.equal(call.headers.apikey, ENV.secretKey);
      assert.ok(!call.url.includes(ENV.secretKey));
      assert.ok(!JSON.stringify(call.body ?? null).includes(ENV.secretKey));
    }
  });

  it('rolls the identity back when the admin_users insert fails', async () => {
    const { calls, deps } = fakeSupabase({
      'GET /rest/v1/admin_users': () => ({ status: 200, json: [] }),
      'POST /auth/v1/admin/users': () => ({ status: 200, json: { id: USER_ID } }),
      'POST /rest/v1/admin_users': () => ({
        status: 400,
        json: { code: '23514', message: 'EMAIL_IN_USE_BY_APP_USER' },
      }),
      [`DELETE /auth/v1/admin/users/${USER_ID}`]: () => ({ status: 200, json: {} }),
    });
    await assert.rejects(
      bootstrap(args, ENV, deps),
      /insert_admin_user failed \(HTTP 400\): 23514/,
    );
    assert.ok(
      calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/auth/v1/admin/users/${USER_ID}`)),
    );
    assert.ok(!calls.some((c) => c.url.endsWith('/rpc/audit_log_append')));
  });

  it('re-issues the link for a pending super_admin with the same email', async () => {
    const { calls, deps } = fakeSupabase({
      'GET /rest/v1/admin_users': (call) => ({
        status: 200,
        json: call.url.includes('email=eq.')
          ? [{ user_id: USER_ID, role: 'super_admin', status: 'invited' }]
          : [],
      }),
      'PATCH /rest/v1/admin_users': () => ({ status: 204 }),
      'POST /rest/v1/rpc/audit_log_append': () => ({ status: 200, json: 2 }),
    });
    const result = await bootstrap(args, ENV, deps);
    assert.equal(result.reissued, true);
    assert.ok(!calls.some((c) => c.url.endsWith('/auth/v1/admin/users')));
  });

  it('enforces ADMIN_ALLOWED_EMAIL_DOMAINS before any request', async () => {
    const { calls, deps } = fakeSupabase({});
    await assert.rejects(
      bootstrap(args, { ...ENV, allowedDomains: ['dijitalasistan.app'] }, deps),
      (error: unknown) => error instanceof BootstrapError && error.code === 'domain_not_allowed',
    );
    assert.equal(calls.length, 0);
  });
});
