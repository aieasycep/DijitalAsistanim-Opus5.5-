/**
 * Shared set-up for the threat-model suite (IMPLEMENTATION_PLAN T-11.05): the real `api` app wired
 * with the AI part-2 routes (captures, search) over the in-memory stores and the fixture provider,
 * and a capture row builder for JOB-27. No network: every fetch is a stub.
 */
import type { CaptureRow } from '../../_shared/services/assist/store.ts';
import { assistFixture } from '../../_shared/testing/assist.ts';
import { MemoryIntel, NOW } from '../../_shared/testing/intel.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { createApiApp } from '../../api/app.ts';
import { createHarness } from '../../api/testing.ts';
import type { IntelApi } from '../../api/routes/intel-api.ts';
import type { AssistApi } from '../../api/routes/assist-api.ts';

export async function assistApi(options: { fetch?: typeof fetch } = {}) {
  const h = await createHarness();
  h.business.gate.plans.set(USER_A, 'pro');
  const mem = new MemoryIntel();
  const fx = assistFixture(mem, { user: { isPro: true, plan: 'pro' } });
  const intel: IntelApi = {
    ai: fx.ai.services,
    bodies: mem.bodySource(),
    mail: mem.mailStore(),
    memory: mem.memoryStore(),
    search: () => ({
      search: () => Promise.resolve([]),
      contactsNamed: () => Promise.resolve([]),
      ownsContact: () => Promise.resolve(false),
      semanticQuota: () => Promise.resolve(true),
      retention: () => Promise.resolve(null),
    }),
    briefings: () => ({
      byId: () => Promise.resolve(null),
      eveningReady: () => Promise.resolve({}),
      retry: () => Promise.resolve({}),
    }),
  };
  const assist: AssistApi = {
    store: fx.store,
    storage: fx.storage,
    insights: fx.intel.insights,
    fetch:
      options.fetch ??
      (() => Promise.reject(new Error('the preview fetch must not run in this test'))),
    resolver: () => Promise.resolve(['93.184.215.14']),
  };
  const app = createApiApp({ ...h.deps, intel, assist, now: () => NOW });
  const jwt = await h.token(USER_A);
  const request = (method: string, path: string, body?: unknown, key?: string) =>
    Promise.resolve(
      app.request(`/api${path}`, {
        method,
        headers: {
          'X-DA-Client': 'ios/1.4.0 (812)',
          Authorization: `Bearer ${jwt}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(key === undefined ? {} : { 'Idempotency-Key': key }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { h, fx, mem, request };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A capture waiting for JOB-27 (`analyzing`). */
export function captureRow(overrides: Partial<CaptureRow> = {}): Mutable<CaptureRow> {
  const id = crypto.randomUUID();
  return {
    id,
    user_id: USER_A,
    kind: 'link',
    status: 'analyzing',
    storage_path: null,
    mime_type: null,
    size_bytes: null,
    sha256: null,
    original_filename: null,
    source_url: null,
    final_url: null,
    text_content: null,
    page_count: null,
    extracted: [],
    extracted_types: [],
    primary_type: null,
    share_origin: 'in_app',
    progress: {},
    file_deleted_at: null,
    idempotency_key: `capture:${id}`,
    error_code: null,
    analyzed_at: null,
    link_preview: null,
    created_at: NOW.toISOString(),
    expires_at: null,
    ...overrides,
  };
}
