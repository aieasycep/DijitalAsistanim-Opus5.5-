import type { ApiRouteKey } from '../../src/api/routes.ts';
import {
  B64_32,
  DAY,
  SHA,
  TS,
  TS_LATER,
  accountSummary,
  approvalView,
  calendarCreatePayload,
  capture,
  entitlement,
  jobRef,
  ok,
  provenance,
  recipient,
  reminder,
  replyDraft,
  searchResult,
  sourceRef,
  usage,
  uuid,
  withPath,
} from './samples.ts';
import type { RouteFixture } from './types.ts';

export const emailSendApprovalView = {
  ...approvalView,
  id: uuid(32),
  action_type: 'email_send',
  idempotency_key: `approval:${uuid(32)}:v1`,
  type_label_key: 'approvals.type.email_send',
  exact_change: { kind: 'send', fields: [{ field: 'to', before: null, after: recipient.email }] },
  side_effects: [{ code: 'email_sent_to', text: 'Mail Mehmet Yılmaz’a gönderilir.' }],
  origin: 'reply_draft',
};

export const deviceApprovalView = {
  ...approvalView,
  id: uuid(33),
  status: 'executing',
  destination: {
    target_kind: 'device',
    provider: 'apple_device',
    account_label: null,
    container_label: 'Takvim',
  },
  side_effects: [{ code: 'device_write', text: 'Bu iPhone’daki takvime yazılır.' }],
  executor: 'device',
  device_installation_id: uuid(1),
  approved_at: TS,
  approved_via: 'approval_center',
};

export const devicePayload = {
  ...calendarCreatePayload,
  target: {
    kind: 'device',
    provider: 'apple_device',
    installation_id: uuid(1),
    device_calendar_hash: SHA,
  },
};

export const commitmentApprovalView = {
  ...approvalView,
  id: uuid(34),
  action_type: 'commitment_create',
  type_label_key: 'approvals.type.commitment_create',
  destination: {
    target_kind: 'in_app',
    provider: 'in_app',
    account_label: null,
    container_label: null,
  },
  side_effects: [{ code: 'internal_record', text: 'Taahhütlerine kaydedilir.' }],
  origin: 'post_meeting',
  batch_id: uuid(35),
};

const preferences = {
  theme: 'system',
  reduce_motion: false,
  haptics_enabled: true,
  timezone: 'Europe/Istanbul',
  timezone_mode: 'auto',
  retention_policy: 'd90',
  learn_from_interactions: true,
  ai_data_access: {
    mail_body: true,
    attachments: true,
    calendar: true,
    contacts: true,
    location_coarse: false,
  },
  interest_categories: ['work', 'travel'],
  morning_enabled: true,
  morning_time: '08:00',
  midday_enabled: true,
  midday_time: '13:00',
  evening_enabled: true,
  evening_time: '19:00',
  weekly_enabled: true,
  weekly_dow: 7,
  weekly_time: '18:00',
  briefing_weekdays: [1, 2, 3, 4, 5, 6, 7],
  weekend_morning_time: '10:00',
  weekend_morning_only: true,
  weekend_personal_first: true,
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  work_days: [1, 2, 3, 4, 5],
  default_write_calendar_id: null,
  dismissed_gates: {},
  analytics_opt_out: false,
  screen_protection: false,
};

const notificationPreferences = {
  smart_filter: true,
  morning: true,
  midday: true,
  evening: true,
  critical_email: true,
  meeting: true,
  deadline: true,
  follow_up: true,
  life_intel: false,
  approval: true,
  account: true,
  quiet_hours_enabled: true,
  quiet_start: '22:30',
  quiet_end: '07:30',
  quiet_days: [1, 2, 3, 4, 5, 6, 7],
  vip_bypass_quiet: true,
  meetings_bypass_quiet: false,
  snooze_until: null,
  detail_level: 'title_only',
  lock_screen_private: true,
  daily_cap: 5,
};

export const bootstrapData = {
  server_now: TS,
  api_version: '2026-09-23',
  demo_mode: false,
  account_state: 'active',
  profile: {
    id: uuid(2),
    display_name: 'Yunus',
    email: 'yunus@example.com',
    auth_providers: ['apple'],
    created_at: TS,
    onboarding: { step: 'done', completed_at: TS },
  },
  preferences,
  locale: 'tr-TR',
  notification_preferences: notificationPreferences,
  entitlement,
  usage,
  flags: { 'feature.midday': true },
  config: {
    upgrade_required: false,
    min_supported_version: { ios: '1.0.0', android: '1.0.0' },
    referral_reward_days: 14,
    referral_max_rewards_per_year: 6,
    undo_window_seconds: 5,
  },
  counts: { pending_approvals: 1, open_followups: 2, open_commitments: 3 },
  pending_device_approvals: [
    { approval_id: uuid(33), action_type: 'calendar_create', approved_at: TS },
  ],
  accounts: [accountSummary],
  announcements: [
    { id: uuid(3), title: 'Yeni', body: 'Öğle özeti geldi.', cta_route: '/today', ends_at: null },
  ],
  service_status: {
    unavailable_features: [{ feature: 'assistant', reason: 'external_credential_required' }],
  },
};

const meetingPrepView = {
  id: uuid(60),
  calendar_event_id: uuid(61),
  status: 'ready',
  event: {
    title: 'Ürün gözden geçirme',
    start: TS,
    end: TS_LATER,
    location: null,
    join_url: 'https://meet.google.com/abc-defg-hij',
  },
  people: [{ contact_id: uuid(62), name: 'Mehmet Yılmaz', role_text: 'Yılmaz Endüstri' }],
  purpose: { text: 'Fiyat revizyonunu konuşmak.', provenance },
  previous_communication: [{ text: 'Dün fiyat güncellemesi istedi.', source: sourceRef }],
  recent_emails: [
    { email_message_id: uuid(90), subject: 'Fiyat', summary: 'Ekim teslimatı', date: TS },
  ],
  open_loops: [{ text: 'Teklif bekleniyor.', source: sourceRef }],
  user_commitments: [{ commitment_id: uuid(63), text: 'Teklifi gönder', due_at: TS_LATER }],
  other_commitments: [],
  relevant_files: [],
  talking_points: [{ text: 'Ekim teslimatı fiyatı', sources: [sourceRef] }],
  two_minute_summary: { text: 'Mehmet Bey fiyatın güncellenmesini istiyor.', sources: [sourceRef] },
  generated_at: TS,
  source_hash: 'abc123',
};

export const assistantAnswer = {
  message_id: uuid(80),
  route: 'grounded_qa',
  blocks: [
    {
      text: 'Mehmet en son dün fiyat güncellemesi istedi.',
      verified: true,
      citations: [{ result_index: 0, cited_text: 'fiyat' }],
    },
  ],
  source_cards: [
    {
      result_index: 0,
      source_type: 'email_message',
      icon: 'mail',
      src_label: 'Gmail · Mehmet Yılmaz',
      date_label: 'Dün 18:20',
      title: 'Fiyat güncellemesi',
      summary: 'Ekim teslimatına göre fiyat istendi.',
      deeplink: `/mail/${uuid(90)}`,
      page_no: null,
    },
  ],
  rich_cards: [],
  proposed_actions: [],
  coverage: 1,
  confidence_label: 'high',
  unknown: false,
  followup_suggestions: ['Teklif ne zaman gönderilmeli?'],
};

export const widgetSnapshot = {
  v: 1,
  etag: 'W/"abc"',
  generated_at: TS,
  locale: 'tr',
  state: 'ok',
  detail_mode: 'title_only',
  lock_screen_private: true,
  entitlement: 'pro',
  counts: { important: 3, events_today: 2, follow_ups: 1, deadlines: 1 },
  briefing: {
    id: uuid(64),
    kind: 'morning',
    status: 'ready',
    ready_at: TS,
    scheduled_for: TS,
    time_label: '08:00',
    item_count: 5,
    audio_minutes: 2,
    deeplink: `dijitalasistan://briefing/${uuid(64)}`,
  },
  priorities: [
    {
      id: uuid(65),
      badge: 'SON TARİH',
      urgency: 'today',
      title_private: 'Son tarih · 17:00',
      time_label: '17:00',
      source_label: 'Gmail · 08:42',
      deeplink: `dijitalasistan://mail/${uuid(90)}`,
    },
  ],
  next_meeting: {
    event_id: uuid(61),
    start_at: TS,
    end_at: TS_LATER,
    time_label: '11:00',
    duration_min: 90,
    title_private: 'Toplantı · 90 dk',
    prep_ready: true,
    prep_topic_count: 3,
    deeplink: `dijitalasistan://meeting/${uuid(61)}/prep`,
  },
  later_meetings: [],
  follow_up: null,
  last_analysis_at: TS,
};

const snapshotBody = {
  snapshot_id: uuid(4),
  provider: 'apple_device',
  installation_id: uuid(1),
  window: { start: TS, end: '2026-09-25T08:00:00Z' },
  snapshot_at: TS,
  content_hash: SHA,
  calendars: [
    {
      device_calendar_hash: SHA,
      title: 'Ev',
      source_title: 'iCloud',
      color: '#5B5CE2',
      allows_modifications: true,
      selected: true,
    },
  ],
  events: [
    {
      event_key_hash: SHA,
      device_calendar_hash: SHA,
      title: 'Dişçi',
      start_at: TS,
      end_at: TS_LATER,
      all_day: false,
      location: null,
      attendee_count: 0,
      organizer_is_self: true,
      meeting_url: null,
      status: 'confirmed',
      last_modified_at: null,
    },
  ],
  reminders: [],
};

const mailOriginal = {
  message_id: uuid(90),
  subject: 'Fiyat güncellemesi',
  from: recipient,
  to: [{ email: 'yunus@example.com' }],
  cc: [],
  date: TS,
  body: {
    format: 'html_sanitized',
    content: '<p>Merhaba</p>',
    truncated: false,
    remote_images_blocked: true,
  },
  attachments: [
    { attachment_ref: 'ref-1', name: 'teklif.pdf', mime: 'application/pdf', size_bytes: 1024 },
  ],
  web_link: 'https://mail.google.com/mail/?authuser=yunus@example.com#all/abc',
  fetched_at: TS,
};

const firstAnalysis = {
  status: 'running',
  partial: false,
  steps: [{ key: 'scan_mail', status: 'done', count: 12 }],
  counts: { mails_found: 42, potential_important: 5, upcoming_events: 3, possible_followups: 2 },
  top_items: [
    { insight_id: uuid(66), kind: 'deadline', title: 'Teklif son tarihi', time_label: '17:00' },
  ],
  total_items: 3,
  briefing_id: null,
};

const shareCard = {
  week_label: '15–21 Eylül',
  metrics: {
    analyzed_emails: 214,
    important_subjects: 17,
    meetings: 9,
    followups_closed: 4,
    deadlines: 3,
    estimated_time_saved_minutes: 95,
  },
  formula_version: 'timeSaved@v1',
  labels: { time_saved_prefix: 'Tahmini kazandırılan zaman' },
  share_text: 'Bu hafta Dijital Asistan 214 maili benim için ayıkladı.',
};

const conflictEvent = (n: number) => ({
  id: uuid(n),
  title: `Etkinlik ${String(n)}`,
  start: TS,
  end: TS_LATER,
  is_organizer: true,
  attendee_count: 2,
});

export const apiFixtures = {
  'POST /devices/register': {
    valid: {
      body: {
        installation_id: uuid(1),
        platform: 'ios',
        os_version: '18.0',
        app_version: '1.0.0',
        build_number: '42',
        locale: 'tr-TR',
        timezone: 'Europe/Istanbul',
        push: { permission: 'granted', expo_push_token: 'ExponentPushToken[abc123]' },
        device_fingerprint_hash: SHA,
      },
      response: ok({
        installation_id: uuid(1),
        push_enabled: true,
        rebound_from_other_user: false,
        timezone_applied: true,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'token without permission',
        value: {
          installation_id: uuid(1),
          platform: 'ios',
          os_version: '18.0',
          app_version: '1.0.0',
          build_number: '42',
          locale: 'tr-TR',
          timezone: 'Europe/Istanbul',
          push: { permission: 'denied', expo_push_token: 'ExponentPushToken[abc123]' },
          device_fingerprint_hash: null,
        },
      },
      {
        part: 'body',
        why: 'invalid IANA zone',
        value: {
          installation_id: uuid(1),
          platform: 'android',
          os_version: '15',
          app_version: '1.0',
          build_number: '42',
          locale: 'tr-TR',
          timezone: 'Mars/Olympus',
          push: { permission: 'undetermined', expo_push_token: null },
          device_fingerprint_hash: null,
        },
      },
      {
        part: 'response',
        why: 'push_enabled not boolean',
        value: ok({
          installation_id: uuid(1),
          push_enabled: 'yes',
          rebound_from_other_user: false,
          timezone_applied: true,
        }),
      },
    ],
  },
  'POST /devices/unregister': {
    valid: {
      body: { installation_id: uuid(1), reason: 'logout' },
      response: ok({ disabled_tokens: 1 }),
    },
    invalid: [
      { part: 'body', why: 'unknown reason', value: { installation_id: uuid(1), reason: 'crash' } },
      { part: 'response', why: 'negative count', value: ok({ disabled_tokens: -1 }) },
    ],
  },
  'POST /auth/apple/exchange': {
    valid: {
      body: { authorization_code: 'c'.repeat(40), identity_token_sub: '001234.abcd' },
      response: ok({ stored: true }),
    },
    invalid: [
      {
        part: 'body',
        why: 'code too short',
        value: { authorization_code: 'short', identity_token_sub: 'x' },
      },
      { part: 'response', why: 'missing stored', value: ok({}) },
    ],
  },
  'POST /notifications/test': {
    valid: {
      body: { installation_id: uuid(1), category: 'meeting' },
      response: ok({ notification_id: uuid(5), job: jobRef, deferred_until: null }),
    },
    invalid: [
      {
        part: 'body',
        why: 'unknown category',
        value: { installation_id: uuid(1), category: 'weekly' },
      },
      {
        part: 'response',
        why: 'missing job',
        value: ok({ notification_id: uuid(5), deferred_until: null }),
      },
    ],
  },
  'GET /me/bootstrap': {
    valid: { response: ok(bootstrapData) },
    invalid: [
      {
        part: 'response',
        why: 'undo window is always 5 s (R-06)',
        value: ok(withPath(bootstrapData, 'config.undo_window_seconds', 10)),
      },
      {
        part: 'response',
        why: 'quiet_start not a time',
        value: ok(withPath(bootstrapData, 'notification_preferences.quiet_start', '25:00')),
      },
    ],
  },
  'GET /me/entitlements': {
    valid: { response: ok({ entitlement, usage }) },
    invalid: [
      {
        part: 'response',
        why: 'unknown entitlement source',
        value: ok({ entitlement: withPath(entitlement, 'source', 'gift'), usage }),
      },
    ],
  },
  'POST /integrations/oauth/complete': {
    valid: {
      body: { completion_code: B64_32, device_nonce: B64_32 },
      response: ok({
        result: 'success',
        account: accountSummary,
        granted: ['mail_read'],
        missing: [],
        resume: null,
        jobs: [jobRef],
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'nonce not 43 chars',
        value: { completion_code: B64_32, device_nonce: 'abc' },
      },
      {
        part: 'response',
        why: 'unknown result',
        value: ok({
          result: 'ok',
          account: null,
          granted: [],
          missing: [],
          resume: null,
          jobs: [],
        }),
      },
    ],
  },
  'POST /integrations/device-calendar/snapshot': {
    valid: { body: snapshotBody, response: ok({ job: jobRef, connected_account_id: uuid(10) }) },
    invalid: [
      {
        part: 'body',
        why: 'Android snapshot with reminders',
        value: withPath(snapshotBody, 'provider', 'android_device'),
      },
      {
        part: 'body',
        why: 'event outside window',
        value: withPath(snapshotBody, 'events.0.start_at', '2026-10-30T08:00:00Z'),
      },
      {
        part: 'body',
        why: 'window longer than 60 days',
        value: withPath(snapshotBody, 'window.end', '2026-12-30T08:00:00Z'),
      },
      { part: 'response', why: 'missing account id', value: ok({ job: jobRef }) },
    ],
  },
  'POST /integrations/:provider/start': {
    valid: {
      params: { provider: 'google' },
      body: { capabilities: ['mail_read', 'calendar_read'], device_nonce_hash: SHA },
      response: ok({
        state_id: uuid(6),
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
        state_expires_at: TS_LATER,
        callback_url: 'dijitalasistan://integrations/callback',
        requested_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      }),
    },
    invalid: [
      {
        part: 'params',
        why: 'device providers use the snapshot route',
        value: { provider: 'apple_device' },
      },
      {
        part: 'body',
        why: 'device_nonce_hash is required (R-07)',
        value: { capabilities: ['mail_read'] },
      },
      {
        part: 'body',
        why: 'write capability at start',
        value: { capabilities: ['mail_send'], device_nonce_hash: SHA },
      },
      {
        part: 'response',
        why: 'wrong callback url',
        value: ok({
          state_id: uuid(6),
          auth_url: 'https://accounts.google.com',
          state_expires_at: TS,
          callback_url: 'https://evil.example.com',
          requested_scopes: [],
        }),
      },
    ],
  },
  'POST /integrations/:accountId/upgrade': {
    valid: {
      params: { accountId: uuid(10) },
      body: { capability: 'mail_send', resume: { approval_id: uuid(32) }, device_nonce_hash: SHA },
      response: ok({
        already_granted: false,
        state_id: uuid(6),
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
        state_expires_at: TS_LATER,
        missing_scopes: ['https://www.googleapis.com/auth/gmail.send'],
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'gmail.compose is never requested',
        value: { capability: 'mail_compose', device_nonce_hash: SHA },
      },
      {
        part: 'response',
        why: 'not granted without auth_url',
        value: ok({ already_granted: false }),
      },
    ],
  },
  'POST /integrations/:accountId/disconnect': {
    valid: {
      params: { accountId: uuid(10) },
      body: { confirm: true },
      response: ok({
        account: { ...accountSummary, status: 'disconnected' },
        revocation: 'local_only',
        manual_revoke_url: 'https://account.live.com/consent/Manage',
        purge_job: jobRef,
      }),
    },
    invalid: [
      { part: 'body', why: 'confirm must be true', value: { confirm: false } },
      {
        part: 'response',
        why: 'unknown revocation',
        value: ok({
          account: accountSummary,
          revocation: 'maybe',
          manual_revoke_url: null,
          purge_job: jobRef,
        }),
      },
    ],
  },
  'POST /integrations/:accountId/sync': {
    valid: {
      params: { accountId: uuid(10) },
      body: { resources: ['mail'] },
      response: ok({ jobs: [jobRef], next_allowed_at: TS_LATER }),
    },
    invalid: [
      { part: 'body', why: 'empty resources', value: { resources: [] } },
      { part: 'params', why: 'account id not a uuid', value: { accountId: '42' } },
      {
        part: 'response',
        why: 'job status unknown',
        value: ok({ jobs: [{ ...jobRef, status: 'waiting' }], next_allowed_at: TS }),
      },
    ],
  },
  'PATCH /integrations/:accountId/data-sources': {
    valid: {
      params: { accountId: uuid(10) },
      body: { data_sources: { mail_read: false }, expected_updated_at: TS },
      response: ok({
        account: accountSummary,
        calendars: [
          {
            id: uuid(12),
            name: 'İş',
            selected: true,
            can_write: true,
            is_default_write: true,
            color: '#5B5CE2',
          },
        ],
        consequences: ['ingestion_paused'],
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'optimistic concurrency token required',
        value: { data_sources: { mail_read: false } },
      },
      {
        part: 'body',
        why: 'unknown toggle',
        value: { data_sources: { mail_send: true }, expected_updated_at: TS },
      },
      {
        part: 'response',
        why: 'unknown consequence',
        value: ok({ account: accountSummary, calendars: [], consequences: ['deleted'] }),
      },
    ],
  },
  'POST /onboarding/first-analysis': {
    valid: { body: { window_hours: 72 }, response: ok({ job: jobRef, already_running: false }) },
    invalid: [
      { part: 'body', why: 'window above 72 h', value: { window_hours: 96 } },
      { part: 'response', why: 'already_running missing', value: ok({ job: jobRef }) },
    ],
  },
  'GET /onboarding/first-analysis/:jobId': {
    valid: { params: { jobId: uuid(70) }, response: ok(firstAnalysis) },
    invalid: [
      { part: 'params', why: 'job id not a uuid', value: { jobId: 'x' } },
      {
        part: 'response',
        why: 'more than 5 top items',
        value: ok(
          withPath(
            firstAnalysis,
            'top_items',
            Array.from({ length: 6 }, () => firstAnalysis.top_items[0]),
          ),
        ),
      },
    ],
  },
  'GET /mail/:messageId/original': {
    valid: {
      params: { messageId: uuid(90) },
      query: { remote_images: 'blocked' },
      response: ok(mailOriginal),
    },
    invalid: [
      { part: 'query', why: 'unknown image mode', value: { remote_images: 'maybe' } },
      {
        part: 'response',
        why: 'unknown body format',
        value: ok(withPath(mailOriginal, 'body.format', 'raw')),
      },
    ],
  },
  'POST /mail/:messageId/reply-drafts': {
    valid: { params: { messageId: uuid(90) }, body: { tone: 'short' }, response: ok(replyDraft) },
    invalid: [
      { part: 'body', why: 'unknown tone', value: { tone: 'angry' } },
      {
        part: 'body',
        why: 'instructions too long',
        value: { tone: 'short', instructions: 'x'.repeat(501) },
      },
      {
        part: 'response',
        why: 'unknown draft status',
        value: ok(withPath(replyDraft, 'status', 'queued')),
      },
    ],
  },
  'POST /reply-drafts/:id/regenerate': {
    valid: {
      params: { id: uuid(20) },
      body: { tone: 'friendly', expected_version: 1 },
      response: ok({ ...replyDraft, version: 2 }),
    },
    invalid: [
      {
        part: 'body',
        why: 'version starts at 1',
        value: { tone: 'friendly', expected_version: 0 },
      },
      {
        part: 'response',
        why: 'more than 5 attachments',
        value: ok(
          withPath(
            replyDraft,
            'attachments',
            Array.from({ length: 6 }, () => ({
              storage_path: 'p',
              name: 'n',
              mime: 'm',
              size_bytes: 1,
            })),
          ),
        ),
      },
    ],
  },
  'PATCH /reply-drafts/:id': {
    valid: {
      params: { id: uuid(20) },
      body: { body_text: 'Yeni metin', expected_version: 1 },
      response: ok(replyDraft),
    },
    invalid: [
      { part: 'body', why: 'no changes', value: { expected_version: 1 } },
      { part: 'body', why: 'empty recipients', value: { to: [], expected_version: 1 } },
      {
        part: 'response',
        why: 'unknown warning',
        value: ok(withPath(replyDraft, 'warnings', ['spam'])),
      },
    ],
  },
  'POST /reply-drafts/:id/submit': {
    valid: {
      params: { id: uuid(20) },
      body: { expected_version: 1 },
      response: ok({
        draft: { ...replyDraft, status: 'submitted' },
        approval: emailSendApprovalView,
      }),
    },
    invalid: [
      { part: 'body', why: 'version missing', value: {} },
      {
        part: 'response',
        why: 'email_send card must declare email_sent_to',
        value: ok({
          draft: replyDraft,
          approval: {
            ...emailSendApprovalView,
            side_effects: [{ code: 'internal_record', text: 'x' }],
          },
        }),
      },
    ],
  },
  'POST /followups/:threadId/draft': {
    valid: {
      params: { threadId: uuid(91) },
      body: { tone: 'short' },
      response: ok({ ...replyDraft, kind: 'follow_up' }),
    },
    invalid: [
      { part: 'body', why: 'instructions too long', value: { instructions: 'x'.repeat(501) } },
      { part: 'response', why: 'unknown kind', value: ok({ ...replyDraft, kind: 'forward' }) },
    ],
  },
  'POST /mail/threads/:threadId/summary': {
    valid: {
      params: { threadId: uuid(91) },
      body: { refresh: false },
      response: ok({
        thread_id: uuid(91),
        summary: 'Mehmet Bey Ekim teslimatı için fiyat güncellemesi istiyor.',
        key_points: [{ text: 'Fiyat güncellemesi', source: sourceRef }],
        open_questions: [{ text: 'Teslim tarihi?', owner: 'user' }],
        generated_at: TS,
        cached: true,
      }),
    },
    invalid: [
      { part: 'body', why: 'refresh must be boolean', value: { refresh: 'yes' } },
      {
        part: 'response',
        why: 'API owner vocabulary is user|other|unclear',
        value: ok({
          thread_id: uuid(91),
          summary: 's',
          key_points: [],
          open_questions: [{ text: 'q', owner: 'counterparty' }],
          generated_at: TS,
          cached: false,
        }),
      },
    ],
  },
  'POST /reply-drafts/:id/attachments/upload-url': {
    valid: {
      params: { id: uuid(20) },
      body: {
        client_attachment_id: uuid(21),
        file_name: 'teklif.pdf',
        mime: 'application/pdf',
        size_bytes: 1000,
        sha256: SHA,
      },
      response: ok({
        upload: {
          signed_url: 'https://api.dijitalasistan.app/storage/v1/object/upload/sign/x',
          token: 't',
          path: `${uuid(2)}/replies/x`,
          expires_at: TS_LATER,
        },
        draft: replyDraft,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'extension does not match MIME',
        value: {
          client_attachment_id: uuid(21),
          file_name: 'teklif.png',
          mime: 'application/pdf',
          size_bytes: 1000,
          sha256: SHA,
        },
      },
      {
        part: 'body',
        why: 'over 3 MiB',
        value: {
          client_attachment_id: uuid(21),
          file_name: 'a.pdf',
          mime: 'application/pdf',
          size_bytes: 4 * 1024 * 1024,
          sha256: SHA,
        },
      },
      {
        part: 'response',
        why: 'signed url missing',
        value: ok({ upload: { token: 't', path: 'p', expires_at: TS }, draft: replyDraft }),
      },
    ],
  },
  'POST /approvals': {
    valid: {
      body: { payload: calendarCreatePayload, origin: 'plan_proposal', origin_ref_id: uuid(31) },
      response: ok(approvalView),
    },
    invalid: [
      {
        part: 'body',
        why: 'email_send is proposed via reply drafts',
        value: {
          payload: {
            action_type: 'email_send',
            connected_account_id: uuid(10),
            provider: 'google',
            mode: 'reply',
            reply_draft_id: uuid(20),
            thread: { email_thread_id: uuid(91), reply_to_message_id: uuid(90) },
            to: [recipient],
            cc: [],
            subject: 'Re: Teklif',
            body_text: 'Merhaba',
            language: 'tr',
          },
          origin: 'manual',
          origin_ref_id: null,
        },
      },
      {
        part: 'body',
        why: 'end before start',
        value: {
          payload: withPath(calendarCreatePayload, 'time.end', '2026-09-24T07:00:00Z'),
          origin: 'manual',
          origin_ref_id: null,
        },
      },
      {
        part: 'response',
        why: 'exact change kind does not match action type',
        value: ok(withPath(approvalView, 'exact_change.kind', 'send')),
      },
    ],
  },
  'PATCH /approvals/:id': {
    valid: {
      params: { id: uuid(30) },
      body: { expected_payload_version: 1, payload_patch: { title: 'Teklif hazırlama (uzun)' } },
      response: ok({
        ...approvalView,
        payload_version: 2,
        idempotency_key: `approval:${uuid(30)}:v2`,
      }),
    },
    invalid: [
      { part: 'body', why: 'patch missing', value: { expected_payload_version: 1 } },
      {
        part: 'response',
        why: 'payload_version below 1',
        value: ok({ ...approvalView, payload_version: 0 }),
      },
    ],
  },
  'POST /approvals/:id/approve': {
    valid: {
      params: { id: uuid(30) },
      body: {
        idempotency_key: `approval:${uuid(30)}:v1`,
        payload_version: 1,
        approved_via: 'inline_sheet',
      },
      response: ok({
        approval: {
          ...approvalView,
          status: 'approved',
          approved_at: TS,
          approved_via: 'inline_sheet',
        },
        job: jobRef,
        execution: { mode: 'server', device_token: null, instructions: null },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'spoken approval is never a value (R-03)',
        value: { idempotency_key: 'k', payload_version: 1, approved_via: 'voice' },
      },
      {
        part: 'response',
        why: 'device mode without token for a server approval',
        value: ok({
          approval: approvalView,
          job: null,
          execution: { mode: 'device', device_token: null, instructions: null },
        }),
      },
    ],
  },
  'POST /approvals/:id/reject': {
    valid: {
      params: { id: uuid(30) },
      body: { reason: 'user_reject', learn: true },
      response: ok({ ...approvalView, status: 'rejected', rejected_at: TS }),
    },
    invalid: [
      { part: 'body', why: 'unknown reason', value: { reason: 'meh' } },
      { part: 'response', why: 'unknown status', value: ok({ ...approvalView, status: 'undone' }) },
    ],
  },
  'POST /approvals/:id/device-execution': {
    valid: {
      params: { id: uuid(33) },
      body: { phase: 'claim', installation_id: uuid(1) },
      response: ok({
        approval: deviceApprovalView,
        device_token: B64_32,
        instructions: devicePayload,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'failed result needs an error code',
        value: {
          phase: 'result',
          installation_id: uuid(1),
          device_token: B64_32,
          status: 'failed',
        },
      },
      { part: 'body', why: 'unknown phase', value: { phase: 'probe', installation_id: uuid(1) } },
      {
        part: 'response',
        why: 'device card must be executed by the device',
        value: ok({ ...deviceApprovalView, executor: 'server' }),
      },
    ],
  },
  'POST /reminders/resolve-time': {
    valid: {
      body: { presets: ['before_30m', 'smart'], anchor_at: TS_LATER },
      response: ok({
        options: [
          {
            preset: 'before_30m',
            fire_at: TS,
            label: '16:30',
            reason_text: null,
            valid: true,
            invalid_reason: null,
          },
        ],
      }),
    },
    invalid: [
      { part: 'body', why: 'before_* needs an anchor', value: { presets: ['before_1h'] } },
      { part: 'body', why: 'custom needs custom_at', value: { presets: ['custom'] } },
      {
        part: 'response',
        why: 'unknown invalid reason',
        value: ok({
          options: [
            {
              preset: 'x',
              fire_at: null,
              label: 'l',
              reason_text: null,
              valid: false,
              invalid_reason: 'too_late',
            },
          ],
        }),
      },
    ],
  },
  'POST /reminders': {
    valid: {
      body: {
        client_reminder_id: uuid(41),
        title: 'Teklifi gönder',
        preset: 'tomorrow_morning',
        fire_at: TS_LATER,
        origin: 'email_detail',
      },
      response: ok(reminder),
    },
    invalid: [
      {
        part: 'body',
        why: 'unknown origin',
        value: {
          client_reminder_id: uuid(41),
          title: 't',
          preset: 'custom',
          fire_at: TS,
          origin: 'widget',
        },
      },
      {
        part: 'body',
        why: 'before_30m without anchor',
        value: {
          client_reminder_id: uuid(41),
          title: 't',
          preset: 'before_30m',
          fire_at: TS,
          origin: 'today',
        },
      },
      { part: 'response', why: 'unknown channel', value: ok({ ...reminder, channel: 'sms' }) },
    ],
  },
  'POST /reminders/:id/cancel': {
    valid: {
      params: { id: uuid(40) },
      body: { reason: 'undo' },
      response: ok({ ...reminder, status: 'cancelled' }),
    },
    invalid: [
      { part: 'body', why: 'unknown reason', value: { reason: 'later' } },
      { part: 'response', why: 'unknown status', value: ok({ ...reminder, status: 'snoozed' }) },
    ],
  },
  'GET /plan/free-slots': {
    valid: {
      query: { from: TS, to: TS_LATER, min_minutes: '30', within_working_hours: 'true' },
      response: ok({
        slots: [{ start: TS, end: TS_LATER, minutes: 90 }],
        sources_considered: [
          { account_id: uuid(10), provider: 'google', last_sync_at: TS, stale: false },
        ],
      }),
    },
    invalid: [
      { part: 'query', why: 'to before from', value: { from: TS_LATER, to: TS } },
      {
        part: 'query',
        why: 'min_minutes below 15',
        value: { from: TS, to: TS_LATER, min_minutes: '5' },
      },
      {
        part: 'response',
        why: 'minutes not integer',
        value: ok({ slots: [{ start: TS, end: TS_LATER, minutes: 1.5 }], sources_considered: [] }),
      },
    ],
  },
  'POST /plan/proposals': {
    valid: {
      body: {
        title: 'Teklif hazırlama',
        duration_minutes: 90,
        window: { from: TS, to: '2026-09-26T08:00:00Z' },
      },
      response: ok({
        insight_id: uuid(31),
        slot: { start: TS, end: TS_LATER },
        alternatives: [],
        rationale_text: 'Yarın 14:00–16:30 arasında boşsun.',
        approval: approvalView,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'item or title required',
        value: { duration_minutes: 90, window: { from: TS, to: TS_LATER } },
      },
      {
        part: 'body',
        why: 'window longer than 14 days',
        value: {
          title: 't',
          duration_minutes: 90,
          window: { from: TS, to: '2026-10-30T08:00:00Z' },
        },
      },
      {
        part: 'response',
        why: 'more than 3 alternatives',
        value: ok({
          insight_id: uuid(31),
          slot: { start: TS, end: TS_LATER },
          alternatives: Array.from({ length: 4 }, () => ({ start: TS, end: TS_LATER })),
          rationale_text: 'r',
          approval: approvalView,
        }),
      },
    ],
  },
  'POST /plan/conflicts/:insightId/options': {
    valid: {
      params: { insightId: uuid(67) },
      body: {},
      response: ok({
        conflict: { insight_id: uuid(67), events: [conflictEvent(68), conflictEvent(69)] },
        options: [
          {
            option_id: 'move_event',
            kind: 'move_event',
            title: '10:15’e Kaydır',
            description: 'Katılımcılara güncelleme gönderilir.',
            feasibility: { organizer: true, attendee_availability: 'unknown' },
            side_effects: ['attendees_notified'],
            requires_capability: 'calendar_write',
            pro_required: true,
          },
        ],
      }),
    },
    invalid: [
      { part: 'body', why: 'body takes no fields', value: { force: true } },
      {
        part: 'response',
        why: 'a conflict has exactly two events',
        value: ok({ conflict: { insight_id: uuid(67), events: [conflictEvent(68)] }, options: [] }),
      },
    ],
  },
  'POST /plan/conflicts/:insightId/resolve': {
    valid: {
      params: { insightId: uuid(67) },
      body: { option_id: 'move_event', params: { new_start: TS, new_end: TS_LATER } },
      response: ok({
        approval: approvalView,
        reply_draft: null,
        reminder_options_route: null,
        insight_status: 'open',
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'new_end before new_start',
        value: { option_id: 'move_event', params: { new_start: TS_LATER, new_end: TS } },
      },
      {
        part: 'response',
        why: 'unknown insight status',
        value: ok({
          approval: null,
          reply_draft: null,
          reminder_options_route: null,
          insight_status: 'resolved',
        }),
      },
    ],
  },
  'POST /meetings/:eventId/prep': {
    valid: {
      params: { eventId: uuid(61) },
      body: { refresh: true },
      response: ok({ prep: meetingPrepView, job: null }),
    },
    invalid: [
      { part: 'body', why: 'refresh must be boolean', value: { refresh: 1 } },
      {
        part: 'response',
        why: 'join url off the conferencing allow-list',
        value: ok({
          prep: withPath(meetingPrepView, 'event.join_url', 'https://evil.example.com/meet'),
          job: null,
        }),
      },
      {
        part: 'response',
        why: 'talking point without sources',
        value: ok({ prep: withPath(meetingPrepView, 'talking_points.0.sources', []), job: null }),
      },
    ],
  },
  'POST /meetings/:eventId/notes': {
    valid: {
      params: { eventId: uuid(61) },
      body: { client_note_id: uuid(71), body: 'Teklif Cuma’ya.', source: 'text' },
      response: ok({
        id: uuid(72),
        calendar_event_id: uuid(61),
        body: 'Teklif Cuma’ya.',
        source: 'text',
        created_at: TS,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'transcript confidence only for voice',
        value: { client_note_id: uuid(71), body: 'x', source: 'text', transcript_confidence: 0.9 },
      },
      {
        part: 'response',
        why: 'created_at missing',
        value: ok({ id: uuid(72), calendar_event_id: uuid(61), body: 'x', source: 'text' }),
      },
    ],
  },
  'POST /meetings/:eventId/post': {
    valid: {
      params: { eventId: uuid(61) },
      body: {
        client_post_id: uuid(73),
        text: 'Mehmet’e yarın teklif göndereceğim.',
        source: 'voice',
      },
      response: ok({
        note_id: uuid(72),
        proposals: [
          {
            approval: commitmentApprovalView,
            text: 'Teklif gönder',
            counterparty_label: 'Mehmet Yılmaz',
            due_at: TS_LATER,
            due_text: 'yarın',
            direction: 'user_owes',
            confidence: 0.8,
            quote: 'Mehmet’e yarın teklif göndereceğim.',
          },
        ],
        none_found: false,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'empty text',
        value: { client_post_id: uuid(73), text: '', source: 'text' },
      },
      {
        part: 'response',
        why: 'commitment card cannot target a provider',
        value: ok({
          note_id: uuid(72),
          proposals: [
            {
              approval: { ...commitmentApprovalView, destination: approvalView.destination },
              text: 't',
              counterparty_label: 'c',
              due_at: null,
              due_text: null,
              direction: 'user_owes',
              confidence: 0.5,
              quote: 'q',
            },
          ],
          none_found: false,
        }),
      },
    ],
  },
  'POST /meetings/:eventId/prep/audio': {
    valid: {
      params: { eventId: uuid(61) },
      body: { prep_version_hash: 'abc123' },
      response: ok({
        mode: 'native',
        language: 'tr-TR',
        paragraphs: ['Mehmet Bey fiyatı soruyor.'],
        notice_key: 'audio.native_fallback',
        premium_status: 'unavailable',
      }),
    },
    invalid: [
      { part: 'body', why: 'hash too long', value: { prep_version_hash: 'x'.repeat(65) } },
      { part: 'response', why: 'unknown mode', value: ok({ mode: 'hybrid' }) },
    ],
  },
  'POST /assistant/threads': {
    valid: {
      body: { client_thread_id: uuid(74) },
      response: ok({ id: uuid(75), scope: { type: 'global' }, created_at: TS }),
    },
    invalid: [
      {
        part: 'body',
        why: 'person scope needs a contact',
        value: { client_thread_id: uuid(74), scope: { type: 'person' } },
      },
      { part: 'response', why: 'id missing', value: ok({ scope: {}, created_at: TS }) },
    ],
  },
  'POST /assistant/threads/:id/messages': {
    valid: {
      params: { id: uuid(75) },
      body: {
        client_message_id: uuid(76),
        content: 'Bugün neye odaklanmalıyım?',
        input_mode: 'text',
      },
      response: ok({
        assistant_message: {
          id: uuid(80),
          thread_id: uuid(75),
          answer: assistantAnswer,
          finish_reason: 'stop',
          created_at: TS,
        },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'blank content',
        value: { client_message_id: uuid(76), content: '   ', input_mode: 'text' },
      },
      {
        part: 'body',
        why: 'content over 2,000 chars',
        value: { client_message_id: uuid(76), content: 'x'.repeat(2001), input_mode: 'voice' },
      },
      {
        part: 'response',
        why: 'unknown finish reason',
        value: ok({
          assistant_message: {
            id: uuid(80),
            thread_id: uuid(75),
            answer: assistantAnswer,
            finish_reason: 'timeout',
            created_at: TS,
          },
        }),
      },
    ],
  },
  'POST /assistant/transcribe': {
    valid: {
      body: { language: 'tr-TR', purpose: 'assistant', duration_ms: '12000' },
      response: ok({
        text: 'Yarın yoğun muyum?',
        duration_s: 12,
        language: 'tr-TR',
        confidence: 0.9,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'longer than 120 s',
        value: { language: 'tr-TR', purpose: 'assistant', duration_ms: '130000' },
      },
      {
        part: 'response',
        why: 'text over 10,000 chars',
        value: ok({ text: 'x'.repeat(10001), duration_s: 1, language: 'tr-TR', confidence: null }),
      },
    ],
  },
  'GET /search': {
    valid: {
      query: { q: 'teklif', types: 'email,person' },
      response: ok({ mode: 'hybrid', results: [searchResult] }),
    },
    invalid: [
      { part: 'query', why: 'query shorter than 2 chars', value: { q: 'a' } },
      { part: 'query', why: 'unknown type', value: { q: 'teklif', types: 'email,secrets' } },
      { part: 'response', why: 'unknown search mode', value: ok({ mode: 'vector', results: [] }) },
      {
        part: 'response',
        why: 'emphasis span outside the answer',
        value: ok({
          mode: 'hybrid',
          results: [],
          answer: {
            text: 'kısa',
            emphasis_spans: [{ start: 0, end: 50 }],
            confidence_label: 'high',
            source_count: 1,
          },
        }),
      },
    ],
  },
  'POST /captures/upload-url': {
    valid: {
      body: {
        client_capture_id: uuid(51),
        kind: 'pdf',
        mime: 'application/pdf',
        size_bytes: 1000,
        file_name: 'teklif.pdf',
        sha256: SHA,
        share_origin: 'in_app',
      },
      response: ok({
        capture_id: uuid(50),
        upload: {
          signed_url: 'https://api.dijitalasistan.app/storage/v1/upload',
          token: 't',
          path: 'p',
          expires_at: TS_LATER,
          headers: {},
        },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'photo kind with PDF mime',
        value: {
          client_capture_id: uuid(51),
          kind: 'photo',
          mime: 'application/pdf',
          size_bytes: 1,
          sha256: SHA,
          share_origin: 'in_app',
        },
      },
      {
        part: 'body',
        why: 'image over 15 MiB',
        value: {
          client_capture_id: uuid(51),
          kind: 'photo',
          mime: 'image/png',
          size_bytes: 16 * 1024 * 1024,
          sha256: SHA,
          share_origin: 'in_app',
        },
      },
      {
        part: 'response',
        why: 'headers must be strings',
        value: ok({
          capture_id: uuid(50),
          upload: {
            signed_url: 'https://x.test',
            token: 't',
            path: 'p',
            expires_at: TS,
            headers: { a: 1 },
          },
        }),
      },
    ],
  },
  'POST /captures': {
    valid: {
      body: {
        client_capture_id: uuid(52),
        share_origin: 'ios_share',
        source: { kind: 'link', url: 'https://example.com/etkinlik' },
      },
      response: ok(capture),
    },
    invalid: [
      {
        part: 'body',
        why: 'http links are rejected (R-11)',
        value: {
          client_capture_id: uuid(52),
          share_origin: 'in_app',
          source: { kind: 'link', url: 'http://example.com' },
        },
      },
      {
        part: 'body',
        why: 'empty share',
        value: {
          client_capture_id: uuid(52),
          share_origin: 'android_send',
          source: { kind: 'share' },
        },
      },
      {
        part: 'response',
        why: 'unknown capture status',
        value: ok({ ...capture, status: 'lost' }),
      },
    ],
  },
  'POST /captures/:id/analyze': {
    valid: {
      params: { id: uuid(50) },
      body: { hint_type: 'event' },
      response: ok({ capture: { ...capture, status: 'analyzing' }, job: jobRef }),
    },
    invalid: [
      { part: 'body', why: 'unknown entity type', value: { hint_type: 'receipt' } },
      { part: 'response', why: 'job missing', value: ok({ capture }) },
    ],
  },
  'POST /captures/:id/actions': {
    valid: {
      params: { id: uuid(50) },
      body: {
        items: [
          {
            item_id: 'i1',
            action_type: 'calendar_create',
            destination: calendarCreatePayload.target,
          },
        ],
        save_to_memory: false,
      },
      response: ok({ approvals: [approvalView], batch_id: uuid(50), memory_saved: false }),
    },
    invalid: [
      { part: 'body', why: 'nothing to do', value: { items: [], save_to_memory: false } },
      {
        part: 'body',
        why: 'email_send is not a capture action',
        value: { items: [{ item_id: 'i1', action_type: 'email_send', destination: null }] },
      },
      {
        part: 'response',
        why: 'batch id missing',
        value: ok({ approvals: [], memory_saved: true }),
      },
    ],
  },
  'POST /captures/:id/discard': {
    valid: {
      params: { id: uuid(50) },
      body: {},
      response: ok({ ...capture, status: 'discarded' }),
    },
    invalid: [
      { part: 'params', why: 'id not a uuid', value: { id: 'capture-1' } },
      {
        part: 'response',
        why: 'unknown error code',
        value: ok({ ...capture, error_code: 'OOPS' }),
      },
    ],
  },
  'POST /briefings/:id/audio': {
    valid: {
      params: { id: uuid(64) },
      body: { prefer: 'native' },
      response: ok({
        mode: 'premium',
        url: 'https://api.dijitalasistan.app/storage/v1/object/sign/briefing-audio/x.mp3',
        url_expires_at: TS_LATER,
        duration_s: 120,
        chapters: [{ index: 0, title: 'Genel bakış', start_s: 0, duration_s: 20 }],
      }),
    },
    invalid: [
      { part: 'body', why: 'unknown preference', value: { prefer: 'loud' } },
      {
        part: 'response',
        why: 'native chapter text over 4,000 chars',
        value: ok({
          mode: 'native',
          language: 'tr-TR',
          chapters: [{ index: 0, title: 't', text: 'x'.repeat(4001), est_duration_s: 1 }],
          notice_key: null,
          premium_status: null,
        }),
      },
    ],
  },
  'POST /briefings/:id/evening-ready': {
    valid: {
      params: { id: uuid(64) },
      body: { confirm: true },
      response: ok({ carried: 2, next_morning_at: TS_LATER, closed_at: TS }),
    },
    invalid: [
      { part: 'body', why: 'confirmation required', value: { carry_over_item_ids: [] } },
      {
        part: 'response',
        why: 'negative carried',
        value: ok({ carried: -1, next_morning_at: TS, closed_at: TS }),
      },
    ],
  },
  'GET /weekly/:id/share-card': {
    valid: { params: { id: uuid(64) }, response: ok(shareCard) },
    invalid: [
      { part: 'params', why: 'id not a uuid', value: { id: 'week-38' } },
      {
        part: 'response',
        why: 'no people section may ever appear (SREQ-07)',
        value: ok({ ...shareCard, people: ['Mehmet'] }),
      },
      {
        part: 'response',
        why: 'metrics are integers only',
        value: ok(withPath(shareCard, 'metrics.meetings', 'dokuz')),
      },
    ],
  },
  'POST /briefings/:id/retry': {
    valid: {
      params: { id: uuid(64) },
      body: {},
      response: ok({ briefing_id: uuid(64), status: 'scheduled', job: jobRef }),
    },
    invalid: [
      { part: 'body', why: 'no fields accepted', value: { force: true } },
      {
        part: 'response',
        why: 'unknown briefing status',
        value: ok({ briefing_id: uuid(64), status: 'retrying', job: jobRef }),
      },
    ],
  },
  'POST /referrals/apply': {
    valid: {
      body: { code: 'ab3k7m', installation_id: uuid(1), source: 'manual' },
      response: ok({
        referral_id: uuid(77),
        status: 'pending',
        reward_days: 14,
        qualification: {
          onboarding_completed: false,
          account_connected: true,
          first_briefing_delivered: false,
          eligible_after: TS_LATER,
        },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'ambiguous alphabet',
        value: { code: 'O0I1LX', installation_id: uuid(1), source: 'manual' },
      },
      {
        part: 'response',
        why: 'status rewarded is not an apply result',
        value: ok({
          referral_id: uuid(77),
          status: 'rewarded',
          reward_days: 14,
          qualification: {
            onboarding_completed: true,
            account_connected: true,
            first_briefing_delivered: true,
            eligible_after: TS,
          },
        }),
      },
    ],
  },
  'GET /referrals/me': {
    valid: {
      response: ok({
        code: 'AB3K7M9Q',
        share_url: 'https://dijitalasistan.app/r/AB3K7M9Q',
        reward_days: 14,
        cap_per_year: 6,
        remaining_this_year: 5,
        earned_days_total: 14,
        referrals: [{ id: uuid(77), label: 'A***', status: 'rewarded', created_at: TS }],
        referred_by: null,
      }),
    },
    invalid: [
      {
        part: 'response',
        why: 'labels never include emails',
        value: ok({
          code: 'AB3K7M9Q',
          share_url: 'https://dijitalasistan.app/r/AB3K7M9Q',
          reward_days: 14,
          cap_per_year: 6,
          remaining_this_year: 5,
          earned_days_total: 0,
          referrals: [
            { id: uuid(77), label: 'ahmet@example.com', status: 'pending', created_at: TS },
          ],
          referred_by: null,
        }),
      },
    ],
  },
  'POST /purchases/sync': {
    valid: {
      body: { reason: 'purchase', rc_app_user_id: uuid(2) },
      response: ok({ entitlement, stale: false }),
    },
    invalid: [
      { part: 'body', why: 'unknown reason', value: { reason: 'refund', rc_app_user_id: uuid(2) } },
      { part: 'response', why: 'stale missing', value: ok({ entitlement }) },
    ],
  },
  'POST /privacy/export': {
    valid: {
      body: { include: ['profile', 'insights'] },
      response: ok({ request_id: uuid(78), status: 'requested' }),
    },
    invalid: [
      { part: 'body', why: 'empty include', value: { include: [] } },
      {
        part: 'body',
        why: 'secrets are never exportable',
        value: { include: ['oauth_credentials'] },
      },
      {
        part: 'response',
        why: 'unknown export status',
        value: ok({ request_id: uuid(78), status: 'zipping' }),
      },
    ],
  },
  'POST /privacy/delete-history': {
    valid: {
      body: { scope: { type: 'all_analysis' }, confirm: true },
      response: ok({
        request_id: uuid(79),
        status: 'queued',
        will_delete: {
          summaries: 10,
          priority_decisions: 20,
          memory_chunks: 30,
          assistant_threads: 2,
          learned_preferences: 1,
          insights: 40,
          briefings: 7,
        },
        preserved: ['vip', 'priority_rules'],
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'account scope needs the account id',
        value: { scope: { type: 'connected_account' }, confirm: true },
      },
      {
        part: 'response',
        why: 'unknown preserved set',
        value: ok({
          request_id: uuid(79),
          status: 'queued',
          will_delete: {
            summaries: 0,
            priority_decisions: 0,
            memory_chunks: 0,
            assistant_threads: 0,
            learned_preferences: 0,
            insights: 0,
            briefings: 0,
          },
          preserved: ['tokens'],
        }),
      },
    ],
  },
  'POST /privacy/delete-account': {
    valid: {
      body: { confirm_text: 'SİL', acknowledge_subscription: true },
      response: ok({
        request_id: uuid(81),
        status: 'queued',
        status_token: B64_32,
        subscription_notice: { active: false, management_url: null },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'confirmation token must match exactly',
        value: { confirm_text: 'SIL', acknowledge_subscription: true },
      },
      {
        part: 'response',
        why: 'status is always queued',
        value: ok({
          request_id: uuid(81),
          status: 'completed',
          status_token: B64_32,
          subscription_notice: { active: false, management_url: null },
        }),
      },
    ],
  },
  'POST /privacy/export/:id/download': {
    valid: {
      params: { id: uuid(78) },
      body: {},
      response: ok({
        signed_url: 'https://api.dijitalasistan.app/storage/v1/object/sign/exports/x.zip',
        expires_at: TS_LATER,
        file_size_bytes: 2048,
        sha256: SHA,
      }),
    },
    invalid: [
      { part: 'params', why: 'id not a uuid', value: { id: 'latest' } },
      {
        part: 'response',
        why: 'sha256 malformed',
        value: ok({
          signed_url: 'https://x.test',
          expires_at: TS,
          file_size_bytes: 1,
          sha256: 'xyz',
        }),
      },
    ],
  },
  'POST /support/tickets': {
    valid: {
      body: {
        category: 'sync',
        subject: 'Senkron sorunu',
        message: 'Mailler iki gündür gelmiyor.',
      },
      response: ok({ id: uuid(82), reference: 'DA-7K3M9Q', status: 'open' }),
    },
    invalid: [
      {
        part: 'body',
        why: 'message under 10 chars',
        value: { category: 'sync', subject: 'Sorun', message: 'kısa' },
      },
      {
        part: 'response',
        why: 'reference format',
        value: ok({ id: uuid(82), reference: '12345', status: 'open' }),
      },
    ],
  },
  'POST /feedback': {
    valid: { body: { type: 'bug', rating: 4 }, response: ok({ id: uuid(83) }) },
    invalid: [
      { part: 'body', why: 'message or rating required', value: { type: 'bug' } },
      { part: 'body', why: 'rating above 5', value: { type: 'general', rating: 6 } },
      { part: 'response', why: 'id missing', value: ok({}) },
    ],
  },
  'POST /android-notifications/signals': {
    valid: {
      body: {
        installation_id: uuid(1),
        signals: [
          {
            signal_hash: SHA,
            package: 'com.trendyol.android',
            app_label: 'Trendyol',
            category: 'cargo',
            tracking_status: 'in_transit',
            due_date: DAY,
            posted_at: TS,
          },
        ],
      },
      response: ok({ accepted: 1, duplicates: 0, rejected: 0 }),
    },
    invalid: [
      {
        part: 'body',
        why: 'raw notification text is never uploaded',
        value: {
          installation_id: uuid(1),
          signals: [
            {
              signal_hash: SHA,
              package: 'com.a.b',
              app_label: 'A',
              category: 'other',
              posted_at: TS,
              text: 'Kodun: 123456',
            },
          ],
        },
      },
      { part: 'body', why: 'empty batch', value: { installation_id: uuid(1), signals: [] } },
      { part: 'response', why: 'accepted missing', value: ok({ duplicates: 0, rejected: 0 }) },
    ],
  },
  'POST /analytics/events': {
    valid: {
      body: {
        session_id: uuid(84),
        events: [{ name: 'briefing_open', ts: TS, props: { source: 'push' } }],
      },
      response: ok({ accepted: 1, dropped: 0 }),
    },
    invalid: [
      { part: 'body', why: 'empty batch', value: { session_id: uuid(84), events: [] } },
      {
        part: 'body',
        why: 'more than 100 events',
        value: {
          session_id: uuid(84),
          events: Array.from({ length: 101 }, () => ({ name: 'x_y_z', ts: TS })),
        },
      },
      { part: 'response', why: 'dropped missing', value: ok({ accepted: 1 }) },
    ],
  },
  'GET /widgets/snapshot': {
    valid: { response: ok(widgetSnapshot) },
    invalid: [
      {
        part: 'response',
        why: 'generic mode carries counts only',
        value: ok({ ...widgetSnapshot, detail_mode: 'generic' }),
      },
      {
        part: 'response',
        why: 'no extra (mail body) fields',
        value: ok({ ...widgetSnapshot, snippet: 'Merhaba Yunus Bey…' }),
      },
      {
        part: 'response',
        why: 'priorities capped at 3',
        value: ok({
          ...widgetSnapshot,
          priorities: Array.from({ length: 4 }, () => widgetSnapshot.priorities[0]),
        }),
      },
    ],
  },
} satisfies Record<ApiRouteKey, RouteFixture>;
