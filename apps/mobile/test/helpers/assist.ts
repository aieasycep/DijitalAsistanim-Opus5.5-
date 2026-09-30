/**
 * Fixtures for the assistant, approvals, reminders, capture and people tests (T-8.15…T-8.18):
 * API `ApprovalView`s that pass the `@da/validation` card consistency rules, the matching
 * `list_approvals` / `approval_actions` rows, SSE responses and a capture row.
 */
import { TS, uuid } from './fixtures';

export const M3 = {
  approval: uuid(300),
  approval2: uuid(301),
  thread: uuid(310),
  message: uuid(311),
  userMessage: uuid(312),
  capture: uuid(320),
  contact: uuid(330),
  contact2: uuid(331),
  vip: uuid(340),
  reminder: uuid(350),
  insight: uuid(360),
  job: uuid(370),
} as const;

type ViewOverrides = Record<string, unknown>;

/** A pending in-app reminder approval (`reminder_create`, server executor). */
export function approvalView(overrides: ViewOverrides = {}) {
  return {
    id: M3.approval,
    action_type: 'reminder_create',
    status: 'pending',
    payload_version: 1,
    idempotency_key: `approval:${M3.approval}:v1`,
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
    origin: 'assistant',
    origin_ref_id: null,
    executor: 'server',
    device_installation_id: null,
    batch_id: null,
    created_at: TS,
    approval_expires_at: '2026-09-30T08:00:00Z',
    approved_at: null,
    rejected_at: null,
    approved_via: null,
    executed_at: null,
    result: null,
    failure: null,
    ...overrides,
  };
}

/** The same approval as a PostgREST / RPC-10 row. */
export function approvalRow(overrides: ViewOverrides = {}) {
  return {
    id: M3.approval,
    action_type: 'reminder_create',
    status: 'pending',
    what: 'Faturayı öde',
    why: 'Hatırlatıcı kurmak istedin.',
    change_summary: 'Yarın 08:00',
    exact_change: {
      kind: 'create',
      fields: [{ field: 'fire_at', before: null, after: TS }],
      card: {
        destination: {
          target_kind: 'in_app',
          provider: 'in_app',
          account_label: null,
          container_label: null,
        },
      },
    },
    side_effects: [{ code: 'push_reminder', text: 'Yarın 08:00 bildirim gelir.' }],
    destination_label: null,
    destination_account_id: null,
    executor: 'server',
    device_installation_id: null,
    origin: 'assistant',
    payload_version: 1,
    idempotency_key: `approval:${M3.approval}:v1`,
    requires_scope: null,
    batch_id: null,
    approved_via: null,
    created_at: TS,
    approval_expires_at: '2026-09-30T08:00:00Z',
    approved_at: null,
    rejected_at: null,
    executing_at: null,
    executed_at: null,
    failed_at: null,
    last_error_code: null,
    attempt_count: 0,
    source_type: 'user_input',
    source_id: M3.approval,
    source_provider: null,
    source_timestamp: TS,
    result: null,
    ...overrides,
  };
}

export function approveResponse(view: ViewOverrides, execution?: ViewOverrides) {
  return {
    approval: approvalView(view),
    job: { job_id: M3.job, status: 'queued', poll_after_ms: 1000 },
    execution: execution ?? { mode: 'server', device_token: null, instructions: null },
  };
}

/** A `text/event-stream` response from `event:` / `data:` frames. */
export function sse(events: readonly (readonly [string, unknown])[]): Response {
  const body = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function answerStream(options: { text: string; approval?: ViewOverrides | null }) {
  const events: [string, unknown][] = [
    [
      'meta',
      {
        thread_id: M3.thread,
        user_message_id: M3.userMessage,
        assistant_message_id: M3.message,
        correlation_id: 'corr-12345678',
      },
    ],
    ['status', { stage: 'generating' }],
    ['delta', { text: options.text }],
    [
      'citation',
      {
        index: 0,
        source: {
          source_type: 'contact',
          source_id: M3.contact,
          source_provider: 'google',
          source_timestamp: TS,
        },
        title: 'Mehmet Yılmaz',
        snippet: 'Teklif',
      },
    ],
  ];
  if (options.approval !== undefined && options.approval !== null) {
    events.push(['action_proposal', { approval: approvalView(options.approval) }]);
  }
  events.push([
    'done',
    {
      assistant_message_id: M3.message,
      finish_reason: 'stop',
      grounded: true,
      usage: { remaining_messages: 10 },
    },
  ]);
  return sse(events);
}

export function captureRow(overrides: ViewOverrides = {}) {
  return {
    id: M3.capture,
    kind: 'text',
    status: 'analyzing',
    primary_type: null,
    extracted: [],
    progress: { step: 'reading' },
    error_code: null,
    link_preview: null,
    created_at: TS,
    ...overrides,
  };
}

export function captureView(overrides: ViewOverrides = {}) {
  return {
    id: M3.capture,
    kind: 'text',
    status: 'uploaded',
    primary_type: null,
    items: [],
    link_preview: null,
    error_code: null,
    created_at: TS,
    ...overrides,
  };
}
