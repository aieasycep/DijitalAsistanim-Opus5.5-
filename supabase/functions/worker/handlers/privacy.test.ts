/**
 * Privacy jobs through the job runner (TEST_PLAN TST-EF-16 export, TST-EF-17 history deletion,
 * TST-EF-18 account deletion, TST-EF-19 retention, TST-EF-20 cross-tenant; API_CONTRACTS
 * JOB-20…JOB-23, JOB-31).
 */
import { assert, assertEquals, assertFalse, assertMatch, assertNotEquals } from '@std/assert';
import { unzipSync } from 'fflate';
import { AppError } from '../../_shared/errors.ts';
import { encryptToken, loadKeyring, type TokenKeyring } from '../../_shared/crypto/token-cipher.ts';
import { createRegistry } from '../../_shared/jobs/registry.ts';
import { runWorker } from '../../_shared/jobs/runner.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import type { AuditEntry } from '../../_shared/services/audit.ts';
import { SIWA_PROVIDER } from '../../_shared/services/apple.ts';
import { deletionRequestRecipient } from '../../_shared/email/deletion-request.ts';
import { transactionalEmailJob } from '../../_shared/email/transactional.ts';
import type { EmailMessage } from '../../_shared/email/types.ts';
import type { Revocation } from '../../_shared/services/privacy/account-deletion.ts';
import { FORBIDDEN_KEY, SECRET_VALUE_PATTERNS } from '../../_shared/services/privacy/export.ts';
import { memoryCredentials } from '../../_shared/testing/credentials.ts';
import { randomBase64, testEnv } from '../../_shared/testing/env.ts';
import { testDb } from '../../_shared/testing/db.ts';
import { forbiddenFetch } from '../../_shared/testing/fetch.ts';
import { memoryJobsRepo } from '../../_shared/testing/jobs.ts';
import { memoryObjectStore, memoryPrivacyRepo, stepsOf } from '../../_shared/testing/privacy.ts';
import { privacyJobDefinitions } from './privacy.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GOOGLE = '33333333-3333-4333-8333-333333333333';
const MICROSOFT = '44444444-4444-4444-8444-444444444444';
const DEVICE = '55555555-5555-4555-8555-555555555555';
const INSTALLATION = '66666666-6666-4666-8666-666666666666';
const START = Date.parse('2026-09-24T08:00:00Z');
const OAUTH_REFRESH = ['1', '', 'Oa3F7yZr9Kq2Lm5Nx8Pw1Tv4Hb6Jc0Gd'].join('/');
const OAUTH_ACCESS = ['ya29', 'a0AfB_byC3dEfGhIjKlMnOpQrStUv'].join('.');

interface Options {
  readonly teardown?: Record<string, Revocation>;
  readonly revenueCat?: () => Promise<'deleted' | 'not_found'>;
  readonly apple?: boolean;
  readonly emailConfigured?: boolean;
  readonly maxAttempts?: number;
}

async function setup(options: Options = {}) {
  let now = START;
  const jobs = memoryJobsRepo(() => now);
  const repo = memoryPrivacyRepo();
  const store = memoryObjectStore();
  const audit: AuditEntry[] = [];
  const credentials = memoryCredentials();
  const keyring: TokenKeyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const torn: string[] = [];
  const revoked: string[] = [];
  const auth = { banned: [] as string[], deleted: [] as string[] };
  const rcCalls: string[] = [];
  const writer = { append: (entry: AuditEntry) => Promise.resolve(void audit.push(entry)) };
  const registry = createRegistry(
    privacyJobDefinitions({
      export: { repo, store, audit: writer },
      retention: { repo, store, audit: writer },
      account: {
        repo,
        store,
        audit: writer,
        authAdmin: {
          ban: (id) => Promise.resolve(void auth.banned.push(id)),
          signOutOthers: () => Promise.resolve(true),
          deleteUser: (id) => Promise.resolve((auth.deleted.push(id), 'deleted' as const)),
        },
        teardown: ({ accountId }) => {
          torn.push(accountId);
          return Promise.resolve(options.teardown?.[accountId] ?? 'provider_revoked');
        },
        credentials,
        keyring: () => Promise.resolve(keyring),
        apple:
          options.apple === false
            ? null
            : { revoke: (token) => Promise.resolve((revoked.push(token), 'revoked' as const)) },
        revenueCat: (id) => {
          rcCalls.push(id);
          return options.revenueCat?.() ?? Promise.resolve('deleted' as const);
        },
        pepper: { HASH_PEPPER: randomBase64(32) },
        emailConfigured: options.emailConfigured ?? true,
      },
    }),
  );
  const run = () =>
    runWorker({
      repo: jobs,
      registry,
      log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      now: () => now,
      random: () => 0.5,
    });
  /** Moves the queued jobs of the fake repository into the job queue. */
  const flush = async () => {
    for (const job of repo.enqueued.splice(0)) {
      await jobs.enqueue({ ...job, maxAttempts: options.maxAttempts ?? job.maxAttempts ?? 5 });
    }
  };
  return {
    jobs,
    repo,
    store,
    audit,
    credentials,
    keyring,
    torn,
    revoked,
    auth,
    rcCalls,
    run,
    flush,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function seedExportTables(repo: ReturnType<typeof memoryPrivacyRepo>) {
  repo.tables = {
    profiles: [{ user_id: USER, display_name: 'Yunus', locale: 'tr-TR', apple_sub_hash: 'x' }],
    connected_accounts: [
      { id: GOOGLE, user_id: USER, provider: 'google', account_email: 'yunus@gmail.example' },
      {
        id: MICROSOFT,
        user_id: OTHER,
        provider: 'microsoft',
        account_email: 'other@contoso.example',
      },
    ],
    insights: [{ id: crypto.randomUUID(), user_id: USER, title: 'Teklif yanıtı bekleniyor' }],
    memory_chunks: [
      {
        id: crypto.randomUUID(),
        user_id: USER,
        content: 'Kuzey Lojistik teklifi',
        embedding: [0.1, 0.2],
      },
    ],
    approval_actions: [
      {
        id: crypto.randomUUID(),
        user_id: USER,
        what: 'Yanıt gönder',
        payload: { body: 'Merhaba', refresh_token: OAUTH_REFRESH, note: OAUTH_ACCESS },
      },
    ],
    referrals: [
      { id: crypto.randomUUID(), referrer_id: USER, referee_id: OTHER, status: 'rewarded' },
    ],
    audit_logs: [{ id: 1, target_user_id: USER, action: 'user.privacy.export_requested' }],
  };
}

// ── JOB-21 export ─────────────────────────────────────────────────────────────

Deno.test(
  'export: a zip with one JSON per entity and a manifest, no token or secret fields (TST-EF-16)',
  async () => {
    const h = await setup();
    seedExportTables(h.repo);
    const created = await h.repo.createExportRequest(USER, null, null);
    await h.flush();
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    const row = h.repo.exports.get(created.request_id);
    assertEquals(row?.status, 'ready');
    assertEquals(row?.storage_path, `${USER}/${created.request_id}.zip`);
    assertEquals(Date.parse(row?.expires_at ?? '') - Date.parse(row?.ready_at ?? ''), 86_400_000);
    const blob = h.store.get('exports', `${USER}/${created.request_id}.zip`);
    assert(blob !== undefined);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const names = Object.keys(files);
    for (const expected of [
      'manifest.json',
      'profile.json',
      'insights.json',
      'memory.json',
      'approvals.json',
    ]) {
      assert(names.includes(expected), expected);
    }
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    assertEquals(manifest.export_id, created.request_id);
    assertEquals(manifest.schema_version, 1);
    const insightsEntry = manifest.files.find((f: { name: string }) => f.name === 'insights.json');
    assertEquals(insightsEntry.rows, 1);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', files['insights.json'] as Uint8Array)),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    assertEquals(insightsEntry.sha256, digest, 'manifest hashes match the files');

    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
      }
    };
    for (const [name, bytes] of Object.entries(files)) {
      const text = new TextDecoder().decode(bytes);
      walk(JSON.parse(text));
      for (const pattern of SECRET_VALUE_PATTERNS)
        assertFalse(pattern.test(text), `${name}: ${pattern}`);
      assertFalse(text.includes('other@contoso.example'), `${name} holds another user's data`);
      assertFalse(text.includes(OTHER), `${name} names the referral counterpart`);
    }
    assertEquals(
      keys.filter((k) => FORBIDDEN_KEY.test(k)),
      [],
      'no token, secret, hash or embedding keys',
    );
    const referrals = JSON.parse(new TextDecoder().decode(files['referrals.json']));
    assertEquals(referrals[0].side, 'referrer');
    const notif = h.jobs.byKey(`notif:${USER}:export_ready:${created.request_id}`);
    const build = (
      notif?.payload as { build: { template_key: string; params_public: Record<string, string> } }
    ).build;
    assertEquals(build.template_key, 'account.export_ready');
    assert(build.params_public.time_dat !== undefined, 'Turkish dative time is pre-inflected');
    assert(h.audit.some((a) => a.action === 'system.privacy.export_completed'));
  },
);

Deno.test('export: only the included sections; a resumed attempt only finalises', async () => {
  const h = await setup();
  seedExportTables(h.repo);
  const created = await h.repo.createExportRequest(USER, ['insights'], null);
  await h.flush();
  await h.run();
  const blob = h.store.get('exports', `${USER}/${created.request_id}.zip`);
  const names = Object.keys(unzipSync(new Uint8Array(await (blob as Blob).arrayBuffer()))).sort();
  assertEquals(names, ['insights.json', 'life_events.json', 'manifest.json']);

  // Crash after the upload checkpoint: status processing with path, size and digest stored.
  const again = await setup();
  const resumed = await again.repo.createExportRequest(USER, null, null);
  const row = again.repo.exports.get(resumed.request_id);
  assert(row !== undefined);
  again.repo.exports.set(resumed.request_id, {
    ...row,
    status: 'processing',
    storage_path: `${USER}/${resumed.request_id}.zip`,
    file_size_bytes: 123,
    sha256: 'ab'.repeat(32),
  });
  again.repo.tables = {};
  let reads = 0;
  const readRows = again.repo.readRows;
  again.repo.readRows = (...args) => {
    reads++;
    return readRows(...args);
  };
  await again.flush();
  const summary = await again.run();
  assertEquals(summary.completed, 1);
  assertEquals(reads, 0, 'the archive is not rebuilt');
  assertEquals(again.repo.exports.get(resumed.request_id)?.status, 'ready');
});

Deno.test(
  'export: the last failed attempt marks the request failed and notifies honestly',
  async () => {
    const h = await setup({ maxAttempts: 1 });
    const created = await h.repo.createExportRequest(USER, ['profile'], null);
    h.store.upload = () => Promise.reject(new AppError('SERVICE_UNAVAILABLE', { retryable: true }));
    await h.flush();
    const summary = await h.run();
    assertEquals(summary.dead_lettered, 1);
    assertEquals(h.repo.exports.get(created.request_id)?.status, 'failed');
    assert(h.jobs.byKey(`notif:${USER}:export_failed:${created.request_id}`) !== undefined);
    assert(h.audit.some((a) => a.action === 'system.privacy.export_failed'));
  },
);

// ── JOB-22 history deletion ───────────────────────────────────────────────────

Deno.test(
  'history deletion: purges, removes objects through the Storage API, completes (TST-EF-17)',
  async () => {
    const h = await setup();
    h.store.put('captures', `${USER}/c1/fis.jpg`);
    h.store.put('briefing-audio', `${USER}/b1/1.mp3`);
    h.store.put('captures', `${OTHER}/c2/keep.jpg`);
    h.repo.purge = {
      deleted: { insights: 4, memory_chunks: 3, briefings: 1, captures: 1, notifications: 0 },
      storage_paths: { captures: [`${USER}/c1/fis.jpg`], 'briefing-audio': [`${USER}/b1/1.mp3`] },
    };
    const req = await h.repo.createDeletionRequest({
      userId: USER,
      kind: 'history',
      statusTokenHash: null,
      scope: 'all_analysis',
      accountId: null,
      correlationId: null,
    });
    await h.flush();
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    const row = h.repo.deletions.get(req.request_id);
    assertEquals(row?.status, 'completed');
    assertEquals([row?.steps.db_purged, row?.steps.storage_purged], ['done', 'done']);
    assertEquals(
      h.repo.calls.filter((c) => c.startsWith('purgeHistory')),
      [`purgeHistory:${USER}:all`],
    );
    assertEquals(h.store.get('captures', `${USER}/c1/fis.jpg`), undefined);
    assertEquals(h.store.get('briefing-audio', `${USER}/b1/1.mp3`), undefined);
    assert(
      h.store.get('captures', `${OTHER}/c2/keep.jpg`) !== undefined,
      'another user is untouched',
    );
    assert(h.jobs.byKey(`notif:${USER}:history_deleted:${req.request_id}`) !== undefined);
    const done = h.audit.find((a) => a.action === 'system.privacy.history_deletion_completed');
    assertEquals(done?.details?.insights, 4);
  },
);

Deno.test(
  'history deletion: account scope, and a crash before the object removal resumes without purging again',
  async () => {
    const h = await setup();
    h.store.put('captures', `${USER}/replies/d1/a.pdf`);
    h.repo.purge = {
      deleted: { email_messages: 2 },
      storage_paths: { captures: [`${USER}/replies/d1/a.pdf`] },
    };
    const req = await h.repo.createDeletionRequest({
      userId: USER,
      kind: 'history',
      statusTokenHash: null,
      scope: 'connected_account',
      accountId: GOOGLE,
      correlationId: null,
    });
    await h.flush();
    h.store.failRemove = true;
    const first = await h.run();
    assertEquals(first.retried, 1);
    assertEquals(
      h.repo.deletions.get(req.request_id)?.status,
      'processing',
      'never completed early',
    );
    h.store.failRemove = false;
    h.advance(3_600_000);
    const second = await h.run();
    assertEquals(second.completed, 1);
    assertEquals(
      h.repo.calls.filter((c) => c.startsWith('purgeHistory')),
      [`purgeHistory:${USER}:${GOOGLE}`],
    );
    assertEquals(h.store.get('captures', `${USER}/replies/d1/a.pdf`), undefined);
    assertEquals(h.repo.deletions.get(req.request_id)?.status, 'completed');
  },
);

// ── JOB-23 account deletion ───────────────────────────────────────────────────

async function accountSetup(options: Options = {}) {
  const h = await setup(options);
  h.repo.context = {
    user_exists: true,
    email: 'yunus@example.com',
    locale: 'en-US',
    installation_ids: [INSTALLATION],
    apple_sub: '001234.abcdef',
    accounts: [
      { id: GOOGLE, provider: 'google', status: 'healthy' },
      { id: MICROSOFT, provider: 'microsoft', status: 'healthy' },
      { id: DEVICE, provider: 'apple_device', status: 'healthy' },
    ],
  };
  const token = await encryptToken(h.keyring, 'apple-refresh-token-value', {
    account: USER,
    provider: SIWA_PROVIDER,
    kind: 'apple_siwa_refresh',
  });
  await h.credentials.saveUserCredential(USER, SIWA_PROVIDER, 'apple_siwa_refresh', token);
  for (const bucket of ['captures', 'exports', 'briefing-audio'] as const) {
    h.store.put(bucket, `${USER}/a/${bucket}.bin`);
  }
  h.store.put('captures', `${OTHER}/keep.jpg`);
  const req = await h.repo.createDeletionRequest({
    userId: USER,
    kind: 'account',
    statusTokenHash: new Uint8Array(32),
    scope: null,
    accountId: null,
    correlationId: null,
  });
  await h.flush();
  return { ...h, requestId: req.request_id };
}

Deno.test(
  'account deletion: every step runs against the providers and nothing remains (TST-EF-18)',
  async () => {
    const h = await accountSetup({ teardown: { [MICROSOFT]: 'local_only' } });
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    const steps = stepsOf(h.repo, h.requestId);
    assertEquals(h.repo.deletions.get(h.requestId)?.status, 'completed');
    assertEquals(
      h.torn.sort(),
      [GOOGLE, MICROSOFT].sort(),
      'device accounts have nothing to revoke',
    );
    assertEquals(steps.provider_revoke, {
      google: 'revoked',
      microsoft: 'local_only',
      apple_device: 'skipped',
    });
    assertEquals(h.revoked, ['apple-refresh-token-value']);
    assertEquals(steps.apple_siwa_revoked, 'revoked');
    assertEquals(h.rcCalls, [USER]);
    assertEquals(steps.revenuecat_deleted, 'deleted');
    assertEquals(steps.storage_purged, 'done');
    assertEquals(await h.store.list('captures', USER), []);
    assertEquals(await h.store.list('exports', USER), []);
    assert(h.store.get('captures', `${OTHER}/keep.jpg`) !== undefined, 'another user is untouched');
    assertEquals(h.auth.banned, [USER]);
    assertEquals(h.auth.deleted, [USER]);
    assertEquals(h.repo.tombstones.map((t) => t.kind).sort(), [
      'apple_sub',
      'email',
      'installation',
    ]);
    for (const t of h.repo.tombstones) assertMatch(t.hash, /^[0-9a-f]{64}$/);
    assert(h.repo.calls.includes('pseudonymizeAudit'));
    assertEquals(steps.verified, 'done');
    // JOB-31: the address never enters the payload; the sealed copy resolves at send time.
    const email = h.jobs.byKey(
      [...h.jobs.jobs.values()].find((j) => j.type === 'transactional_email')?.idempotency_key ??
        '',
    );
    assert(email !== undefined);
    assertFalse(JSON.stringify(email.payload).includes('yunus@example.com'));
    assertEquals((email.payload as { locale: string }).locale, 'en');
    const recipient = deletionRequestRecipient({
      repo: h.repo,
      keyring: () => Promise.resolve(h.keyring),
    });
    assertEquals(await recipient.resolve(h.requestId), 'yunus@example.com');
    const completion = h.audit.find(
      (a) => a.action === 'system.privacy.account_deletion_completed',
    );
    assertEquals(completion?.targetUserId, null, 'the completion audit carries no user id');
  },
);

Deno.test(
  'account deletion: a crash at the RevenueCat step resumes there; the status is never completed early',
  async () => {
    let failures = 1;
    const h = await accountSetup({
      revenueCat: () =>
        failures-- > 0
          ? Promise.reject(new AppError('PROVIDER_UNAVAILABLE'))
          : Promise.resolve('deleted'),
    });
    const first = await h.run();
    assertEquals(first.retried, 1);
    assertEquals(h.repo.deletions.get(h.requestId)?.status, 'processing');
    assertEquals(stepsOf(h.repo, h.requestId).revenuecat_deleted_tries, 1);
    assertEquals(
      h.auth.deleted,
      [],
      'the auth user is not deleted before the earlier steps finished',
    );
    h.advance(3_600_000);
    const second = await h.run();
    assertEquals(second.completed, 1);
    assertEquals(h.torn.length, 2, 'provider teardown is not repeated');
    assertEquals(h.revoked.length, 1, 'Apple is not revoked twice');
    assertEquals(h.rcCalls.length, 2);
    assertEquals(h.repo.deletions.get(h.requestId)?.status, 'completed');
  },
);

Deno.test(
  'account deletion: a failed revoke is recorded in steps and deletion still completes',
  async () => {
    const h = await accountSetup({
      teardown: { [GOOGLE]: 'revoke_failed' },
      revenueCat: () => Promise.reject(new AppError('PROVIDER_REJECTED')),
      apple: false,
    });
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    const steps = stepsOf(h.repo, h.requestId);
    assertEquals((steps.provider_revoke as Record<string, string>).google, 'failed');
    assertEquals(steps.revenuecat_deleted, 'failed');
    assertEquals(steps.apple_siwa_revoked, 'not_configured');
    assert((steps.warnings as number) >= 2);
    assertEquals(h.repo.deletions.get(h.requestId)?.status, 'completed');
  },
);

Deno.test(
  'account deletion: rows that remain block completion; the last attempt fails honestly',
  async () => {
    const h = await accountSetup({ maxAttempts: 1 });
    h.repo.remaining = { 'profiles.user_id': 1 };
    const summary = await h.run();
    assertEquals(summary.dead_lettered, 1);
    assertEquals(h.repo.deletions.get(h.requestId)?.status, 'failed');
    assertNotEquals(stepsOf(h.repo, h.requestId).verified, 'done');
  },
);

Deno.test(
  'account deletion: admin retry payload {request_id}; cancelled requests are left alone',
  async () => {
    const h = await accountSetup();
    const row = h.repo.deletions.get(h.requestId);
    assert(row !== undefined);
    h.repo.deletions.set(h.requestId, { ...row, status: 'cancelled' });
    const [job] = [...h.jobs.jobs.values()];
    assert(job !== undefined);
    job.payload = { request_id: h.requestId };
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    assertEquals(job.result, { skipped: 'status_cancelled' });
    assertEquals(h.torn, []);
  },
);

// ── JOB-31 deletion confirmation through the transactional e-mail job ─────────

Deno.test(
  'transactional_email: the account_deleted confirmation resolves the sealed address and wipes it',
  async () => {
    const h = await accountSetup();
    await h.run();
    const sent: EmailMessage[] = [];
    const recipient = deletionRequestRecipient({
      repo: h.repo,
      keyring: () => Promise.resolve(h.keyring),
    });
    const registry = createRegistry([
      transactionalEmailJob({
        system: testDb(forbiddenFetch()),
        raw: testEnv({
          EMAIL_PROVIDER: 'postmark',
          EMAIL_API_KEY: 'server-token-for-tests',
          EMAIL_FROM_ADDRESS: 'destek@mail.dijitalasistan.app',
        }),
        keyring: () => Promise.resolve(h.keyring),
        provider: {
          id: 'postmark',
          send: (message) => Promise.resolve((sent.push(message), { messageId: 'pm-1' })),
        },
        resolvers: { deletion_request: recipient.resolve },
        onSent: { deletion_request: recipient.onSent },
      }) as never,
    ]);
    const summary = await runWorker({
      repo: h.jobs,
      registry,
      log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      now: () => START,
    });
    assertEquals(summary.completed, 1);
    assertEquals(sent[0]?.to, 'yunus@example.com');
    assertEquals(sent[0]?.subject, 'Your account was deleted');
    assert(sent[0]?.text.includes('DEL-'));
    assertEquals(
      h.repo.deletions.get(h.requestId)?.notify_email_ciphertext,
      null,
      'the address is wiped',
    );
    assertEquals(stepsOf(h.repo, h.requestId).confirmation_email, 'sent');
  },
);

// ── JOB-20 retention ──────────────────────────────────────────────────────────

Deno.test(
  'retention: sweeps in batches until empty, removes objects with their rows and orphans (TST-EF-19)',
  async () => {
    const h = await setup();
    h.store.put('captures', `${USER}/c1/a.jpg`);
    h.store.put('briefing-audio', `${USER}/b1/1.mp3`);
    h.store.put('exports', `${USER}/old.zip`);
    h.store.put('captures', `${OTHER}/c2/keep.jpg`);
    h.repo.cleanups = [
      {
        deleted: { insights: 5000, memory_chunks: 1200, captures: 1 },
        storage_paths: { captures: [`${USER}/c1/a.jpg`], 'briefing-audio': [`${USER}/b1/1.mp3`] },
      },
      { deleted: { insights: 3, memory_chunks: 0 }, storage_paths: {} },
      { deleted: { insights: 0, memory_chunks: 0 }, storage_paths: {} },
    ];
    h.repo.orphans = { exports: [`${USER}/old.zip`] };
    await h.jobs.enqueue({
      type: 'retention',
      idempotencyKey: 'retention:2026-09-24',
      payload: {},
    });
    const summary = await h.run();
    assertEquals(summary.completed, 1);
    assertEquals(h.repo.calls.filter((c) => c === 'retentionCleanup').length, 3);
    assertEquals(h.store.get('captures', `${USER}/c1/a.jpg`), undefined);
    assertEquals(h.store.get('briefing-audio', `${USER}/b1/1.mp3`), undefined);
    assertEquals(h.store.get('exports', `${USER}/old.zip`), undefined);
    assert(
      h.store.get('captures', `${OTHER}/c2/keep.jpg`) !== undefined,
      'non-expired objects stay',
    );
    const run = h.audit.find((a) => a.action === 'system.retention.run');
    assertEquals(run?.details?.insights, 5003);
    assertEquals(run?.details?.memory_chunks, 1200);
    assertEquals(run?.details?.job_attempts, 2);
  },
);

Deno.test(
  'retention: the recompute payload of the retention-change trigger; a run past its budget continues',
  async () => {
    const h = await setup();
    h.repo.recomputes = [5000, 12, 0];
    await h.jobs.enqueue({
      type: 'retention',
      idempotencyKey: `retention_recompute:${USER}:1`,
      payload: { mode: 'recompute', user_id: USER, from: 'd90', to: 'd30' },
      userId: USER,
    });
    await h.run();
    const job = h.jobs.byKey(`retention_recompute:${USER}:1`);
    assertEquals(job?.result, { mode: 'recompute', updated: 5012 });

    const budget = await setup();
    const registry = createRegistry(
      privacyJobDefinitions({
        export: {
          repo: budget.repo,
          store: budget.store,
          audit: { append: () => Promise.resolve() },
        },
        account: undefined as never,
        retention: {
          repo: budget.repo,
          store: budget.store,
          audit: { append: () => Promise.resolve() },
          budgetMs: 0,
          clock: (() => {
            let t = 0;
            return () => (t += 10);
          })(),
        },
      }),
    );
    budget.repo.cleanups = [{ deleted: { insights: 5000 }, storage_paths: {} }];
    await budget.jobs.enqueue({
      type: 'retention',
      idempotencyKey: 'retention:2026-09-25',
      payload: {},
    });
    await runWorker({
      repo: budget.jobs,
      registry,
      log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      now: () => START,
      maxJobs: 1,
    });
    const continuation = [...budget.jobs.jobs.values()].find((j) =>
      j.idempotency_key.startsWith('retention:2026-09-25:c:'),
    );
    assert(continuation !== undefined, 'a continuation job is queued');
  },
);

Deno.test(
  'privacy payloads: poison payloads are dead-lettered, database shapes are accepted',
  async () => {
    const h = await setup();
    await h.jobs.enqueue({ type: 'export', idempotencyKey: 'export:bad', payload: { nope: true } });
    await h.jobs.enqueue({
      type: 'retention',
      idempotencyKey: 'retention:x',
      payload: { shard: 3 },
    });
    const summary = await h.run();
    assertEquals(h.jobs.byKey('export:bad')?.last_error_code, 'POISON_PAYLOAD');
    assertEquals(h.jobs.byKey('retention:x')?.status, 'completed');
    assertEquals(summary.claimed, 2);
  },
);
