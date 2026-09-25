/**
 * IT-OAUTH-* (TEST_PLAN §6.2; API_CONTRACTS API-INT-01/02/03/07, API-AUTH-apple, OAUTH-01…03;
 * INTEGRATION_PLAN §2; R-07 completion binding).
 */
import { assert, assertEquals, assertFalse, assertNotEquals } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  it,
  json,
  mock,
  one,
  q,
  releaseJobs,
} from './_harness/mod.ts';
import { account, callback, complete, connect, consent, startFlow } from './_harness/flows.ts';

const DEMO = { DEMO_MODE: 'true', GOOGLE_OAUTH_CLIENT_ID: undefined };

function i18n(ns: string): string {
  return Deno.readTextFileSync(
    new URL(`../../../packages/i18n/messages/tr/${ns}.json`, import.meta.url),
  );
}

async function tokenCalls(prefix: string): Promise<number> {
  return (await mock.requests(prefix)).filter((r) => r.method === 'POST' && /\/token$/.test(r.path))
    .length;
}

async function credentialRows(accountId: string) {
  return await q<{ token_kind: string; ciphertext: Uint8Array; key_version: number }>(
    `select token_kind, ciphertext, key_version from public.oauth_credentials where connected_account_id = $1 order by token_kind`,
    [accountId],
  );
}

/** Expires the stored access token so the next provider call refreshes. */
async function expireAccess(accountId: string): Promise<void> {
  await q(
    `update public.oauth_credentials set access_expires_at = now() - interval '5 minutes'
      where connected_account_id = $1 and token_kind = 'access'`,
    [accountId],
  );
}

async function manualSync(
  user: { jwt: string },
  accountId: string,
  resources = ['mail'],
): Promise<Response> {
  await q(`delete from public.rate_limits`);
  return await call('api', 'POST', `/integrations/${accountId}/sync`, {
    jwt: user.jwt,
    body: { resources },
  });
}

it('IT-OAUTH-01', 'Google connect happy path with the completion binding', async () => {
  const user = await createUser();
  const flow = await startFlow(user, 'google', ['mail_read']);
  const auth = new URL(flow.authUrl);
  assertEquals(auth.searchParams.get('code_challenge_method'), 'S256');
  assertEquals(auth.searchParams.get('access_type'), 'offline');
  assert((auth.searchParams.get('nonce') ?? '').length > 0);
  const link = await callback(await consent(flow.authUrl));
  assertEquals(
    `${link.protocol}//${link.host}${link.pathname}`,
    'dijitalasistan://integrations/callback',
  );
  assertEquals(link.searchParams.get('provider'), 'google');
  // API_CONTRACTS OAUTH-01: the final result comes from API-INT-07.
  assertEquals(link.searchParams.get('result'), 'pending_confirmation');
  const code = link.searchParams.get('completion_code') ?? '';
  assert(code.length >= 32);
  for (const forbidden of ['access_token', 'refresh_token', 'code', 'id_token', 'scope', 'email'])
    assertFalse(link.searchParams.has(forbidden), forbidden);

  const state = await one<{
    used_at: string | null;
    completed_at: string | null;
    connected_account_id: string;
  }>(`select used_at, completed_at, connected_account_id from public.oauth_states where id = $1`, [
    flow.stateId,
  ]);
  assert(state.used_at !== null);
  assertEquals(state.completed_at, null);
  assertEquals((await account(state.connected_account_id)).status, 'connecting');
  assertEquals(await count(`select 1 from public.jobs where type = 'initial_sync'`), 0);

  const tokens = (await mock.requests('/google-oauth/token')).filter((r) => r.method === 'POST');
  assertEquals(tokens.length, 1);
  assert((new URLSearchParams(tokens[0]?.body ?? '').get('code_verifier') ?? '').length >= 43);

  const done = await complete(user, code, flow.deviceNonce);
  assertEquals(done.status, 200, JSON.stringify(done.body));
  assertEquals((done.body.data as { result: string }).result, 'success');
  const acct = await account(state.connected_account_id);
  assertEquals(acct.status, 'syncing');
  assert((acct.capabilities_granted as string[]).includes('mail_read'));
  const closed = await one<{ completed_at: string | null }>(
    `select completed_at from public.oauth_states where id = $1`,
    [flow.stateId],
  );
  assert(closed.completed_at !== null);
  assertEquals(
    await count(
      `select 1 from public.jobs where type = 'initial_sync' and connected_account_id = $1`,
      [acct.id],
    ),
    1,
  );

  // The stored ciphertext never contains the plaintext refresh token (a grep over the rows).
  const issued = await mock.google<{ refresh: [string, unknown][] }>({ op: 'state' });
  const refresh = issued.refresh[0]?.[0] ?? '';
  assert(refresh.startsWith('1//'));
  const rows = await q<{ row: string }>(
    `select row_to_json(c)::text as row from public.oauth_credentials c where user_id = $1
     union all select row_to_json(s)::text from public.oauth_states s where user_id = $1
     union all select row_to_json(a)::text from public.connected_accounts a where user_id = $1`,
    [user.id],
  );
  assert(rows.length >= 3);
  for (const { row } of rows)
    assertFalse(row.includes(refresh), 'refresh token stored in plaintext');
  assertEquals(
    await count(
      `select 1 from public.oauth_credentials where connected_account_id = $1 and token_kind = 'refresh'`,
      [acct.id],
    ),
    1,
  );
});

it(
  'IT-OAUTH-02',
  'reused, expired and provider-mismatched states are rejected without a token exchange',
  async () => {
    const user = await createUser({ pro: true });
    // Reused: the second callback with the same state never exchanges.
    const flow = await startFlow(user, 'google', ['mail_read']);
    const cb = await consent(flow.authUrl);
    await callback(cb);
    assertEquals(await tokenCalls('/google-oauth'), 1);
    const reused = await callback(cb);
    assertNotEquals(reused.searchParams.get('result'), 'pending_confirmation');
    assertFalse(reused.searchParams.has('completion_code'));
    assertEquals(await tokenCalls('/google-oauth'), 1);

    // Expired: the state row is older than its TTL (DB now() + 11 min equivalent).
    await mock.reset();
    const late = await startFlow(user, 'google', ['mail_read']);
    const lateCb = await consent(late.authUrl);
    await q(
      `update public.oauth_states set created_at = created_at - interval '11 minutes', expires_at = now() - interval '1 minute' where id = $1`,
      [late.stateId],
    );
    const expired = await callback(lateCb);
    assertEquals(expired.searchParams.get('result'), 'expired_state');
    assertEquals(await tokenCalls('/google-oauth'), 0);

    // Provider mismatch: a Google state presented to the Microsoft callback.
    await mock.reset();
    const other = await startFlow(user, 'google', ['mail_read']);
    const googleCb = new URL(`http://x${await consent(other.authUrl)}`);
    const mismatch = await callback(`/microsoft/callback${googleCb.search}`);
    assertNotEquals(mismatch.searchParams.get('result'), 'pending_confirmation');
    assertEquals(await tokenCalls('/ms-login'), 0);
    assertEquals(await tokenCalls('/google-oauth'), 0);
  },
);

it('IT-OAUTH-03', 'a partial grant leaves the account partial without mail_read', async () => {
  const user = await createUser();
  await mock.google({
    op: 'grant',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
  });
  const flow = await startFlow(user, 'google', ['mail_read', 'calendar_read']);
  const link = await callback(await consent(flow.authUrl));
  const done = await complete(
    user,
    link.searchParams.get('completion_code') ?? '',
    flow.deviceNonce,
  );
  assertEquals(done.status, 200, JSON.stringify(done.body));
  const data = done.body.data as { result: string; missing: string[]; account: { id: string } };
  assertEquals(data.result, 'partial');
  assertEquals(data.missing, ['mail_read']);
  const acct = await account(data.account.id);
  assertEquals(acct.status, 'partial');
  assertFalse((acct.capabilities_granted as string[]).includes('mail_read'));
  assert((acct.capabilities_granted as string[]).includes('calendar_read'));
  // UI copy key of the partial state exists (states / settings namespaces).
  assert(/"partial"\s*:/.test(i18n('settings')) || /"partial"\s*:/.test(i18n('states')));
});

it(
  'IT-OAUTH-04',
  'progressive upgrade requests only gmail.send with include_granted_scopes',
  async () => {
    const user = await createUser();
    const { accountId } = await connect(user, 'google', ['mail_read']);
    const flow = await startFlow(user, 'google', ['mail_send'], { upgradeOf: accountId });
    const auth = new URL(flow.authUrl);
    assertEquals(auth.searchParams.get('include_granted_scopes'), 'true');
    const scopes = (auth.searchParams.get('scope') ?? '').split(' ');
    assert(scopes.includes('https://www.googleapis.com/auth/gmail.send'), scopes.join(' '));
    assertFalse(
      scopes.includes('https://www.googleapis.com/auth/gmail.readonly'),
      scopes.join(' '),
    );
    const link = await callback(await consent(flow.authUrl));
    const done = await complete(
      user,
      link.searchParams.get('completion_code') ?? '',
      flow.deviceNonce,
    );
    assertEquals(done.status, 200, JSON.stringify(done.body));
    const acct = await account(accountId);
    for (const cap of ['mail_read', 'mail_send'])
      assert((acct.capabilities_granted as string[]).includes(cap), cap);
  },
);

it(
  'IT-OAUTH-05',
  'Microsoft connect signs a certificate client_assertion; Graph calls prefer ImmutableId',
  async () => {
    const user = await createUser();
    const { accountId } = await connect(user, 'microsoft', ['mail_read']);
    const state = await mock.graph<{
      assertions: { alg: string; x5tS256: string | null; valid: boolean }[];
    }>({ op: 'state' });
    assert(state.assertions.length >= 1);
    for (const a of state.assertions) {
      assert(a.valid, JSON.stringify(a));
      assertEquals(a.x5tS256, Deno.env.get('MICROSOFT_CERT_THUMBPRINT_S256'));
      assert(['RS256', 'PS256'].includes(a.alg));
    }
    const token = (await mock.requests('/ms-login')).find((r) => r.method === 'POST');
    const form = new URLSearchParams(token?.body ?? '');
    assertEquals(
      form.get('client_assertion_type'),
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    assertFalse(form.has('client_secret'));
    await releaseJobs();
    await drain({ types: ['initial_sync', 'outlook_sync'] });
    const graph = (await mock.requests('/graph')).filter((r) => !r.path.endsWith('/$batch'));
    assert(graph.length >= 2, `graph calls: ${graph.length}`);
    for (const r of graph)
      assert((r.headers.prefer ?? '').includes('IdType="ImmutableId"'), `${r.method} ${r.path}`);
    assert(['syncing', 'healthy'].includes(String((await account(accountId)).status)));
  },
);

it('IT-OAUTH-06', 'Microsoft AADSTS65001 → admin_consent_required', async () => {
  const user = await createUser();
  await mock.graph({ op: 'admin_consent_required', value: true });
  const flow = await startFlow(user, 'microsoft', ['mail_read']);
  const link = await callback(await consent(flow.authUrl));
  assertEquals(link.searchParams.get('result'), 'admin_consent_required');
  assertFalse(link.searchParams.has('completion_code'));
  const rows = await q<{ status: string }>(
    `select status from public.connected_accounts where user_id = $1`,
    [user.id],
  );
  for (const row of rows) assertEquals(row.status, 'admin_consent_required');
  assert(i18n('states').includes('Kurumunun yöneticisi bu uygulamaya onay vermeli.'));
});

it('IT-OAUTH-07', 'Microsoft refresh rotation persists every new refresh token', async () => {
  const user = await createUser();
  const { accountId } = await connect(user, 'microsoft', ['mail_read']);
  const before = (await credentialRows(accountId)).find((r) => r.token_kind === 'refresh');
  assert(before !== undefined);
  for (let round = 0; round < 2; round++) {
    await expireAccess(accountId);
    const res = await manualSync(user, accountId);
    assertEquals(res.status, 202, await res.text());
    await releaseJobs();
    await drain({ types: ['outlook_sync', 'initial_sync'] });
  }
  const after = (await credentialRows(accountId)).find((r) => r.token_kind === 'refresh');
  assert(after !== undefined);
  assertNotEquals(
    new Uint8Array(after.ciphertext).join(','),
    new Uint8Array(before.ciphertext).join(','),
  );
  assertEquals(after.key_version, before.key_version);
  const refreshes = (await mock.requests('/ms-login')).filter(
    (r) => r.method === 'POST' && new URLSearchParams(r.body).get('grant_type') === 'refresh_token',
  );
  assert(refreshes.length >= 2, `refreshes: ${refreshes.length}`);
  // Every refresh used the token issued by the previous one (rotation), so none was refused.
  for (const r of refreshes) assertEquals(r.status, 200);
});

for (const provider of ['google', 'microsoft'] as const) {
  it(
    'IT-OAUTH-08',
    `invalid_grant on refresh (${provider}) → needs_reauth and one account notification`,
    async () => {
      const user = await createUser();
      const { accountId } = await connect(user, provider, ['mail_read']);
      if (provider === 'google') {
        const issued = await mock.google<{ refresh: [string, unknown][] }>({ op: 'state' });
        for (const [token] of issued.refresh) {
          await fetch(`${Deno.env.get('DA_IT_MOCK_URL')}/google-oauth/revoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
          }).then((r) => r.body?.cancel());
        }
      } else {
        await mock.graph({ op: 'invalidate_refresh' });
      }
      for (let round = 0; round < 2; round++) {
        await expireAccess(accountId);
        await manualSync(user, accountId);
        await releaseJobs();
        await drain();
      }
      const acct = await account(accountId);
      assertEquals(acct.status, 'needs_reauth');
      const notes = await q<{ title_rendered: string | null; decision: string }>(
        `select title_rendered, decision from public.notifications where user_id = $1 and category = 'account'`,
        [user.id],
      );
      assertEquals(notes.length, 1, JSON.stringify(notes));
      const service = provider === 'google' ? 'Gmail' : 'Outlook';
      if (notes[0]?.title_rendered !== null)
        assertEquals(notes[0]?.title_rendered, `${service} bağlantısı yenilenmeli.`);
      assert(i18n('states').includes('{service} bağlantısı yenilenmeli.'));
    },
  );
}

it(
  'IT-OAUTH-09',
  'Google disconnect: stop → channels.stop → revoke → ciphertext deleted → purge → audit',
  async () => {
    const user = await createUser();
    const { accountId } = await connect(user, 'google', ['mail_read', 'calendar_read']);
    await releaseJobs();
    await drain();
    const channels = await mock.google<{ channels: unknown[] }>({ op: 'state' });
    const res = await call('api', 'POST', `/integrations/${accountId}/disconnect`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { confirm: true, purge_content: true },
    });
    const out = await json<{ data: { revocation: string; purge_job: { job_id: string } } }>(res);
    assertEquals(res.status, 200, JSON.stringify(out));
    assertEquals(out.data.revocation, 'provider_revoked');
    const seq = (await mock.requests()).filter((r) => r.method === 'POST');
    const at = (pred: (p: string) => boolean) => seq.findIndex((r) => pred(r.path));
    const stop = at((p) => p.endsWith('/gmail/v1/users/me/stop'));
    const revoke = at((p) => p === '/google-oauth/revoke');
    assert(stop >= 0 && revoke > stop, `stop ${stop} revoke ${revoke}`);
    const stops = seq.filter((r) => r.path === '/calendar/v3/channels/stop');
    assert(channels.channels.length >= 1, 'a calendar channel to stop');
    assertEquals(stops.length, channels.channels.length);
    for (const s of stops) assert(seq.indexOf(s) < revoke);
    assertEquals(
      await count(`select 1 from public.oauth_credentials where connected_account_id = $1`, [
        accountId,
      ]),
      0,
    );
    assertEquals((await account(accountId)).status, 'disconnected');
    assertEquals(
      await count(`select 1 from public.jobs where id = $1 and type = 'integration_purge'`, [
        out.data.purge_job.job_id,
      ]),
      1,
    );
    const audit = await one<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where action = 'user.integration.disconnected' and target_id = $1`,
      [accountId],
    );
    assertEquals(audit.details.revocation, 'provider_revoked');
  },
);

it(
  'IT-OAUTH-10',
  'Microsoft disconnect deletes every subscription and records local_only',
  async () => {
    const user = await createUser();
    const { accountId } = await connect(user, 'microsoft', ['mail_read']);
    await releaseJobs();
    await drain();
    const subs = await mock.graph<{ subscriptions: { id: string }[] }>({ op: 'state' });
    const res = await call('api', 'POST', `/integrations/${accountId}/disconnect`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { confirm: true, purge_content: true },
    });
    const out = await json<{ data: { revocation: string } }>(res);
    assertEquals(res.status, 200, JSON.stringify(out));
    assertEquals(out.data.revocation, 'local_only');
    const deletes = (await mock.requests('/graph/v1.0/subscriptions')).filter(
      (r) => r.method === 'DELETE',
    );
    assertEquals(deletes.length, subs.subscriptions.length);
    assertEquals(
      await count(`select 1 from public.oauth_credentials where connected_account_id = $1`, [
        accountId,
      ]),
      0,
    );
    const audit = await one<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where action = 'user.integration.disconnected' and target_id = $1`,
      [accountId],
    );
    assertEquals(audit.details.revocation, 'local_only');
  },
);

it('IT-OAUTH-11', 'Apple exchange stores the SIWA refresh token encrypted', async () => {
  const sub = `001234.${crypto.randomUUID().replace(/-/g, '')}.1234`;
  const user = await createUser({ appleSub: sub });
  assertEquals(
    (await one<{ s: string }>(`select public.user_apple_sub($1) as s`, [user.id])).s,
    sub,
  );
  await mock.apple({ op: 'identity', sub });
  const res = await call('api', 'POST', '/auth/apple/exchange', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { authorization_code: 'c1a2b3c4d5e6f7.0.mock.apple', identity_token_sub: sub },
  });
  const out = await json<{ data: { stored: boolean } }>(res);
  assertEquals(res.status, 200, JSON.stringify(out));
  assertEquals(out.data.stored, true);
  const apple = await mock.apple<{
    refresh: [string, boolean][];
    secrets: { header: { alg: string; kid: string } }[];
  }>();
  const refresh = apple.refresh[0]?.[0] ?? '';
  assertEquals(apple.secrets[0]?.header.alg, 'ES256');
  const rows = await q<{ row: string }>(
    `select row_to_json(c)::text as row from public.oauth_credentials c where user_id = $1 and token_kind = 'apple_siwa_refresh'`,
    [user.id],
  );
  assertEquals(rows.length, 1);
  assertFalse(rows[0]?.row.includes(refresh));
  // A foreign identity sub is refused.
  const foreign = await call('api', 'POST', '/auth/apple/exchange', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { authorization_code: 'c1a2b3c4d5e6f7.0.mock.apple', identity_token_sub: '009999.other' },
  });
  assertEquals(foreign.status, 422);
});

it('IT-OAUTH-12', 'demo OAuth runs the real state / PKCE / completion path', async () => {
  const user = await createUser();
  const flow = await startFlow(user, 'google', ['mail_read', 'calendar_read'], { overrides: DEMO });
  const auth = new URL(flow.authUrl);
  assert(auth.pathname.endsWith('/functions/v1/oauth/demo/authorize'), auth.pathname);
  const authorize = await call('oauth', 'GET', `/demo/authorize${auth.search}`, {
    overrides: DEMO,
  });
  await authorize.body?.cancel();
  assertEquals(authorize.status, 302);
  const next = new URL(authorize.headers.get('location') ?? '');
  assert(next.pathname.endsWith('/functions/v1/oauth/demo/callback'), next.pathname);
  const link = await callback(`/demo/callback${next.search}`, DEMO);
  assertEquals(link.searchParams.get('result'), 'pending_confirmation');
  const done = await complete(
    user,
    link.searchParams.get('completion_code') ?? '',
    flow.deviceNonce,
    DEMO,
  );
  assertEquals(done.status, 200, JSON.stringify(done.body));
  const acct = await account(String((done.body.data as { account: { id: string } }).account.id));
  assertEquals(acct.provider, 'demo');
  assertEquals(acct.demo_flavor, 'google');
  const state = await one<{ code_verifier_ciphertext: unknown; completed_at: string | null }>(
    `select * from public.oauth_states where id = $1`,
    [flow.stateId],
  );
  assert(state.completed_at !== null);
});

async function pendingFlow(user: Awaited<ReturnType<typeof createUser>>) {
  const tag = crypto.randomUUID().replace(/-/g, '');
  await mock.google({
    op: 'identity',
    identity: {
      sub: `2${BigInt(`0x${tag.slice(0, 15)}`)}`,
      email: `it.${tag.slice(0, 8)}@example.com`,
    },
  });
  const flow = await startFlow(user, 'google', ['mail_read']);
  const link = await callback(await consent(flow.authUrl));
  const row = await one<{ connected_account_id: string }>(
    `select connected_account_id from public.oauth_states where id = $1`,
    [flow.stateId],
  );
  return {
    flow,
    code: link.searchParams.get('completion_code') ?? '',
    accountId: row.connected_account_id,
  };
}

async function assertNotFinalised(accountId: string): Promise<void> {
  const rows = await q<{ status: string }>(
    `select status from public.connected_accounts where id = $1`,
    [accountId],
  );
  for (const row of rows) assertEquals(row.status, 'connecting');
  assertEquals(
    await count(
      `select 1 from public.jobs where type = 'initial_sync' and connected_account_id = $1`,
      [accountId],
    ),
    0,
  );
}

it('IT-OAUTH-13', 'completion binding negatives and the abandoned-connect revoke', async () => {
  const a = await createUser({ pro: true });
  const b = await createUser({ pro: true });
  // User B presenting user A's completion code.
  const p1 = await pendingFlow(a);
  assertEquals((await complete(b, p1.code, p1.flow.deviceNonce)).status, 403);
  await assertNotFinalised(p1.accountId);
  // A wrong device nonce.
  const p2 = await pendingFlow(a);
  assertEquals((await complete(a, p2.code, `${p2.flow.deviceNonce.slice(0, -2)}xx`)).status, 403);
  await assertNotFinalised(p2.accountId);
  // A code older than 10 minutes.
  const p3 = await pendingFlow(a);
  await q(
    `update public.oauth_states set used_at = used_at - interval '11 minutes' where id = $1`,
    [p3.flow.stateId],
  );
  assertEquals((await complete(a, p3.code, p3.flow.deviceNonce)).status, 403);
  await assertNotFinalised(p3.accountId);
  // A replayed code after a successful completion.
  const p4 = await pendingFlow(a);
  assertEquals((await complete(a, p4.code, p4.flow.deviceNonce)).status, 200);
  const jobs = await count(
    `select 1 from public.jobs where type = 'initial_sync' and connected_account_id = $1`,
    [p4.accountId],
  );
  assertEquals((await complete(a, p4.code, p4.flow.deviceNonce)).status, 403);
  assertEquals(
    await count(
      `select 1 from public.jobs where type = 'initial_sync' and connected_account_id = $1`,
      [p4.accountId],
    ),
    jobs,
  );
  // Every rejection was audited.
  assert(
    (await count(
      `select 1 from public.audit_logs where action = 'security.oauth_completion_rejected' and actor_id = any($1::uuid[])`,
      [[a.id, b.id]],
    )) >= 4,
  );

  // An account left without completion: the binding window ends → scheduler_tick → integration_purge
  // revokes the unbound token once, deletes the ciphertext and the row.
  const p5 = await pendingFlow(a);
  await mock.reset();
  await q(
    `update public.connected_accounts set pending_binding_until = now() - interval '1 minute' where id = $1`,
    [p5.accountId],
  );
  await q(`select private.scheduler_tick(now())`);
  await releaseJobs(`type = 'integration_purge'`);
  await drain({ types: ['integration_purge'] });
  const purge = await q(
    `select status, result, last_error_code from public.jobs where type = 'integration_purge' and connected_account_id = $1`,
    [p5.accountId],
  );
  assertEquals((await mock.requests('/google-oauth/revoke')).length, 1, JSON.stringify(purge));
  assertEquals(
    await count(`select 1 from public.oauth_credentials where connected_account_id = $1`, [
      p5.accountId,
    ]),
    0,
  );
  assertEquals(
    await count(`select 1 from public.connected_accounts where id = $1`, [p5.accountId]),
    0,
  );
});
