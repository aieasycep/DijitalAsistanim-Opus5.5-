import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createApiClient, mk, qk } from '../src/index.ts';
import {
  approvalApproveMutationOptions,
  approvalEditMutationOptions,
  approvalRejectMutationOptions,
  assistantThreadMutationOptions,
  captureActionsMutationOptions,
  captureAnalyzeMutationOptions,
  reminderCreateMutationOptions,
  reminderResolveTimeMutationOptions,
  searchQueryOptions,
} from '../src/hooks/index.ts';
import { TS, json, mockFetch, ok, uuid } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

function bodyOf(init: RequestInit): unknown {
  return typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
}

export function approvalView(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(30),
    action_type: 'reminder_create',
    status: 'pending',
    payload_version: 1,
    idempotency_key: `approval:${uuid(30)}:v1`,
    type_label_key: 'approvals.types.reminder_create',
    what: { title: 'Faturayı öde', summary: 'Yarın 08:00' },
    why: { text: 'Hatırlatıcı kurmak istedin.', reason_code: 'reminder_sheet' },
    source: null,
    exact_change: { kind: 'create', fields: [{ field: 'fire_at', before: null, after: TS }] },
    destination: {
      target_kind: 'in_app',
      provider: 'in_app',
      account_label: null,
      container_label: null,
    },
    side_effects: [{ code: 'push_reminder', text: 'Yarın 08:00 bildirim gelir.' }],
    scope_status: { state: 'not_applicable' },
    requires_confirmation: true,
    pro_required: false,
    origin: 'reminder_sheet',
    origin_ref_id: null,
    executor: 'server',
    device_installation_id: null,
    batch_id: null,
    created_at: TS,
    approval_expires_at: '2026-09-25T08:00:00Z',
    approved_at: null,
    rejected_at: null,
    approved_via: null,
    executed_at: null,
    result: null,
    failure: null,
    ...overrides,
  };
}

describe('assist query keys', () => {
  it('nests new keys under their area roots', () => {
    expect(qk.approvals.pending()).toEqual(['approvals', 'pending']);
    expect(qk.approvals.history('failed')).toEqual(['approvals', 'history', 'failed']);
    expect(qk.captures.detail(uuid(1)).slice(0, 1)).toEqual(qk.captures.all);
    expect(qk.vip.list()).toEqual(['vip', 'list']);
    expect(qk.person.detail(uuid(2))).toEqual(['person', uuid(2)]);
    expect(qk.assistant.messages(uuid(3))).toEqual(['assistant', 'messages', uuid(3)]);
    expect(mk.approvals.approve).toEqual(['approvals', 'approve']);
  });
});

describe('search', () => {
  it('sends the query string and keys results and answers apart', async () => {
    const mock = mockFetch(() => json(200, ok({ mode: 'fts_only', results: [] })));
    const client = new QueryClient();
    const results = searchQueryOptions(api(mock.fn), { q: 'uçak', types: 'email,person' });
    const answer = searchQueryOptions(api(mock.fn), { q: 'uçak bileti', mode: 'answer' });
    expect(results.queryKey[1]).toBe('results');
    expect(answer.queryKey[1]).toBe('memory');
    await client.query(results);
    const url = new URL(mock.calls[0]?.url ?? '');
    expect(url.pathname).toBe('/functions/v1/api/search');
    expect(url.searchParams.get('q')).toBe('uçak');
    expect(url.searchParams.get('types')).toBe('email,person');
  });
});

describe('assistant and approvals', () => {
  it('creates a thread with the client thread id', async () => {
    const mock = mockFetch(() =>
      json(201, ok({ id: uuid(7), scope: { type: 'global' }, created_at: TS })),
    );
    const observer = new MutationObserver(
      new QueryClient(),
      assistantThreadMutationOptions(api(mock.fn)),
    );
    const data = await observer.mutate({ body: { client_thread_id: uuid(8) } });
    expect(data.id).toBe(uuid(7));
    expect(bodyOf(mock.calls[0]?.init ?? {})).toEqual({ client_thread_id: uuid(8) });
  });

  it('approves with the approval key as the HTTP Idempotency-Key and the tapped surface', async () => {
    const mock = mockFetch(() =>
      json(
        202,
        ok({
          approval: approvalView({ status: 'approved', approved_via: 'inline_sheet' }),
          job: { job_id: uuid(9), status: 'queued', poll_after_ms: 1500 },
          execution: { mode: 'server', device_token: null, instructions: null },
        }),
      ),
    );
    const observer = new MutationObserver(
      new QueryClient(),
      approvalApproveMutationOptions(api(mock.fn)),
    );
    const key = `approval:${uuid(30)}:v1`;
    const data = await observer.mutate({
      params: { id: uuid(30) },
      body: { idempotency_key: key, payload_version: 1, approved_via: 'inline_sheet' },
    });
    expect(data.approval.status).toBe('approved');
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(key);
    expect(mock.calls[0]?.url).toContain(`/approvals/${uuid(30)}/approve`);
  });

  it('rejects and edits through their routes', async () => {
    const mock = mockFetch(
      () => json(200, ok(approvalView({ status: 'rejected', rejected_at: TS }))),
      () => json(200, ok(approvalView({ payload_version: 2 }))),
    );
    const client = api(mock.fn);
    const reject = new MutationObserver(new QueryClient(), approvalRejectMutationOptions(client));
    await reject.mutate({
      input: { params: { id: uuid(30) }, body: { reason: 'user_cancel', learn: false } },
      idempotencyKey: uuid(31),
    });
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(31));
    const edit = new MutationObserver(new QueryClient(), approvalEditMutationOptions(client));
    const edited = await edit.mutate({
      input: {
        params: { id: uuid(30) },
        body: { expected_payload_version: 1, payload_patch: { title: 'Yeni' } },
      },
    });
    expect(edited.payload_version).toBe(2);
    expect(mock.calls[1]?.init.method).toBe('PATCH');
  });
});

describe('reminders and captures', () => {
  it('resolves times and creates a reminder', async () => {
    const mock = mockFetch(
      () =>
        json(
          200,
          ok({
            options: [
              {
                preset: 'smart',
                fire_at: TS,
                label: '11:00',
                reason_text: 'Takvimine göre: 11:00',
                valid: true,
                invalid_reason: null,
              },
            ],
          }),
        ),
      () =>
        json(
          201,
          ok({
            id: uuid(40),
            title: 'Fatura',
            preset: 'tomorrow_morning',
            fire_at: TS,
            time_zone: 'Europe/Istanbul',
            channel: 'local',
            status: 'scheduled',
            reason_text: null,
            subject: null,
            created_at: TS,
          }),
        ),
    );
    const client = api(mock.fn);
    const resolve = new MutationObserver(
      new QueryClient(),
      reminderResolveTimeMutationOptions(client),
    );
    const resolved = await resolve.mutate({ body: { presets: ['smart'] } });
    expect(resolved.options[0]?.reason_text).toBe('Takvimine göre: 11:00');
    const create = new MutationObserver(new QueryClient(), reminderCreateMutationOptions(client));
    const created = await create.mutate({
      body: {
        client_reminder_id: uuid(41),
        title: 'Fatura',
        preset: 'tomorrow_morning',
        fire_at: TS,
        channel: 'local',
        origin: 'today',
      },
    });
    expect(created.id).toBe(uuid(40));
  });

  it('analyzes and proposes capture actions with the caller key', async () => {
    const capture = {
      id: uuid(50),
      kind: 'text',
      status: 'analyzing',
      primary_type: null,
      items: [],
      link_preview: null,
      error_code: null,
      created_at: TS,
    };
    const mock = mockFetch(
      () =>
        json(
          202,
          ok({ capture, job: { job_id: uuid(51), status: 'queued', poll_after_ms: 1000 } }),
        ),
      () =>
        json(
          201,
          ok({
            approvals: [approvalView({ origin: 'capture', batch_id: uuid(50) })],
            batch_id: uuid(50),
            memory_saved: false,
          }),
        ),
    );
    const client = api(mock.fn);
    const analyze = new MutationObserver(new QueryClient(), captureAnalyzeMutationOptions(client));
    await analyze.mutate({
      input: { params: { id: uuid(50) }, body: {} },
      idempotencyKey: uuid(52),
    });
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(52));
    const actions = new MutationObserver(new QueryClient(), captureActionsMutationOptions(client));
    const result = await actions.mutate({
      input: {
        params: { id: uuid(50) },
        body: { items: [{ item_id: 'i1', action_type: 'reminder_create' }], save_to_memory: false },
      },
      idempotencyKey: uuid(53),
    });
    expect(result.approvals).toHaveLength(1);
  });
});
