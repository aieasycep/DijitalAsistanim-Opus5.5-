/**
 * THR-12 Admin abuse (SECURITY_AND_PRIVACY_PLAN §2 THR-12, CTL-3.8; M§47–49, M§66; R-09; TEST_PLAN
 * TST-DB-07, TST-EF-22). The SQL gates (masking, reveal audit, time-boxed Support Access, the
 * append-only hash chain) are proven in `300_threats_admin.test.sql` and `121_audit_admin_guard`.
 * Here the `admin-api` and `health` layers in front of them:
 * - list rows are contract-mapped, so even an unmasked column from SQL never reaches the browser;
 * - a PII reveal needs a reason and an explicit confirm, is rate-limited, never replayed and never
 *   logged; Support Access grants are 15/30/60 minutes over enumerated scopes only;
 * - there is no impersonation route and no admin code path that touches provider credentials;
 * - the audit-chain health probe turns a tampered chain into a `down` component.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { adminRoutes } from '@da/validation';
import { auditChainProbe } from '../../health/probes/audit_chain.ts';
import { supabaseHealthData } from '../../health/data.ts';
import { testDb } from '../../_shared/testing/db.ts';
import { jsonResponse, stubFetch } from '../../_shared/testing/fetch.ts';
import { createHarness } from '../../admin-api/tests/harness.ts';

const USER = '00000000-0000-4000-8000-000000000001';
const REASON = 'Kullanıcı destek talebinde e-posta adresini doğrulamamızı istedi.';

async function errorOf(res: Response) {
  const body = await res.json();
  return { status: res.status, code: body.error?.code as string, details: body.error?.details };
}

Deno.test(
  'THR-12: user lists only ever carry the masked e-mail, whatever SQL returns',
  async () => {
    const h = await createHarness({
      sql: {
        users_list: () => ({
          rows: [
            {
              id: USER,
              email_masked: 'yu***@gmail.com',
              email: 'yunus.raw@gmail.com',
              display_name: 'Yunus Emre',
              phone: '+905321112233',
              plan: 'pro',
              is_trial: false,
              created_at: '2026-09-01T09:00:00Z',
              last_active_at: null,
              platform: 'ios',
              connected_accounts: 1,
              last_sync_at: null,
              status: 'active',
            },
          ],
          total: 1,
          page: 1,
          page_size: 25,
        }),
      },
    });
    const res = await h.request('GET', '/users');
    assertEquals(res.status, 200);
    const text = await res.text();
    assert(text.includes('yu***@gmail.com'));
    for (const raw of ['yunus.raw@gmail.com', 'Yunus Emre', '+905321112233']) {
      assertFalse(text.includes(raw), `list leaked ${raw}`);
    }
  },
);

Deno.test(
  'THR-12: a PII reveal needs a reason and confirm, is rate-limited, not replayable and never logged',
  async () => {
    const reveal = {
      user_reveal_email: () => ({ value: 'yunus.raw@gmail.com', expires_in_s: 60 }),
    };
    const h = await createHarness({ sql: reveal });
    for (const body of [
      { field: 'email', confirm: true },
      { field: 'email', reason: 'kısa', confirm: true },
      { field: 'email', reason: REASON },
      { field: 'phone', reason: REASON, confirm: true },
    ]) {
      const res = await h.request('POST', `/users/${USER}/reveal`, { body });
      assertEquals(res.status, 422, JSON.stringify(body));
      await res.body?.cancel();
    }
    assertFalse(h.rpcNames().includes('user_reveal_email'), 'no reveal without reason + confirm');

    const key = crypto.randomUUID();
    const ok = await h.request('POST', `/users/${USER}/reveal`, {
      body: { field: 'email', reason: REASON, confirm: true },
      headers: { 'Idempotency-Key': key },
    });
    assertEquals(ok.status, 200);
    assertEquals(ok.headers.get('Cache-Control'), 'no-store');
    assertEquals((await ok.json()).data.expires_in_s, 60);
    const call = h.rpc.find((r) => r.fn === 'user_reveal_email');
    assertEquals(call?.args.p_reason, REASON, 'the reason reaches the audited SQL function');
    const replay = await errorOf(
      await h.request('POST', `/users/${USER}/reveal`, {
        body: { field: 'email', reason: REASON, confirm: true },
        headers: { 'Idempotency-Key': key },
      }),
    );
    assertEquals([replay.status, replay.code], [409, 'IDEMPOTENCY_REPLAY']);
    assertFalse(
      JSON.stringify(h.logs()).includes('yunus.raw@gmail.com'),
      'revealed PII is not logged',
    );

    const limited = await createHarness({ sql: reveal, rateAllowed: false });
    const blocked = await limited.request('POST', `/users/${USER}/reveal`, {
      body: { field: 'email', reason: REASON, confirm: true },
    });
    assertEquals(blocked.status, 429);
    await blocked.body?.cancel();
    assertFalse(limited.rpcNames().includes('user_reveal_email'));
  },
);

Deno.test(
  'THR-12 / R-09: Support Access is time-boxed (15/30/60) over enumerated scopes, with a reason',
  async () => {
    const h = await createHarness({
      sql: {
        support_access_grant: () => ({ id: USER, scope: ['pii'], starts_at: '', expires_at: '' }),
      },
    });
    for (const body of [
      { user_id: USER, scopes: ['pii'], reason: REASON, duration_minutes: 240 },
      { user_id: USER, scopes: ['pii'], reason: REASON, duration_minutes: 0 },
      { user_id: USER, scopes: ['mail_original_view'], reason: REASON, duration_minutes: 15 },
      { user_id: USER, scopes: ['oauth_credentials'], reason: REASON, duration_minutes: 15 },
      { user_id: USER, scopes: [], reason: REASON, duration_minutes: 15 },
      { user_id: USER, scopes: ['pii', 'pii'], reason: REASON, duration_minutes: 15 },
      { user_id: USER, scopes: ['pii'], duration_minutes: 15 },
    ]) {
      const res = await h.request('POST', '/support-access/grants', { body });
      assertEquals(res.status, 422, JSON.stringify(body));
      await res.body?.cancel();
    }
    assertFalse(h.rpcNames().includes('support_access_grant'));
  },
);

Deno.test('THR-12: no impersonation route and no admin path to provider credentials', async () => {
  for (const key of Object.keys(adminRoutes)) {
    assertFalse(/impersonat|login-as|sudo|token|credential/i.test(key), key);
  }
  const root = new URL('../../admin-api/', import.meta.url);
  const files: string[] = [];
  const walk = async (dir: URL) => {
    for await (const entry of Deno.readDir(dir)) {
      const url = new URL(entry.name + (entry.isDirectory ? '/' : ''), dir);
      if (entry.isDirectory && entry.name !== 'tests') await walk(url);
      else if (entry.isFile && entry.name.endsWith('.ts')) files.push(url.pathname);
    }
  };
  await walk(root);
  assert(files.length > 10);
  for (const file of files) {
    const source = await Deno.readTextFile(file);
    assertFalse(/oauth_credentials|decryptToken|createTokenSource/.test(source), file);
  }
});

Deno.test('THR-12 / M§66: the audit-chain probe reports a tampered chain as down', async () => {
  for (const verdict of [
    { ok: true, checked: 1000, first_bad_seq: null },
    { ok: false, checked: 412, first_bad_seq: 5412 },
  ]) {
    const stub = stubFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname === '/rest/v1/rpc/audit_verify_chain') return jsonResponse([verdict]);
      if (url.pathname === '/rest/v1/audit_logs') return jsonResponse({ chain_seq: 6000 });
      return new Response('unexpected', { status: 599 });
    });
    const out = await auditChainProbe({
      raw: {},
      data: supabaseHealthData(testDb(stub.fetch)),
      fetch: stub.fetch,
      now: () => new Date('2026-09-24T08:00:00Z'),
      timeoutMs: 1000,
      demo: { enabled: false } as never,
      baseUrl: null,
    } as never);
    const result = Array.isArray(out) ? out[0] : out;
    assert(result !== undefined);
    const rpc = stub.calls.find((c) => c.url.endsWith('/rpc/audit_verify_chain'));
    assertEquals(JSON.parse(rpc?.body ?? '{}'), { p_from: 5001, p_to: 6000 });
    if (verdict.ok) {
      assertEquals([result.status, result.detailCode], ['healthy', null]);
    } else {
      assertEquals([result.status, result.detailCode], ['down', 'chain_broken']);
      assertEquals(result.detail?.first_bad_seq, 5412);
    }
  }
});
