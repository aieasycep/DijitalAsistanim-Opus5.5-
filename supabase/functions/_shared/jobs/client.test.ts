import { assert, assertEquals, assertRejects } from '@std/assert';
import { enqueueJob, LeaseLostError, pokeWorker, supabaseJobsRepo } from './client.ts';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { testDb } from '../testing/db.ts';
import { createLogger, memorySink } from '../logging/logger.ts';

const JOB_ID = '0b9f6c1e-6d0a-4f7e-8a2b-1c3d5e7f9a0b';

Deno.test(
  'enqueueJob calls public.enqueue_job with the idempotency key; a duplicate returns the same id',
  async () => {
    const ids = new Map<string, string>();
    const stub = stubFetch((call) => {
      const body = JSON.parse(call.body ?? '{}') as { p_idempotency_key: string };
      if (!ids.has(body.p_idempotency_key)) ids.set(body.p_idempotency_key, crypto.randomUUID());
      return jsonResponse(ids.get(body.p_idempotency_key));
    });
    const client = testDb(stub.fetch);
    const input = {
      type: 'briefing' as const,
      idempotencyKey: 'briefing:u1:morning:2026-09-23',
      payload: { briefing_id: 'b1' },
      userId: '11111111-1111-4111-8111-111111111111',
      runAfter: new Date('2026-09-23T05:00:00Z'),
      correlationId: '7b0c8f0e-3a1d-4d2e-9f5b-0c1d2e3f4a5b',
    };
    const first = await enqueueJob(client, input);
    const second = await enqueueJob(client, input);
    assertEquals(first, second);
    assertEquals(ids.size, 1);
    assert(stub.calls[0]?.url.endsWith('/rest/v1/rpc/enqueue_job'));
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      p_type: 'briefing',
      p_idempotency_key: 'briefing:u1:morning:2026-09-23',
      p_payload: { briefing_id: 'b1' },
      p_user_id: '11111111-1111-4111-8111-111111111111',
      p_account_id: null,
      p_run_after: '2026-09-23T05:00:00.000Z',
      p_priority: 100,
      p_max_attempts: 5,
      p_correlation_id: '7b0c8f0e-3a1d-4d2e-9f5b-0c1d2e3f4a5b',
    });
  },
);

Deno.test(
  'claim/fail map to claim_jobs and fail_job; LEASE_LOST becomes LeaseLostError',
  async () => {
    const stub = stubFetch((call) => {
      if (call.url.endsWith('/rpc/claim_jobs')) return jsonResponse([]);
      if (call.url.endsWith('/rpc/fail_job')) return jsonResponse('retrying');
      return jsonResponse({ code: 'P0001', message: 'LEASE_LOST', details: null, hint: null }, 400);
    });
    const repo = supabaseJobsRepo(testDb(stub.fetch));
    assertEquals(await repo.claim('w1', ['notification'], 5, 120), []);
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      p_worker_id: 'w1',
      p_types: ['notification'],
      p_limit: 5,
      p_lease_seconds: 120,
    });
    const status = await repo.fail({
      jobId: JOB_ID,
      workerId: 'w1',
      errorCode: 'X',
      errorMessage: 'm'.repeat(900),
      retryable: true,
      retryAfterSeconds: 30,
    });
    assertEquals(status, 'retrying');
    assertEquals(JSON.parse(stub.calls[1]?.body ?? '{}').p_error_message.length, 500);
    await assertRejects(() => repo.complete(JOB_ID, 'w1', null), LeaseLostError);
  },
);

Deno.test(
  'pokeWorker posts to worker/run with the automations secret and never throws',
  async () => {
    const stub = stubFetch(() => new Response(null, { status: 200 }));
    const secret = crypto.randomUUID();
    assert(
      await pokeWorker({
        baseUrl: 'https://project-ref.supabase.co/',
        secret,
        reason: 'capture',
        fetch: stub.fetch,
      }),
    );
    assertEquals(stub.calls[0]?.url, 'https://project-ref.supabase.co/functions/v1/worker/run');
    assertEquals(stub.calls[0]?.method, 'POST');
    assertEquals(stub.calls[0]?.headers.get('apikey'), secret);
    assertEquals(stub.calls[0]?.headers.get('x-da-reason'), 'capture');

    const sink = memorySink();
    const log = createLogger({ fn: 'api', sink: sink.sink });
    const failing = (() => Promise.reject(new TypeError('network'))) as typeof fetch;
    assertEquals(
      await pokeWorker({
        baseUrl: 'https://x.supabase.co',
        secret,
        reason: 'r',
        fetch: failing,
        log,
      }),
      false,
    );
    const unset = stubFetch(() => new Response(null));
    assertEquals(
      await pokeWorker({
        baseUrl: 'https://x.supabase.co',
        secret: undefined,
        reason: 'r',
        fetch: unset.fetch,
        log,
      }),
      false,
    );
    assertEquals(unset.calls.length, 0);
    assertEquals(
      sink.records().map((r) => r.msg),
      ['worker_poke_failed', 'worker_poke_skipped'],
    );
  },
);
