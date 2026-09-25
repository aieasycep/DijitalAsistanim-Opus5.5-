/**
 * Service flows of admin-api (BACKOFFICE_PLAN §13.2, TEST_PLAN EF-ADM-01): invite rollback and the
 * credential check before any change, partial outcomes (ban / factor deletion failures, audited),
 * recovery-code redemption, the support reply credential check, exact-match user search, the
 * health run upstream errors, limited grants and the other guards a handler applies itself.
 */
import { assert, assertEquals } from '@std/assert';
import { hmacSha256Hex, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { jsonResponse } from '../../_shared/testing/fetch.ts';
import { TEST_SUPABASE_URL } from '../../_shared/testing/env.ts';
import {
  ADMIN_ID,
  ALL_PERMISSIONS,
  createHarness,
  errorOf,
  NEW_AUTH_USER,
  SqlError,
} from './harness.ts';

const USER = '00000000-0000-4000-8000-000000000002';
const ADMIN = '00000000-0000-4000-8000-000000000100';
const REASON = 'Kullanıcı talebi üzerine inceleme yapıldı.';
const INVITE = {
  email: 'new@dijitalasistan.app',
  full_name: 'Yeni Admin',
  role: 'support',
  reason: REASON,
};
const SENSITIVE = { reason: REASON, confirm: true };

function authPaths(h: Awaited<ReturnType<typeof createHarness>>): string[] {
  return h.calls
    .filter((c) => c.url.includes('/auth/v1/'))
    .map((c) => `${c.method} ${new URL(c.url).pathname.replace('/auth/v1', '')}`);
}

// ── Invites (ADM-19) ─────────────────────────────────────────────────────────

Deno.test('invite: a failed admin_invite_record deletes the new Auth identity again', async () => {
  const h = await createHarness({
    sql: {
      admin_invite_record: () => {
        throw new SqlError('23514', 'EMAIL_IN_USE_BY_APP_USER');
      },
    },
  });
  const err = await errorOf(await h.request('POST', '/admins/invite', { body: INVITE }));
  assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
  assertEquals(authPaths(h), ['POST /admin/users', `DELETE /admin/users/${NEW_AUTH_USER}`]);
  assert(!h.rpcNames().includes('enqueue_job'), 'no invite email for a rolled-back invite');
});

Deno.test('invite: missing email credentials refuse before any change', async () => {
  for (const env of [{ EMAIL_API_KEY: undefined }, { ADMIN_ORIGIN: undefined }]) {
    const h = await createHarness({ env });
    const err = await errorOf(await h.request('POST', '/admins/invite', { body: INVITE }));
    assertEquals([err.status, err.code], [503, 'EXTERNAL_CREDENTIAL_REQUIRED']);
    assertEquals(authPaths(h), []);
    assertEquals(h.rpcNames(), ['admin_me']);
  }
});

Deno.test('invite: the domain allow-list applies before the identity is created', async () => {
  const h = await createHarness({ env: { ADMIN_ALLOWED_EMAIL_DOMAINS: 'dijitalasistan.app' } });
  const err = await errorOf(
    await h.request('POST', '/admins/invite', { body: { ...INVITE, email: 'someone@gmail.com' } }),
  );
  assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
  assertEquals(authPaths(h), []);
});

Deno.test(
  'invite: an existing admin is a conflict, an existing app user a field error',
  async () => {
    const refuse = (call: { url: string; method: string }) =>
      call.url === `${TEST_SUPABASE_URL}/auth/v1/admin/users` && call.method === 'POST'
        ? jsonResponse({ code: 422, error_code: 'email_exists', msg: 'already registered' }, 422)
        : null;
    const admin = await createHarness({
      outbound: refuse,
      tables: { admin_users: () => [{ user_id: ADMIN }] },
    });
    const conflict = await errorOf(await admin.request('POST', '/admins/invite', { body: INVITE }));
    assertEquals([conflict.status, conflict.details.reason], [409, 'admin_exists']);

    const appUser = await createHarness({ outbound: refuse });
    const field = await errorOf(await appUser.request('POST', '/admins/invite', { body: INVITE }));
    assertEquals([field.status, field.code], [422, 'VALIDATION_FAILED']);
    assert(!appUser.rpcNames().includes('admin_invite_record'));
  },
);

// ── Partial outcomes ─────────────────────────────────────────────────────────

const failingBan = (call: { method: string; url: string }) =>
  call.method === 'PUT' && call.url.includes('/auth/v1/admin/users/')
    ? jsonResponse({ code: 500, msg: 'unavailable' }, 500)
    : null;

Deno.test('disable: a ban failure is a partial 503 with a failure audit row', async () => {
  const h = await createHarness({
    outbound: failingBan,
    sql: { user_disable: () => ({ user_id: USER, state: 'disabled' }) },
  });
  const err = await errorOf(await h.request('POST', `/users/${USER}/disable`, { body: SENSITIVE }));
  assertEquals(
    [err.status, err.code, err.details.partial, err.details.step],
    [503, 'SERVICE_UNAVAILABLE', true, 'auth_ban'],
  );
  const audit = h.rpc.find((r) => r.fn === 'audit_write')?.args ?? {};
  assertEquals([audit.p_action, audit.p_result], ['user.disabled', 'failure']);
  assertEquals(audit.p_details, { partial: true, step: 'auth_ban' });
});

Deno.test('disable: a retry after a partial failure completes the Auth step', async () => {
  const h = await createHarness({
    sql: {
      user_disable: () => {
        throw new SqlError('55000', 'STATE_CONFLICT', 'already_disabled');
      },
      user_overview: () => ({ user_id: USER, account_status: 'disabled' }),
    },
  });
  const res = await h.request('POST', `/users/${USER}/disable`, { body: SENSITIVE });
  assertEquals(res.status, 200);
  assertEquals(authPaths(h), [`PUT /admin/users/${USER}`]);
  const audit = h.rpc.find((r) => r.fn === 'audit_write')?.args ?? {};
  assertEquals([audit.p_result, audit.p_details], ['success', { resumed: true }]);
});

Deno.test('disable: a conflict for another reason stays a conflict', async () => {
  const h = await createHarness({
    sql: {
      user_restore: () => {
        throw new SqlError('55000', 'STATE_CONFLICT', 'deletion_pending');
      },
      user_overview: () => ({ user_id: USER, account_status: 'deletion_pending' }),
    },
  });
  const err = await errorOf(await h.request('POST', `/users/${USER}/restore`, { body: SENSITIVE }));
  assertEquals([err.status, err.code], [409, 'STATE_CONFLICT']);
  assertEquals(authPaths(h), []);
});

Deno.test('admins: an unban failure after enable is partial and audited', async () => {
  const h = await createHarness({
    outbound: failingBan,
    sql: { admin_enable: () => ({ id: ADMIN, status: 'active' }) },
  });
  const err = await errorOf(
    await h.request('POST', `/admins/${ADMIN}/enable`, { body: SENSITIVE }),
  );
  assertEquals([err.status, err.details.step], [503, 'auth_unban']);
  assertEquals(h.rpc.find((r) => r.fn === 'audit_write')?.args.p_action, 'admin.enabled');
});

Deno.test('admins: reset-mfa reports a factor deletion failure as partial', async () => {
  const h = await createHarness({
    outbound: (call) => (call.url.endsWith('/factors') ? jsonResponse({ msg: 'down' }, 503) : null),
    sql: {
      admin_mfa_reset: () => ({ id: ADMIN, recovery_codes_invalidated: 8, sessions_ended: 1 }),
    },
  });
  const err = await errorOf(
    await h.request('POST', `/admins/${ADMIN}/reset-mfa`, { body: SENSITIVE }),
  );
  assertEquals([err.status, err.details.step], [503, 'delete_factors']);
  const audit = h.rpc.find((r) => r.fn === 'audit_write')?.args ?? {};
  assertEquals([audit.p_action, audit.p_result], ['admin.mfa_reset', 'failure']);
});

Deno.test('admins: unlock clears the counters stored under the sign-in key', async () => {
  const email = 'ops@dijitalasistan.app';
  const h = await createHarness({
    sql: {
      admins_list: () => ({
        rows: [
          {
            id: ADMIN,
            email,
            role: 'operations',
            status: 'active',
            mfa_enrolled: true,
            last_login_at: null,
          },
        ],
      }),
      admin_unlock: () => ({ id: ADMIN, locked: false }),
    },
  });
  assertEquals(
    (await h.request('POST', `/admins/${ADMIN}/unlock`, { body: { reason: REASON } })).status,
    200,
  );
  const pepper = h.runtime.env.piiLookupPepper ?? '';
  const expected = await hmacSha256Hex(pepper, await sha256Hex(email));
  assertEquals(h.rpc.find((r) => r.fn === 'admin_unlock')?.args.p_email_hash, expected);
});

Deno.test(
  'sign-in keys fall back to HASH_PEPPER while PII_LOOKUP_PEPPER is not configured',
  async () => {
    const h = await createHarness({
      env: { PII_LOOKUP_PEPPER: undefined },
      sql: { login_preflight: () => ({ allowed: true, send: false, locked: false }) },
    });
    const digest = await sha256Hex('someone@example.com');
    await h.request('POST', '/auth/preflight', {
      auth: false,
      body: { email_hash: digest, ip_hash: digest },
    });
    const expected = await hmacSha256Hex(h.runtime.env.hashPepper, digest);
    assertEquals(h.rpc.find((r) => r.fn === 'login_preflight')?.args.p_email_hash, expected);
  },
);

// ── Recovery codes and invites (ADM-00) ──────────────────────────────────────

Deno.test(
  'recovery redeem: a factor deletion failure is audited through the service writer',
  async () => {
    const h = await createHarness({
      outbound: (call) =>
        call.url.endsWith('/factors') ? jsonResponse({ msg: 'down' }, 503) : null,
      sql: { recovery_code_consume: () => ({ ok: true, remaining: 7 }) },
    });
    const res = await h.request('POST', '/auth/recovery-code/redeem', {
      auth: await h.token({ aal: 'aal1' }),
      body: { code: 'ABCD-EFGH-12' },
    });
    const err = await errorOf(res);
    assertEquals([err.status, err.details.partial], [503, true]);
    const audit = h.rpc.find((r) => r.fn === 'audit_log_append')?.args ?? {};
    assertEquals(
      [audit.p_action, audit.p_result, audit.p_actor_id],
      ['admin.mfa_recovery_used', 'failure', ADMIN_ID],
    );
  },
);

Deno.test(
  'recovery redeem: a wrong code is a field error; no pepper means no attempt',
  async () => {
    const h = await createHarness({
      sql: {
        recovery_code_consume: () => {
          throw new SqlError('22023', 'RECOVERY_CODE_INVALID');
        },
      },
    });
    const aal1 = await h.token({ aal: 'aal1' });
    const wrong = await errorOf(
      await h.request('POST', '/auth/recovery-code/redeem', {
        auth: aal1,
        body: { code: 'ABCD-EFGH-12' },
      }),
    );
    assertEquals([wrong.status, wrong.code], [422, 'VALIDATION_FAILED']);
    assertEquals(authPaths(h), []);

    const noPepper = await createHarness({ env: { RECOVERY_CODE_PEPPER: undefined } });
    const err = await errorOf(
      await noPepper.request('POST', '/auth/recovery-code/redeem', {
        auth: await noPepper.token({ aal: 'aal1' }),
        body: { code: 'ABCD-EFGH-12' },
      }),
    );
    assertEquals([err.status, err.code], [503, 'EXTERNAL_CREDENTIAL_REQUIRED']);
    assertEquals(noPepper.rpc.length, 0);
  },
);

Deno.test(
  'recovery redeem: without the email API the security notice is skipped, never faked',
  async () => {
    const h = await createHarness({
      env: { EMAIL_API_KEY: undefined },
      sql: { recovery_code_consume: () => ({ ok: true, remaining: 7 }) },
    });
    const res = await h.request('POST', '/auth/recovery-code/redeem', {
      auth: await h.token({ aal: 'aal1' }),
      body: { code: 'ABCD-EFGH-12' },
    });
    assertEquals(res.status, 200);
    assert(!h.rpcNames().includes('enqueue_job'));
    assert(h.logs().some((l) => l.msg === 'admin_security_email_skipped'));
  },
);

Deno.test(
  'invite redeem: the token hash is sha256(token) and an unknown token is a field error',
  async () => {
    const token = 'A'.repeat(43);
    const h = await createHarness({
      sql: {
        invite_redeem: () => {
          throw new SqlError('22023', 'INVITE_INVALID');
        },
      },
    });
    const err = await errorOf(
      await h.request('POST', '/auth/invite/redeem', { auth: false, body: { token } }),
    );
    assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
    assertEquals(h.rpc[0]?.args.p_token_hash, `\\x${await sha256Hex(token)}`);
  },
);

// ── Support (ADM-03) ─────────────────────────────────────────────────────────

Deno.test('support reply: without the email API nothing is stored', async () => {
  const h = await createHarness({ env: { EMAIL_PROVIDER: undefined } });
  const err = await errorOf(
    await h.request('POST', `/support/tickets/${USER}/reply`, { body: { body: 'Merhaba' } }),
  );
  assertEquals([err.status, err.code], [503, 'EXTERNAL_CREDENTIAL_REQUIRED']);
  assert(!h.rpcNames().includes('ticket_reply'));
});

Deno.test('support reply: a ticket without a contact email is a conflict', async () => {
  const h = await createHarness({
    sql: {
      ticket_reply: () => {
        throw new SqlError('55000', 'STATE_CONFLICT', 'no_contact_email');
      },
    },
  });
  const err = await errorOf(
    await h.request('POST', `/support/tickets/${USER}/reply`, { body: { body: 'Merhaba' } }),
  );
  assertEquals([err.status, err.details.reason], [409, 'no_contact_email']);
  assertEquals(h.calls.filter((c) => c.url.endsWith('/worker/run')).length, 0);
});

// ── Users (ADM-02) ───────────────────────────────────────────────────────────

Deno.test('users: q is an exact email or a user id, never a partial search', async () => {
  const empty = { rows: [], total: 0 };
  const byId = await createHarness({ sql: { users_list: () => empty } });
  await byId.request('GET', `/users?q=${USER.toUpperCase()}`);
  assertEquals(byId.rpc.find((r) => r.fn === 'users_list')?.args.p_filter, { user_id: USER });

  const byEmail = await createHarness({
    sql: { user_lookup_email: () => ({ user_id: USER }), users_list: () => empty },
  });
  await byEmail.request('GET', '/users?q=yunus@gmail.com');
  assertEquals(byEmail.rpc.find((r) => r.fn === 'user_lookup_email')?.args, {
    p_email: 'yunus@gmail.com',
  });
  assertEquals(byEmail.rpc.find((r) => r.fn === 'users_list')?.args.p_filter, { user_id: USER });

  const unknown = await createHarness({ sql: { user_lookup_email: () => ({ user_id: null }) } });
  const res = await unknown.request('GET', '/users?q=nobody@gmail.com');
  assertEquals((await res.json()).meta.total, 0);
  assert(!unknown.rpcNames().includes('users_list'));

  const partial = await createHarness();
  const body = await (await partial.request('GET', '/users?q=yunus')).json();
  assertEquals([body.data, body.meta.total], [[], 0]);
  assertEquals(partial.rpcNames(), ['admin_me']);
});

Deno.test('users: grant_limited admins may grant only the limited support grant', async () => {
  const permissions = ALL_PERMISSIONS.filter((p) => p !== 'entitlements.grant');
  const grant = {
    id: USER,
    user_id: USER,
    source: 'support',
    duration_days: 7,
    starts_at: '2026-09-24T08:00:00Z',
    ends_at: '2026-10-01T08:00:00Z',
  };
  const h = await createHarness({ permissions, sql: { entitlement_grant: () => grant } });
  const big = await errorOf(
    await h.request('POST', `/users/${USER}/entitlement-grants`, {
      body: { duration_days: 30, source: 'admin', reason: REASON, confirm: true },
    }),
  );
  assertEquals([big.status, big.details.permission], [403, 'entitlements.grant']);
  const small = await h.request('POST', `/users/${USER}/entitlement-grants`, {
    body: { duration_days: 7, source: 'support', reason: REASON, confirm: true },
  });
  assertEquals(small.status, 201);
});

Deno.test('users: disconnect and grant revoke refuse ids that belong to another user', async () => {
  const h = await createHarness({
    sql: { user_integrations: () => [], entitlement_grants_list: () => ({ rows: [], total: 0 }) },
  });
  const other = '00000000-0000-4000-8000-000000000999';
  const disconnect = await errorOf(
    await h.request('POST', `/users/${USER}/integrations/${other}/disconnect`, {
      body: { ...SENSITIVE, purge_content: false },
    }),
  );
  assertEquals(disconnect.status, 404);
  const revoke = await errorOf(
    await h.request('POST', `/users/${USER}/entitlement-grants/${other}/revoke`, {
      body: SENSITIVE,
    }),
  );
  assertEquals(revoke.status, 404);
  assert(
    !h.rpcNames().includes('integration_disconnect') &&
      !h.rpcNames().includes('entitlement_revoke'),
  );
});

Deno.test('users: a force sync that queues nothing does not poke the worker', async () => {
  const h = await createHarness({ sql: { user_force_sync: () => ({ job_ids: [], jobs: [] }) } });
  const res = await h.request('POST', `/users/${USER}/force-sync`, { body: SENSITIVE });
  assertEquals(res.status, 202);
  assertEquals(h.calls.filter((c) => c.url.endsWith('/worker/run')).length, 0);
});

// ── Other guards ─────────────────────────────────────────────────────────────

Deno.test(
  'health run: upstream refusals and timeouts are reported, never audited as success',
  async () => {
    const forbidden = await createHarness({
      outbound: (call) =>
        call.url.endsWith('/functions/v1/health/run')
          ? jsonResponse({ error: { code: 'FORBIDDEN' } }, 403)
          : null,
    });
    const err = await errorOf(await forbidden.request('POST', '/health/run', { body: {} }));
    assertEquals([err.status, err.code], [403, 'FORBIDDEN']);
    assert(!forbidden.rpcNames().includes('audit_write'));

    const down = await createHarness({
      outbound: (call) => {
        if (call.url.endsWith('/functions/v1/health/run'))
          throw new TypeError('connection refused');
        return null;
      },
    });
    const timeout = await errorOf(await down.request('POST', '/health/run', { body: {} }));
    assertEquals([timeout.status, timeout.code], [504, 'UPSTREAM_TIMEOUT']);
  },
);

Deno.test('notifications: the list is always scoped to one user', async () => {
  const h = await createHarness();
  const err = await errorOf(await h.request('GET', '/notifications'));
  assertEquals([err.status, err.code], [422, 'VALIDATION_FAILED']);
  assertEquals(h.rpcNames(), ['admin_me']);
});

Deno.test(
  'flags: kill switches are never archived; an existing key is never re-created',
  async () => {
    const h = await createHarness({ sql: { flag_get: () => ({ key: 'ai.global.enabled' }) } });
    const archive = await errorOf(
      await h.request('POST', '/flags/ai.global.enabled/archive', { body: SENSITIVE }),
    );
    assertEquals([archive.status, archive.details.reason], [409, 'kill_switch']);
    const create = await errorOf(
      await h.request('POST', '/flags', {
        body: { key: 'ai.global.enabled', description: 'd', enabled: false, reason: REASON },
      }),
    );
    assertEquals([create.status, create.details.reason], [409, 'flag_exists']);
    assert(!h.rpcNames().includes('flag_upsert') && !h.rpcNames().includes('flag_archive'));
  },
);

Deno.test('audit: a uuid that is not an audit row id is 404 without a query', async () => {
  const h = await createHarness();
  const err = await errorOf(await h.request('GET', `/audit/${crypto.randomUUID()}`));
  assertEquals(err.status, 404);
  assertEquals(h.rpcNames(), ['admin_me']);
});

Deno.test('ai: a probe without the provider credential is refused, never faked', async () => {
  const h = await createHarness({
    env: { AI_FIXTURE_PROVIDER_ENABLED: undefined },
    sql: {
      ai_model_config_list: () => ({
        rows: [
          {
            id: USER,
            profile: 'lean',
            feature: 'reply_draft',
            primary_target: { provider: 'openai', model: 'm' },
          },
        ],
        routing_profiles: {},
      }),
    },
  });
  const err = await errorOf(
    await h.request('POST', '/ai/models/lean/reply_draft/test', { body: { fixture_set: 'smoke' } }),
  );
  assertEquals([err.status, err.code], [503, 'EXTERNAL_CREDENTIAL_REQUIRED']);
  assertEquals(err.details.credential_keys, ['OPENAI_API_KEY']);
  assert(!h.rpcNames().includes('audit_write'));
});

Deno.test('settings: an unknown or out-of-range value is refused before SQL', async () => {
  const h = await createHarness();
  const unknown = await errorOf(
    await h.request('PATCH', '/settings/config/unknown.setting', {
      body: { value: 1, reason: REASON, confirm: true },
    }),
  );
  assertEquals([unknown.status, unknown.code], [422, 'VALIDATION_FAILED']);
  assert(!h.rpcNames().includes('settings_update'));
});

Deno.test(
  'settings: the referral risk threshold is 0–1 in the contract and 0–100 in app_settings',
  async () => {
    const h = await createHarness({
      sql: {
        settings_get: () => ({
          app_settings: { 'referral.risk_threshold': { value: 50 } },
          plan_limits: {},
        }),
        settings_update: () => ({
          key: 'referral.risk_threshold',
          value: 70,
          updated_at: '2026-09-24T10:00:00Z',
        }),
      },
    });
    const res = await h.request('PATCH', '/settings/config/referral.risk_threshold', {
      body: { value: 0.7, reason: REASON, confirm: true },
    });
    assertEquals(res.status, 200);
    assertEquals(h.rpc.find((r) => r.fn === 'settings_update')?.args.p_value, 70);
    assertEquals((await res.json()).data, {
      key: 'referral.risk_threshold',
      before: 0.5,
      after: 0.7,
    });
  },
);

Deno.test(
  'settings: the yearly referral reward cap is the plan limit both plans read',
  async () => {
    const h = await createHarness({
      sql: {
        settings_get: () => ({
          app_settings: {},
          plan_limits: {
            free: { referral_rewards_per_year: 6 },
            pro: { referral_rewards_per_year: 6 },
          },
        }),
        plan_limits_update: (args) => ({ plan: args.p_plan, key: args.p_key, value: args.p_value }),
      },
    });
    const res = await h.request('PATCH', '/settings/config/referral.max_rewards_per_year', {
      body: { value: 8, reason: REASON, confirm: true },
    });
    assertEquals(res.status, 200);
    assertEquals(
      h.rpc
        .filter((r) => r.fn === 'plan_limits_update')
        .map((r) => [r.args.p_plan, r.args.p_key, r.args.p_value]),
      [
        ['free', 'referral_rewards_per_year', 8],
        ['pro', 'referral_rewards_per_year', 8],
      ],
    );
    assertEquals((await res.json()).data, {
      key: 'referral.max_rewards_per_year',
      before: 6,
      after: 8,
    });
    assert(!h.rpcNames().includes('settings_update'));
  },
);
