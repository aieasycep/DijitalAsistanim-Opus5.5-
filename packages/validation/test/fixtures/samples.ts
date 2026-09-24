/** Shared fixture builders for the table-driven schema tests. */

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TS = '2026-09-24T08:00:00Z';
export const TS_LATER = '2026-09-24T09:30:00Z';
export const DAY = '2026-09-24';
export const SHA = 'a'.repeat(64);
export const B64_32 = 'A'.repeat(43);

export const meta = { correlation_id: 'corr-12345678', request_id: 'req-1', server_time: TS };
export const pageMeta = { ...meta, page: 1, page_size: 25, total: 1, total_is_estimate: false };
export const ok = (data: unknown) => ({ data, meta });
export const paged = (row: unknown) => ({ data: [row], meta: pageMeta });

/** Deep-clones `value` and sets (or deletes, with `DELETE`) the dotted `path`. */
export const DELETE = Symbol('delete');
export function withPath<T>(value: T, path: string, next: unknown): T {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = path.split('.');
  let cursor: Record<string, unknown> = copy;
  keys.slice(0, -1).forEach((key) => {
    cursor = cursor[key] as Record<string, unknown>;
  });
  const last = keys.at(-1) ?? '';
  if (next === DELETE) {
    if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
    else Reflect.deleteProperty(cursor, last);
  } else {
    cursor[last] = next;
  }
  return copy as T;
}

export const sourceRef = {
  source_type: 'email_message',
  source_id: uuid(90),
  source_provider: 'google',
  source_timestamp: TS,
  label: 'Gmail · Mehmet Yılmaz · 08:42',
  open_route: `/mail/${uuid(90)}`,
};

export const evidence = {
  quote: 'Teklifi yarın 17:00’ye kadar gönderebilir misiniz?',
  source: sourceRef,
};

export const provenance = {
  source_type: 'email_message',
  source_id: uuid(90),
  source_provider: 'google',
  source_timestamp: TS,
  confidence: 0.9,
  evidence: [evidence],
};

export const jobRef = { job_id: uuid(70), status: 'queued', poll_after_ms: 1500 };

export const dataSources = {
  mail_read: true,
  attachments_analyze: true,
  deadline_detect: true,
  draft_replies: true,
  calendar_read: true,
  schedule_suggest: true,
  calendar_write_with_approval: true,
  tasks_read: false,
};

export const accountSummary = {
  id: uuid(10),
  provider: 'google',
  account_email: 'yunus@example.com',
  display_name: 'Yunus',
  status: 'healthy',
  capabilities_granted: ['mail_read', 'calendar_read'],
  data_sources: dataSources,
  paused_by_plan: false,
  last_sync_at: TS,
  last_error_code: null,
  manual_revoke_url: null,
};

export const entitlement = {
  is_active: true,
  source: 'store',
  active_until: TS_LATER,
  store: {
    active: true,
    product_id: 'da_pro_monthly',
    store: 'app_store',
    period_type: 'normal',
    will_renew: true,
    expires_at: TS_LATER,
    billing_issue: false,
    management_url: 'https://apps.apple.com/account/subscriptions',
  },
  grants: [{ id: uuid(11), source: 'referral_referee', starts_at: TS, ends_at: TS_LATER }],
};

export const usage = {
  plan: 'free',
  resets_at: TS_LATER,
  limits: { reply_drafts_daily: { limit: 5, used: 1, remaining: 4 } },
  ai_budget: { state: 'ok', level: 'L0' },
  ai_units: { limit: 50, used: 3, remaining: 47 },
};

export const recipient = { email: 'mehmet@yilmaz-endustri.com.tr', name: 'Mehmet Yılmaz' };

export const replyDraft = {
  id: uuid(20),
  kind: 'reply',
  email_message_id: uuid(90),
  email_thread_id: uuid(91),
  connected_account_id: uuid(10),
  tone: 'professional',
  subject: 'Re: Teklif',
  to: [recipient],
  cc: [],
  body_text: 'Merhaba Mehmet Bey, teklifi yarın 17:00’ye kadar iletiyorum.',
  language: 'tr',
  version: 1,
  status: 'draft',
  attachments: [],
  grounding: { facts_used: [sourceRef] },
  warnings: [],
  approval_id: null,
  web_link: null,
  created_at: TS,
  updated_at: TS,
};

export const calendarCreatePayload = {
  action_type: 'calendar_create',
  target: { kind: 'provider', connected_account_id: uuid(10), calendar_id: uuid(12) },
  title: 'Teklif hazırlama',
  time: { kind: 'timed', start: TS, end: TS_LATER, time_zone: 'Europe/Istanbul' },
  attendees: [],
  reminders_minutes: [15],
};

export const approvalView = {
  id: uuid(30),
  action_type: 'calendar_create',
  status: 'pending',
  payload_version: 1,
  idempotency_key: `approval:${uuid(30)}:v1`,
  type_label_key: 'approvals.type.calendar_create',
  what: { title: 'Teklif hazırlama', summary: 'Yarın 14:00–16:30 takvimine eklenir.' },
  why: { text: 'Mailde son tarih tespit edildi.', reason_code: 'deadline_detected' },
  source: sourceRef,
  exact_change: { kind: 'create', fields: [{ field: 'time', before: null, after: '14:00–16:30' }] },
  destination: {
    target_kind: 'provider',
    provider: 'google',
    account_label: 'yunus@example.com · Google Takvim',
    container_label: 'İş',
  },
  side_effects: [{ code: 'internal_record', text: 'Takvimine eklenir; kimseye davet gitmez.' }],
  scope_status: { state: 'granted' },
  requires_confirmation: false,
  pro_required: false,
  origin: 'plan_proposal',
  origin_ref_id: uuid(31),
  executor: 'server',
  device_installation_id: null,
  batch_id: null,
  created_at: TS,
  approval_expires_at: TS_LATER,
  approved_at: null,
  rejected_at: null,
  approved_via: null,
  executed_at: null,
  result: null,
  failure: null,
};

export const reminder = {
  id: uuid(40),
  title: 'Teklifi gönder',
  preset: 'before_30m',
  fire_at: TS,
  time_zone: 'Europe/Istanbul',
  channel: 'push',
  status: 'scheduled',
  reason_text: 'Takvimine göre: 12:10',
  subject: { type: 'email_message', id: uuid(90) },
  created_at: TS,
};

export const capture = {
  id: uuid(50),
  kind: 'pdf',
  status: 'extracted',
  primary_type: 'event',
  items: [
    {
      item_id: 'i1',
      type: 'event',
      title: 'Lansman toplantısı',
      fields: { date: DAY },
      evidence: [evidence],
      confidence: 0.86,
      proposed_action: 'calendar_create',
      selected: true,
      unresolved: [],
    },
  ],
  link_preview: null,
  error_code: null,
  created_at: TS,
};

export const searchResult = {
  type: 'email',
  id: uuid(90),
  title: 'Fiyat güncellemesi',
  snippet: 'Fiyatın Ekim teslimatına göre güncellenmesi istendi.',
  source: sourceRef,
  score: 0.82,
  route: `/mail/${uuid(90)}`,
};
