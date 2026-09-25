/**
 * IT-PRIV-* (TEST_PLAN §6.9; API_CONTRACTS API-PRV-01…04, JOB-20…23; SECURITY_AND_PRIVACY_PLAN §4)
 * and the account-deletion halves of IT-OAUTH-11 (SIWA revoke) and IT-RC-10 (RevenueCat delete).
 */
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  env,
  freshIdentities,
  it,
  json,
  makePro,
  mock,
  one,
  q,
  releaseJobs,
  type TestUser,
} from './_harness/mod.ts';
import { syncedGoogle } from './_harness/sync.ts';

/** A token with a fresh `amr` entry (API_CONTRACTS §3 `recent_auth`). */
function recent(user: TestUser): Promise<string> {
  return user.token({ amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) - 30 }] });
}

async function userTables(): Promise<string[]> {
  const rows = await q<{ table_name: string }>(
    `select c.table_name from information_schema.columns c join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'user_id' order by 1`,
  );
  return rows.map((r) => r.table_name);
}

/** Row counts per user-owned table (a schema-driven fingerprint of one user's data). */
async function fingerprint(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await userTables())
    out[table] = await count(`select 1 from public."${table}" where user_id = $1`, [userId]);
  return out;
}

async function seeded(): Promise<{ user: TestUser; accountId: string }> {
  await freshIdentities();
  const user = await createUser({ pro: true });
  const accountId = await syncedGoogle(user);
  await q(
    `insert into public.contacts (user_id, display_name, emails, source) values ($1, 'Mehmet Yılmaz', '{mehmet@yilmazendustri.example}', 'manual')`,
    [user.id],
  ).catch(() => undefined);
  return { user, accountId };
}

it(
  'IT-PRIV-01',
  'retention with time travel removes expired rows (and their embeddings) and keeps the rest',
  async () => {
    const { user } = await seeded();
    const other = await seeded();
    const threads = await q<{ id: string }>(
      `select id from public.email_threads where user_id = $1 order by last_message_at limit 2`,
      [user.id],
    );
    assert(threads.length === 2);
    const expired = threads[0]?.id as string;
    const kept = threads[1]?.id as string;
    // The expired thread (and its messages and insights) fall past their retention.
    await q(
      `update public.email_messages set expires_at = now() - interval '1 day' where thread_id = $1`,
      [expired],
    );
    await q(`update public.email_threads set expires_at = now() - interval '1 day' where id = $1`, [
      expired,
    ]);
    await q(
      `update public.insights set expires_at = now() - interval '1 day' where entity_id = $1`,
      [expired],
    );
    await q(`delete from public.jobs where status in ('queued', 'retrying')`);
    const before = await fingerprint(other.user.id);
    const keptMessages = await count(`select 1 from public.email_messages where thread_id = $1`, [
      kept,
    ]);
    await q(`select private.enqueue_job('retention', $1, '{"mode":"sweep"}'::jsonb)`, [
      `retention:it:${crypto.randomUUID()}`,
    ]);
    await releaseJobs();
    await drain({ types: ['retention'] });
    assertEquals(await count(`select 1 from public.email_threads where id = $1`, [expired]), 0);
    assertEquals(
      await count(`select 1 from public.email_messages where thread_id = $1`, [expired]),
      0,
    );
    assertEquals(await count(`select 1 from public.insights where entity_id = $1`, [expired]), 0);
    assertEquals(
      await count(`select 1 from public.memory_chunks where source_id = $1::text`, [expired]).catch(
        () => 0,
      ),
      0,
    );
    assertEquals(
      await count(`select 1 from public.email_messages where thread_id = $1`, [kept]),
      keptMessages,
    );
    assertEquals(await fingerprint(other.user.id), before);
    const audit = await one<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where action = 'system.retention.run' order by chain_seq desc limit 1`,
    );
    assert(JSON.stringify(audit.details).length > 2);
  },
);

it(
  'IT-PRIV-02',
  'export: ZIP entries + manifest hashes, no secrets, 300 s signed URL, audited',
  async () => {
    const { user } = await seeded();
    const res = await call('api', 'POST', '/privacy/export', {
      jwt: await recent(user),
      key: crypto.randomUUID(),
      body: {},
    });
    const out = await json<{ data: { request_id: string } }>(res);
    assertEquals(res.status, 202, JSON.stringify(out));
    await releaseJobs();
    await drain({ types: ['export', 'notification', 'transactional_email'] });
    const request = await one<{ status: string }>(
      `select status from public.data_export_requests where id = $1`,
      [out.data.request_id],
    );
    assertEquals(request.status, 'ready');
    const download = await call('api', 'POST', `/privacy/export/${out.data.request_id}/download`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {},
    });
    const link = await json<{ data: { signed_url: string; expires_at: string; sha256: string } }>(
      download,
    );
    assertEquals(download.status, 200, JSON.stringify(link));
    const ttl = (Date.parse(link.data.expires_at) - Date.now()) / 1000;
    assert(ttl > 250 && ttl <= 300, `signed URL TTL ${ttl}`);
    const zip = new Uint8Array(await (await fetch(link.data.signed_url)).arrayBuffer());
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(zip);
    const names = Object.keys(files);
    assert(names.includes('manifest.json'), names.join(','));
    const manifest = JSON.parse(strFromU8(files['manifest.json'] as Uint8Array)) as {
      files?: { path: string; sha256: string }[];
    };
    for (const f of manifest.files ?? []) {
      const data = files[f.path];
      assert(data !== undefined, f.path);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      assertEquals(digest, f.sha256, f.path);
    }
    for (const [name, data] of Object.entries(files)) {
      const text = strFromU8(data);
      assert(!/"(access_token|refresh_token|ciphertext|secret|password)"\s*:/i.test(text), name);
    }
    assert(
      (await count(
        `select 1 from public.audit_logs where target_user_id = $1 and action like '%export%'`,
        [user.id],
      )) >= 1,
    );
  },
  { needs: ['storage'] },
);

it(
  'IT-PRIV-03',
  'history deletion: REAUTH_REQUIRED first; then the analysis set goes and the preserved set stays',
  async () => {
    const { user, accountId } = await seeded();
    const other = await seeded();
    const otherBefore = await fingerprint(other.user.id);
    const stale = await call('api', 'POST', '/privacy/delete-history', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { scope: { type: 'all_analysis' }, confirm: true },
    });
    const staleBody = await json<{ error: { code: string; details: { max_age_seconds: number } } }>(
      stale,
    );
    assertEquals(stale.status, 401);
    assertEquals(staleBody.error.code, 'REAUTH_REQUIRED');
    assertEquals(staleBody.error.details.max_age_seconds, 600);
    const insightsBefore = await count(`select 1 from public.insights where user_id = $1`, [
      user.id,
    ]);
    assert(insightsBefore >= 1);
    const res = await call('api', 'POST', '/privacy/delete-history', {
      jwt: await recent(user),
      key: crypto.randomUUID(),
      body: { scope: { type: 'all_analysis' }, confirm: true },
    });
    const out = await json<{ data: { will_delete: Record<string, number>; preserved: string[] } }>(
      res,
    );
    assertEquals(res.status, 202, JSON.stringify(out));
    assertEquals(out.data.will_delete.insights, insightsBefore);
    for (const kept of ['connections', 'settings', 'vip', 'priority_rules'])
      assert(out.data.preserved.includes(kept), kept);
    await releaseJobs();
    await drain({ types: ['history_deletion'] });
    for (const table of [
      'insights',
      'briefings',
      'briefing_items',
      'memory_chunks',
      'learned_preferences',
      'assistant_messages',
    ])
      assertEquals(
        await count(`select 1 from public."${table}" where user_id = $1`, [user.id]),
        0,
        table,
      );
    assertEquals(
      await count(`select 1 from public.connected_accounts where id = $1`, [accountId]),
      1,
    );
    assertEquals(
      await count(`select 1 from public.user_preferences where user_id = $1`, [user.id]),
      1,
    );
    assertEquals(await fingerprint(other.user.id), otherBefore);
  },
);

async function requestDeletion(user: TestUser): Promise<string> {
  const res = await call('api', 'POST', '/privacy/delete-account', {
    jwt: await recent(user),
    key: crypto.randomUUID(),
    body: { confirm_text: 'SİL', acknowledge_subscription: true, reason: 'privacy' },
  });
  const out = await json<{
    data: { request_id: string; subscription_notice: { active: boolean } };
  }>(res);
  assertEquals(res.status, 202, JSON.stringify(out));
  assertEquals(out.data.subscription_notice.active, true);
  return out.data.request_id;
}

it(
  'IT-RC-10',
  'account deletion revokes Google, SIWA and deletes the RevenueCat customer; the notice says the store subscription continues',
  async () => {
    const sub = `001234.${crypto.randomUUID().replace(/-/g, '')}.1234`;
    const user = await createUser({ appleSub: sub });
    await makePro(user.id);
    await mock.apple({ op: 'identity', sub });
    const exchange = await call('api', 'POST', '/auth/apple/exchange', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { authorization_code: 'c1a2b3c4d5e6f7.0.mock.apple', identity_token_sub: sub },
    });
    assertEquals(exchange.status, 200, await exchange.text());
    await syncedGoogle(user);
    await mock.revenuecat({
      op: 'customer',
      id: user.id,
      fixture: 'revenuecat/customer_v2_active.json',
    });
    // Without the acknowledgement an active subscription blocks the request.
    const unacknowledged = await call('api', 'POST', '/privacy/delete-account', {
      jwt: await recent(user),
      key: crypto.randomUUID(),
      body: { confirm_text: 'SİL', acknowledge_subscription: false },
    });
    await unacknowledged.body?.cancel();
    assertEquals(unacknowledged.status, 422);
    const requestId = await requestDeletion(user);
    for (let i = 0; i < 4; i++) {
      await releaseJobs();
      await drain({ types: ['account_deletion'], rounds: 1 });
    }
    const google = (await mock.requests('/google-oauth/revoke')).length;
    const apple = await mock.requests('/apple/auth/revoke');
    const rc = (
      await mock.requests(`/revenuecat/v2/projects/projintegration/customers/${user.id}`)
    ).filter((r) => r.method === 'DELETE');
    assertEquals(google, 1);
    assertEquals(apple.length, 1);
    assertEquals(rc.length, 1);
    const order = (await mock.requests()).filter(
      (r) =>
        r.path === '/google-oauth/revoke' ||
        r.path === '/apple/auth/revoke' ||
        r.method === 'DELETE',
    );
    assertEquals(
      order.map((r) => r.path.split('/')[1]),
      ['google-oauth', 'apple', 'revenuecat'],
    );
    const request = await one<{ status: string; steps: Record<string, unknown> }>(
      `select status, steps from public.data_deletion_requests where id = $1`,
      [requestId],
    );
    assertEquals(request.steps.revenuecat_deleted, 'deleted');
    // The request completes only after the storage purge and the Auth user delete.
    for (let i = 0; i < 6 && request.status !== 'completed'; i++) {
      await releaseJobs();
      await drain({ types: ['account_deletion'], rounds: 1 });
      request.status = (
        await one<{ status: string }>(
          `select status from public.data_deletion_requests where id = $1`,
          [requestId],
        )
      ).status;
    }
    assertEquals(request.status, 'completed');
    assertEquals(await count(`select 1 from auth.users where id = $1`, [user.id]), 0);
  },
  { needs: ['gotrue', 'storage'] },
);

it(
  'IT-PRIV-04',
  'account deletion: every step against the mocks, zero rows left, resumable, never completed early',
  async () => {
    const user = await createUser({ pro: true });
    await syncedGoogle(user);
    await mock.revenuecat({
      op: 'customer',
      id: user.id,
      fixture: 'revenuecat/customer_v2_active.json',
    });
    const requestId = await requestDeletion(user);
    // An injected crash between steps: the first attempt dies after the provider teardown.
    await mock.script('POST /apple/auth/revoke', [{ status: 503, times: 1 }]);
    await releaseJobs();
    await drain({ types: ['account_deletion'], rounds: 1 });
    const midway = await one<{ status: string }>(
      `select status from public.data_deletion_requests where id = $1`,
      [requestId],
    );
    assertNotEquals(midway.status, 'completed');
    for (let i = 0; i < 6; i++) {
      await releaseJobs();
      await drain({ types: ['account_deletion'], rounds: 1 });
    }
    const done = await one<{ status: string }>(
      `select status from public.data_deletion_requests where id = $1`,
      [requestId],
    );
    assertEquals(done.status, 'completed');
    for (const [table, n] of Object.entries(await fingerprint(user.id))) {
      if (['data_deletion_requests', 'audit_logs', 'privacy_tombstones'].includes(table)) continue;
      assertEquals(n, 0, table);
    }
    assertEquals(await count(`select 1 from auth.users where id = $1`, [user.id]), 0);
    assertEquals((await mock.requests('/gmail/v1/users/me/stop')).length >= 1, true);
  },
  { needs: ['gotrue', 'storage'] },
);

it('IT-PRIV-05', 'cross-tenant: every job run for user A leaves user B untouched', async () => {
  const a = await seeded();
  const b = await seeded();
  // Only the jobs of this test run: B's own scheduled polls are not A's doing.
  await q(`delete from public.jobs where status in ('queued', 'retrying')`);
  const before = await fingerprint(b.user.id);
  const bInsights = await q(
    `select id, status, updated_at from public.insights where user_id = $1 order by id`,
    [b.user.id],
  );
  const jobs: [string, Record<string, unknown>][] = [
    ['insight_refresh', { user_id: a.user.id, scope: 'all', reason: 'it' }],
    ['retention', { mode: 'recompute', user_id: a.user.id }],
    ['billing_sync', { user_id: a.user.id, reason: 'reconcile' }],
    ['referral_evaluate', { user_id: a.user.id }],
  ];
  await mock.revenuecat({
    op: 'customer',
    id: a.user.id,
    fixture: 'revenuecat/customer_v2_active.json',
  });
  for (const [type, payload] of jobs)
    await q(`select private.enqueue_job($1::public.job_type, $2, $3::text::jsonb, $4::uuid)`, [
      type,
      `it:${type}:${crypto.randomUUID()}`,
      JSON.stringify(payload),
      a.user.id,
    ]);
  const history = await call('api', 'POST', '/privacy/delete-history', {
    jwt: await recent(a.user),
    key: crypto.randomUUID(),
    body: { scope: { type: 'all_analysis' }, confirm: true },
  });
  assertEquals(history.status, 202, await history.text());
  await q(`delete from public.rate_limits`);
  await call('api', 'POST', `/integrations/${a.accountId}/sync`, {
    jwt: a.user.jwt,
    body: { resources: ['mail'] },
  }).then((r) => r.body?.cancel());
  await releaseJobs();
  await drain();
  assertEquals(await fingerprint(b.user.id), before);
  assertEquals(
    JSON.stringify(
      await q(`select id, status, updated_at from public.insights where user_id = $1 order by id`, [
        b.user.id,
      ]),
    ),
    JSON.stringify(bInsights),
  );
  assertEquals(await count(`select 1 from public.insights where user_id = $1`, [a.user.id]), 0);
  void env;
});
