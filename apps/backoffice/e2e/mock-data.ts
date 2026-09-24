/**
 * Stateful, synthetic dataset behind the mock admin-api (BACKOFFICE_PLAN §13.4). Every person, email
 * address and number here is invented for tests; times are relative to the moment of `/__mock/reset`
 * so relative UI (today's briefings, countdowns, "son 24 saat") behaves as in production. Row shapes
 * are typed from the `@da/validation` registry, and every reply is parsed again before it is sent.
 */
import type { z } from 'zod';

import { AI_FEATURE_VALUES, type ADMIN_ROLE_VALUES } from '@da/domain';
import { PROMPT_KEY_VALUES } from '@da/validation';
import type * as A from '@da/validation/admin/index';
import { R10_FLAG_KEYS } from '@da/validation/admin/product';

import { ADMIN_EMAIL, ADMIN_ID } from './fixtures.ts';

type Row<T extends z.ZodType> = z.infer<T>;
export type Role = (typeof ADMIN_ROLE_VALUES)[number];
type Feature = (typeof AI_FEATURE_VALUES)[number];

export const MAIN_USER_ID = '0190f5e0-1111-7000-8000-00000000abcd';
export const MAIN_USER_EMAIL = 'yusuf.demir@gmail.com';
export const DEAD_JOB_ID = '0190f5e0-4444-7000-8000-000000000001';
export const FAILED_BRIEFING_ID = '0190f5e0-5555-7000-8000-000000000001';
export const TICKET_ID = '0190f5e0-8888-7000-8000-000000000001';
export const FLAGGED_REFERRAL_ID = '0190f5e0-aaaa-7000-8000-000000000001';
export const FAILED_EXPORT_ID = '0190f5e0-dddd-7000-8000-000000000001';
export const SUPER_ADMIN_ID = '0190f5e0-0000-7000-8000-000000000002';
export const SUPPORT_ADMIN_ID = '0190f5e0-0000-7000-8000-000000000003';
export const INVITED_ADMIN_ID = '0190f5e0-0000-7000-8000-000000000005';

/**
 * A valid UUIDv7-shaped id in a per-entity namespace (`group` is four hex digits). The leading
 * timestamp segment varies with `n`, so short ids (first 8 characters) differ between rows.
 */
export function uid(group: string, n: number): string {
  const head = (0x0190f5e0 + n * 0x1b3 + parseInt(group, 16)).toString(16).padStart(8, '0');
  return `${head}-${group}-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `YYYY-MM-DD` of `ms` in Europe/Istanbul (the fixtures' user and admin zone). */
export function istanbulDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export interface MockUser {
  id: string;
  email: string;
  plan: 'free' | 'pro' | 'trial';
  created_at: string;
  last_active_at: string | null;
  platform: 'ios' | 'android' | null;
  status: 'active' | 'disabled' | 'deletion_pending';
  internal: boolean;
  app_version: string | null;
}

export interface MockAccount {
  account_id: string;
  user_id: string;
  provider: 'google' | 'microsoft' | 'apple_device' | 'android_device' | 'demo';
  email: string | null;
  status: Row<typeof A.IntegrationRow>['status'];
  last_sync_at: string | null;
  last_error_code: string | null;
  watch_expires_at: string | null;
  key_version: number | null;
}

export interface MockTicket {
  row: Row<typeof A.TicketRow>;
  user_id: string;
  source: 'app' | 'web';
  assignee_id: string | null;
  message: string;
  diagnostics: Record<string, unknown> | null;
  notes: Row<typeof A.TicketDetailResponse>['data']['notes'];
}

export interface MockGrant {
  row: Row<typeof A.EntitlementGrantRow>;
}

export interface MockSupportGrant {
  id: string;
  user_id: string;
  admin_id: string;
  admin_name: string | null;
  scopes: Row<typeof A.SupportAccessGrant>['scopes'];
  reason: string;
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  reveal_count: number;
}

export interface MockPromptVersion {
  version: number;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  template_system: string;
  template_user: string;
  output_schema: Row<typeof A.PromptDraftBody>['output_schema'];
  notes: string | null;
  requests: number;
  error_rate: number;
  feedback_positive_rate: number | null;
}

export interface MockFlag {
  row: Row<typeof A.FlagRow>;
  description: string | null;
  archived_at: string | null;
  overrides: Row<typeof A.FlagDetailResponse>['data']['overrides'];
  history: Row<typeof A.FlagDetailResponse>['data']['history'];
}

export interface MockAnnouncement {
  detail: Row<typeof A.AnnouncementDetailResponse>['data'];
}

export interface MockDataRequest {
  row: Row<typeof A.DataRequestRow>;
  user_id: string;
  job: Row<typeof A.DataRequestDetailResponse>['data']['job'];
  steps: Row<typeof A.DataRequestDetailResponse>['data']['steps'];
}

export interface MockAudit {
  row: Row<typeof A.AuditDetailResponse>['data'];
  actor_id: string | null;
}

export interface MockAdmin {
  row: Row<typeof A.AdminUserRow>;
  display_name: string;
}

export interface Dataset {
  users: MockUser[];
  accounts: MockAccount[];
  jobs: Row<typeof A.JobDetailResponse>['data'][];
  briefings: Row<typeof A.AdminBriefingRow>[];
  briefingExtra: Map<
    string,
    {
      item_count: number;
      ai_cost_usd: number;
      decision: Row<typeof A.UserBriefingRow>['notification_decision'];
      skip_reason: string | null;
      error_code: string | null;
      scheduled_for: string | null;
    }
  >;
  notifications: (Row<typeof A.AdminNotificationRow> & { user_id: string })[];
  aiRequests: (Row<typeof A.AiRequestRow> & { user_id: string | null })[];
  models: Row<typeof A.ModelConfigRow>[];
  planProfiles: { free: 'balanced' | 'lean'; pro: 'balanced' | 'lean' };
  prompts: Map<string, MockPromptVersion[]>;
  aiFeedback: Row<typeof A.AiFeedbackRow>[];
  aiFeedbackComments: Map<string, string>;
  subscriptions: Row<typeof A.SubscriptionRow>[];
  billingEvents: Row<typeof A.BillingEventDetailResponse>['data'][];
  grants: MockGrant[];
  referrals: Row<typeof A.AdminReferralRow>[];
  tickets: MockTicket[];
  supportGrants: MockSupportGrant[];
  feedback: (Row<typeof A.FeedbackRow> & { user_email: string | null })[];
  flags: MockFlag[];
  announcements: MockAnnouncement[];
  dataRequests: MockDataRequest[];
  audit: MockAudit[];
  health: Row<typeof A.HealthSummaryResponse>['data']['components'];
  admins: MockAdmin[];
  planLimits: Row<typeof A.SettingsResponse>['data']['plan_limits'];
  appSettings: Record<string, unknown>;
}

function at(now: number, offsetMs: number): string {
  return new Date(now + offsetMs).toISOString();
}

const USERS: readonly [
  string,
  MockUser['plan'],
  MockUser['platform'],
  MockUser['status'],
  number,
][] = [
  [MAIN_USER_EMAIL, 'pro', 'ios', 'active', 210],
  ['elif.kaya@outlook.com', 'free', 'android', 'active', 180],
  ['mert.aydin@gmail.com', 'trial', 'ios', 'active', 12],
  ['zeynep.sahin@icloud.com', 'pro', 'ios', 'active', 95],
  ['can.ozturk@gmail.com', 'free', 'android', 'disabled', 140],
  ['deniz.arslan@hotmail.com', 'free', 'ios', 'deletion_pending', 60],
  ['ayse.celik@gmail.com', 'pro', 'android', 'active', 320],
  ['burak.yildiz@gmail.com', 'free', 'ios', 'active', 45],
  ['selin.koc@yandex.com', 'trial', 'android', 'active', 5],
  ['emre.polat@gmail.com', 'free', 'ios', 'active', 30],
  ['gizem.acar@outlook.com', 'pro', 'ios', 'active', 400],
  ['onur.kurt@gmail.com', 'free', 'android', 'active', 2],
];

function buildUsers(now: number): MockUser[] {
  return USERS.map(([email, plan, platform, status, ageDays], index) => ({
    id: index === 0 ? MAIN_USER_ID : uid('1111', index + 1),
    email,
    plan,
    created_at: at(now, -ageDays * DAY),
    last_active_at: status === 'active' ? at(now, -(index + 1) * 3 * HOUR) : at(now, -20 * DAY),
    platform,
    status,
    internal: false,
    app_version: platform === 'ios' ? (index % 3 === 0 ? '1.4.2' : '1.4.1') : '1.3.9',
  }));
}

function buildAccounts(now: number, users: readonly MockUser[]): MockAccount[] {
  const accounts: MockAccount[] = [];
  users.forEach((user, index) => {
    const failing = index === 0 ? null : index % 4 === 1 ? 'invalid_grant' : null;
    accounts.push({
      account_id: uid('3333', index * 2 + 1),
      user_id: user.id,
      provider: index % 3 === 2 ? 'microsoft' : 'google',
      email: user.email,
      status:
        user.status === 'disabled' ? 'disconnected' : failing === null ? 'healthy' : 'needs_reauth',
      last_sync_at: at(now, -(index + 1) * 11 * 60_000),
      last_error_code: failing,
      watch_expires_at: at(now, (index % 5 === 0 ? 20 : 96) * HOUR),
      key_version: 2,
    });
  });
  accounts.push({
    account_id: uid('3333', 2),
    user_id: MAIN_USER_ID,
    provider: 'microsoft',
    email: 'yusuf.demir@firma.com.tr',
    status: 'error',
    last_sync_at: at(now, -26 * HOUR),
    last_error_code: 'graph_throttled',
    watch_expires_at: at(now, 6 * HOUR),
    key_version: 1,
  });
  return accounts;
}

type Job = Dataset['jobs'][number];

function buildJobs(now: number, users: readonly MockUser[]): Job[] {
  const specs: [Job['type'], Job['status'], number, string | null, number][] = [
    ['gmail_sync', 'dead_letter', 5, 'provider_timeout', -3 * HOUR],
    ['calendar_sync', 'failed', 3, 'rate_limited', -2 * HOUR],
    ['briefing', 'completed', 1, null, -90 * 60_000],
    ['email_triage', 'running', 1, null, -2 * 60_000],
    ['outlook_sync', 'retrying', 2, 'graph_throttled', -40 * 60_000],
    ['push_receipts', 'failed', 3, 'expo_unavailable', -5 * HOUR],
    ['export', 'failed', 3, 'storage_write_failed', -30 * HOUR],
    ['notification', 'queued', 0, null, 5 * 60_000],
    ['embedding', 'completed', 1, null, -6 * HOUR],
    ['watch_renewal', 'completed', 1, null, -8 * HOUR],
    ['gmail_sync', 'dead_letter', 5, 'invalid_grant', -26 * HOUR],
    ['billing_sync', 'completed', 1, null, -12 * HOUR],
    ['meeting_prep', 'queued', 0, null, 20 * 60_000],
    ['insight_refresh', 'completed', 2, null, -4 * HOUR],
    ['approval_execute', 'failed', 3, 'provider_rejected', -7 * HOUR],
  ];
  return specs.map(([type, status, attempts, error, offset], index) => {
    const id = index === 0 ? DEAD_JOB_ID : uid('4444', index + 1);
    const userId =
      type === 'push_receipts' ? null : (users[index % users.length]?.id ?? MAIN_USER_ID);
    const created = now + offset - 15 * 60_000;
    const history: Job['attempts_history'] = Array.from({ length: attempts }, (_, i) => ({
      attempt: i + 1,
      outcome:
        i + 1 < attempts
          ? 'retrying'
          : status === 'dead_letter'
            ? 'dead_letter'
            : status === 'failed'
              ? 'failed'
              : status === 'running'
                ? 'running'
                : status === 'retrying'
                  ? 'retrying'
                  : 'completed',
      error_code: i + 1 < attempts || status !== 'completed' ? error : null,
      duration_ms: status === 'running' && i + 1 === attempts ? null : 1_800 + i * 950,
      started_at: new Date(created + i * 4 * 60_000).toISOString(),
    }));
    return {
      id,
      type,
      status,
      attempts,
      max_attempts: 5,
      last_error_code: error,
      run_after: at(now, offset),
      created_at: new Date(created).toISOString(),
      correlation_id: `corr-${id.slice(-8)}-${index.toString().padStart(2, '0')}`,
      user_id: userId,
      payload: {
        ...(userId === null ? {} : { user_id: userId }),
        ...(type.includes('sync') ? { account_id: uid('3333', index + 1), resource: 'mail' } : {}),
        attempt_budget: 5,
      },
      attempts_history: history,
      children:
        type === 'briefing'
          ? [{ id: uid('4444', 100 + index), type: 'notification', status: 'completed' }]
          : [],
    };
  });
}

function buildBriefings(
  now: number,
  users: readonly MockUser[],
): Pick<Dataset, 'briefings' | 'briefingExtra'> {
  const briefings: Dataset['briefings'] = [];
  const extra: Dataset['briefingExtra'] = new Map();
  const today = istanbulDate(now);
  for (let day = 0; day < 7; day += 1) {
    const date = istanbulDate(now - day * DAY);
    const failed = day === 0;
    const id = failed ? FAILED_BRIEFING_ID : uid('5555', day + 1);
    briefings.push({
      id,
      user_id: MAIN_USER_ID,
      kind: 'morning',
      local_date: date,
      status: failed ? 'failed' : 'delivered',
      generated_at: failed ? null : at(now, -day * DAY - 6 * HOUR),
      delivered_at: failed ? null : at(now, -day * DAY - 6 * HOUR + 40_000),
      latency_ms: failed ? null : 4_200 + day * 310,
      narrative_mode: failed ? null : day === 3 ? 'template' : 'llm',
    });
    extra.set(id, {
      item_count: failed ? 0 : 6 + day,
      ai_cost_usd: failed ? 0.0031 : 0.0124 + day / 1000,
      decision: failed ? null : 'sent',
      skip_reason: null,
      error_code: failed ? 'ai_provider_timeout' : null,
      scheduled_for: at(now, -day * DAY - 6 * HOUR - 60_000),
    });
  }
  users.slice(1, 8).forEach((user, index) => {
    const id = uid('5555', 20 + index);
    const status = index === 2 ? 'skipped' : index === 4 ? 'failed' : 'delivered';
    briefings.push({
      id,
      user_id: user.id,
      kind: index % 2 === 0 ? 'morning' : 'evening',
      local_date: today,
      status,
      generated_at: status === 'delivered' ? at(now, -(index + 2) * HOUR) : null,
      delivered_at: status === 'delivered' ? at(now, -(index + 2) * HOUR + 30_000) : null,
      latency_ms: status === 'delivered' ? 3_600 + index * 420 : null,
      narrative_mode: status === 'delivered' ? 'llm' : null,
    });
    extra.set(id, {
      item_count: status === 'delivered' ? 4 + index : 0,
      ai_cost_usd: status === 'delivered' ? 0.011 : 0,
      decision: status === 'delivered' ? 'sent' : null,
      skip_reason: status === 'skipped' ? 'no_new_items' : null,
      error_code: status === 'failed' ? 'schema_validation_failed' : null,
      scheduled_for: at(now, -(index + 2) * HOUR - 60_000),
    });
  });
  return { briefings, briefingExtra: extra };
}

function buildNotifications(now: number, users: readonly MockUser[]): Dataset['notifications'] {
  const specs: [
    Dataset['notifications'][number]['category'],
    Dataset['notifications'][number]['decision'],
    string | null,
  ][] = [
    ['morning', 'sent', null],
    ['critical_email', 'sent', null],
    ['meeting', 'suppressed', 'quiet_hours'],
    ['deadline', 'sent', null],
    ['follow_up', 'deduplicated', 'dedupe_window'],
    ['life_intel', 'suppressed', 'daily_cap'],
    ['approval', 'sent', null],
    ['evening', 'failed', 'device_not_registered'],
    ['account', 'sent', null],
    ['midday', 'scheduled', null],
  ];
  return specs.map(([category, decision, reason], index) => ({
    id: uid('6666', index + 1),
    user_id: index < 4 ? MAIN_USER_ID : (users[index]?.id ?? MAIN_USER_ID),
    category,
    decision,
    decision_reason: reason,
    detail_mode: category === 'critical_email' ? 'title_only' : 'full',
    sent_at:
      decision === 'sent' || decision === 'failed' ? at(now, -(index + 1) * 47 * 60_000) : null,
    receipt_status: decision === 'sent' ? 'ok' : decision === 'failed' ? 'error' : null,
  }));
}

const FEATURE_MODELS: Partial<Record<Feature, [string, string, 't0' | 't1' | 't2' | 't3']>> = {
  email_triage: ['anthropic', 'claude-haiku-4-5', 't1'],
  thread_summary: ['anthropic', 'claude-haiku-4-5', 't1'],
  email_deep_extract: ['anthropic', 'claude-sonnet-4-5', 't2'],
  commitment_extract: ['anthropic', 'claude-sonnet-4-5', 't2'],
  life_intel_extract: ['anthropic', 'claude-haiku-4-5', 't1'],
  briefing_morning: ['anthropic', 'claude-sonnet-4-5', 't2'],
  briefing_midday: ['anthropic', 'claude-haiku-4-5', 't1'],
  briefing_evening: ['anthropic', 'claude-haiku-4-5', 't1'],
  weekly_review: ['anthropic', 'claude-sonnet-4-5', 't2'],
  meeting_prep: ['anthropic', 'claude-sonnet-4-5', 't2'],
  post_meeting_parse: ['anthropic', 'claude-haiku-4-5', 't1'],
  capture_extract: ['anthropic', 'claude-sonnet-4-5', 't2'],
  assistant_intent: ['anthropic', 'claude-haiku-4-5', 't1'],
  assistant_qa: ['anthropic', 'claude-sonnet-4-5', 't2'],
  reply_draft: ['anthropic', 'claude-sonnet-4-5', 't2'],
  follow_up_draft: ['anthropic', 'claude-haiku-4-5', 't1'],
  embedding_doc: ['voyage', 'voyage-4-lite', 't0'],
  embedding_query: ['voyage', 'voyage-4-lite', 't0'],
  stt: ['openai', 'gpt-4o-mini-transcribe', 't1'],
  tts: ['native', 'system-tts', 't0'],
  admin_probe: ['anthropic', 'claude-haiku-4-5', 't1'],
};

function buildModels(now: number): Dataset['models'] {
  const rows: Dataset['models'] = [];
  for (const profile of ['balanced', 'lean'] as const) {
    for (const feature of AI_FEATURE_VALUES) {
      const [provider, model, tier] = FEATURE_MODELS[feature] ?? [
        'anthropic',
        'claude-haiku-4-5',
        't1',
      ];
      const lean = profile === 'lean' && model === 'claude-sonnet-4-5';
      rows.push({
        profile,
        feature,
        tier,
        enabled: feature !== 'admin_probe' || profile === 'balanced',
        primary_target: {
          provider: provider as 'anthropic',
          model: lean ? 'claude-haiku-4-5' : model,
          ...(provider === 'anthropic' ? { max_output_tokens: tier === 't2' ? 4_000 : 1_500 } : {}),
        },
        fallback_targets:
          provider === 'anthropic' ? [{ provider: 'openai', model: 'gpt-5-mini' }] : [],
        escalation_target:
          feature === 'assistant_qa' && profile === 'balanced'
            ? { provider: 'anthropic', model: 'claude-opus-4-5', effort: 'medium' }
            : null,
        batch_policy: feature.startsWith('embedding') ? 'micro_batch' : 'realtime',
        cache_ttl: feature.startsWith('briefing') ? '1h' : feature === 'email_triage' ? '5m' : null,
        max_input_tokens: tier === 't2' ? 60_000 : 16_000,
        eval_status: feature === 'follow_up_draft' ? 'pending' : 'passed',
        retires_not_before: model === 'claude-sonnet-4-5' ? at(now, 21 * DAY) : null,
        version: 3,
      });
    }
  }
  return rows;
}

const PROMPT_SYSTEM =
  'Sen kullanıcının kişisel asistanısın. Yalnızca verilen kaynaklara dayan ve {{user_first_name}} için {{locale}} dilinde yaz.';
const PROMPT_USER =
  'Tarih: {{local_date}}\nÖğeler:\n{{items_json}}\nEn önemli {{max_items}} öğeyi seç ve kısa bir özet yaz.';

function buildPrompts(now: number): Dataset['prompts'] {
  const prompts: Dataset['prompts'] = new Map();
  for (const key of PROMPT_KEY_VALUES) {
    const schema: MockPromptVersion['output_schema'] = key.startsWith('briefing')
      ? 'BriefingMorningV1'
      : key === 'email_classification'
        ? 'EmailTriageV1'
        : key === 'thread_summary'
          ? 'ThreadSummaryV1'
          : 'AssistantGroundedJsonV1';
    const versions: MockPromptVersion[] = [
      {
        version: 1,
        status: 'archived',
        created_by: 'ai.ops@dijitalasistan.app',
        created_at: at(now, -60 * DAY),
        activated_at: at(now, -59 * DAY),
        template_system: PROMPT_SYSTEM,
        template_user: PROMPT_USER.replace('kısa bir özet', 'özet'),
        output_schema: schema,
        notes: 'İlk sürüm',
        requests: 18_420,
        error_rate: 0.021,
        feedback_positive_rate: 0.81,
      },
      {
        version: 2,
        status: 'active',
        created_by: 'ai.ops@dijitalasistan.app',
        created_at: at(now, -20 * DAY),
        activated_at: at(now, -18 * DAY),
        template_system: PROMPT_SYSTEM,
        template_user: PROMPT_USER,
        output_schema: schema,
        notes: 'Öncelik sırası netleştirildi',
        requests: 42_310,
        error_rate: 0.009,
        feedback_positive_rate: 0.87,
      },
    ];
    if (key === 'briefing_morning') {
      versions.push({
        version: 3,
        status: 'draft',
        created_by: 'ai.ops@dijitalasistan.app',
        created_at: at(now, -2 * DAY),
        activated_at: null,
        template_system: `${PROMPT_SYSTEM} Takvim çakışmalarını ayrıca belirt.`,
        template_user: PROMPT_USER,
        output_schema: schema,
        notes: 'Çakışma uyarısı eklendi',
        requests: 0,
        error_rate: 0,
        feedback_positive_rate: null,
      });
    }
    prompts.set(key, versions);
  }
  return prompts;
}

function buildAiRequests(now: number, users: readonly MockUser[]): Dataset['aiRequests'] {
  const features: Feature[] = [
    'email_triage',
    'briefing_morning',
    'assistant_qa',
    'thread_summary',
    'reply_draft',
    'embedding_doc',
    'meeting_prep',
    'capture_extract',
  ];
  return Array.from({ length: 24 }, (_, index) => {
    const feature = features[index % features.length] ?? 'email_triage';
    const [provider, model] = FEATURE_MODELS[feature] ?? ['anthropic', 'claude-haiku-4-5'];
    const status =
      index === 5
        ? 'error'
        : index === 11
          ? 'invalid_output'
          : index === 17
            ? 'timeout'
            : index % 6 === 3
              ? 'cached'
              : 'ok';
    return {
      id: uid('7777', index + 1),
      user_id: users[index % users.length]?.id ?? null,
      feature,
      provider,
      model,
      prompt_version_id: feature === 'embedding_doc' ? null : uid('1515', (index % 3) + 1),
      status,
      input_tokens: feature === 'embedding_doc' ? 820 : 2_400 + index * 137,
      output_tokens: feature === 'embedding_doc' ? 0 : 310 + index * 23,
      cache_read_tokens: status === 'cached' ? 1_900 : index % 2 === 0 ? 1_200 : 0,
      latency_ms: status === 'timeout' ? 30_000 : 900 + index * 173,
      cost_usd: Math.round((0.0009 + index * 0.00041) * 1e5) / 1e5,
      correlation_id: `corr-ai-${(index + 1).toString().padStart(4, '0')}`,
      created_at: at(now, -(index + 1) * 23 * 60_000),
    };
  });
}

function buildAiFeedback(now: number): Pick<Dataset, 'aiFeedback' | 'aiFeedbackComments'> {
  const reasons = ['wrong_priority', 'missing_item', null, 'too_long', null, 'hallucination'];
  const rows: Dataset['aiFeedback'] = Array.from({ length: 12 }, (_, index) => ({
    id: uid('1414', index + 1),
    feature:
      (['briefing_morning', 'assistant_qa', 'reply_draft', 'email_triage'] as const)[index % 4] ??
      null,
    model: index % 3 === 0 ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
    prompt_version: `v${String((index % 2) + 1)}`,
    rating: index % 3 === 1 ? -1 : 1,
    reason_code: index % 3 === 1 ? (reasons[index % reasons.length] ?? null) : null,
    created_at: at(now, -(index + 1) * 5 * HOUR),
  }));
  const comments = new Map<string, string>();
  for (const row of rows) {
    if (row.rating === -1) comments.set(row.id, 'Toplantı saatini yanlış öne çıkardı.');
  }
  return { aiFeedback: rows, aiFeedbackComments: comments };
}

function buildSubscriptions(
  now: number,
  users: readonly MockUser[],
): Pick<Dataset, 'subscriptions' | 'billingEvents'> {
  const subscriptions: Dataset['subscriptions'] = users
    .filter((u) => u.plan !== 'free')
    .map((user, index) => ({
      user_id: user.id,
      status: user.plan === 'trial' ? 'trial' : index === 2 ? 'billing_issue' : 'active',
      store: user.platform === 'android' ? 'play_store' : 'app_store',
      product_id: index % 2 === 0 ? 'da_pro_monthly' : 'da_pro_annual',
      period_type: user.plan === 'trial' ? 'TRIAL' : 'NORMAL',
      expires_at: at(now, (index + 3) * 4 * DAY),
      will_renew: index !== 3,
      source: 'store',
    }));
  const types = [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'TRIAL_STARTED',
    'CANCELLATION',
    'BILLING_ISSUE',
    'RENEWAL',
  ];
  const billingEvents: Dataset['billingEvents'] = types.map((type, index) => {
    const user = users.filter((u) => u.plan !== 'free')[index % 5] ?? users[0];
    return {
      event_id: `evt_${(index + 1).toString().padStart(4, '0')}`,
      type,
      store: user?.platform === 'android' ? 'PLAY_STORE' : 'APP_STORE',
      environment: 'PRODUCTION',
      product_id: index % 2 === 0 ? 'da_pro_monthly' : 'da_pro_annual',
      period_type: type === 'TRIAL_STARTED' ? 'TRIAL' : 'NORMAL',
      purchased_at: at(now, -(index + 1) * 3 * DAY),
      expiration_at: at(now, (index + 1) * 9 * DAY),
      event_at: at(now, -(index + 1) * 3 * DAY),
      price_usd: type === 'TRIAL_STARTED' ? 0 : index % 2 === 0 ? 4.99 : 39.99,
      price_local: type === 'TRIAL_STARTED' ? 0 : index % 2 === 0 ? 149.99 : 1_199.99,
      currency: 'TRY',
      cancel_reason: type === 'CANCELLATION' ? 'UNSUBSCRIBE' : null,
      expiration_reason: null,
      is_trial_conversion: type === 'INITIAL_PURCHASE' ? true : null,
      received_at: at(now, -(index + 1) * 3 * DAY + 4_000),
      processed_at: type === 'BILLING_ISSUE' ? null : at(now, -(index + 1) * 3 * DAY + 9_000),
      processing_error_code: type === 'BILLING_ISSUE' ? 'user_not_found' : null,
      job_id: uid('4444', 200 + index),
      user_id: user?.id ?? null,
    };
  });
  return { subscriptions, billingEvents };
}

function buildGrants(now: number, users: readonly MockUser[]): MockGrant[] {
  const second = users[1];
  return [
    {
      row: {
        id: uid('9999', 1),
        user_id: MAIN_USER_ID,
        email_masked: maskEmail(MAIN_USER_EMAIL),
        source: 'referral_referrer',
        duration_days: 14,
        starts_at: at(now, -40 * DAY),
        ends_at: at(now, -26 * DAY),
        state: 'ended',
        granted_by: null,
        reason: null,
        revoked_at: null,
        revoked_by: null,
      },
    },
    {
      row: {
        id: uid('9999', 2),
        user_id: second?.id ?? MAIN_USER_ID,
        email_masked: maskEmail(second?.email ?? MAIN_USER_EMAIL),
        source: 'compensation',
        duration_days: 7,
        starts_at: at(now, -2 * DAY),
        ends_at: at(now, 5 * DAY),
        state: 'active',
        granted_by: 'destek@dijitalasistan.app',
        reason: 'Senkron kesintisi nedeniyle telafi',
        revoked_at: null,
        revoked_by: null,
      },
    },
  ];
}

function buildReferrals(now: number, users: readonly MockUser[]): Dataset['referrals'] {
  return [
    ['flagged', 0.86, ['same_device', 'burst_signups']],
    ['qualified', 0.12, []],
    ['rewarded', 0.05, []],
    ['pending', 0.31, ['new_domain']],
    ['rejected', 0.93, ['same_payment', 'same_device']],
  ].map(([status, risk, signals], index) => ({
    id: index === 0 ? FLAGGED_REFERRAL_ID : uid('aaaa', index + 1),
    code: `DA-${(4_821 + index * 7).toString()}`,
    referrer_id: MAIN_USER_ID,
    referee_id: users[index + 2]?.id ?? MAIN_USER_ID,
    status: status as Dataset['referrals'][number]['status'],
    risk_score: risk as number,
    signals_summary: signals as string[],
    created_at: at(now, -(index + 1) * 2 * DAY),
  }));
}

function buildTickets(now: number, users: readonly MockUser[]): MockTicket[] {
  const specs: [MockTicket['row']['category'], MockTicket['row']['status'], string, string][] = [
    [
      'sync',
      'open',
      'Gmail hesabım senkron olmuyor',
      'Dünden beri yeni e-postalar brifinge gelmiyor. Uygulamayı yeniden başlattım ama değişmedi.',
    ],
    [
      'billing',
      'in_progress',
      'Pro aboneliğim görünmüyor',
      'App Store üzerinden ödeme yaptım ama uygulama hâlâ ücretsiz planda görünüyor.',
    ],
    [
      'notification',
      'waiting_user',
      'Sabah bildirimi gelmiyor',
      'Sabah brifingi bildirimi son üç gündür gelmedi.',
    ],
    [
      'ai_quality',
      'resolved',
      'Özet yanlış kişiyi gösteriyor',
      'Toplantı özetinde katılımcı yanlış yazılmış.',
    ],
    [
      'privacy',
      'open',
      'Verilerimi dışa aktarmak istiyorum',
      'Tüm verilerimin bir kopyasını nasıl alabilirim?',
    ],
    ['account', 'closed', 'Giriş kodu gelmiyor', 'E-posta ile giriş kodu gelmedi, sorun çözüldü.'],
  ];
  return specs.map(([category, status, subject, message], index) => {
    const user = index === 0 ? users[0] : users[index + 1];
    const id = index === 0 ? TICKET_ID : uid('8888', index + 1);
    return {
      user_id: user?.id ?? MAIN_USER_ID,
      source: index % 3 === 2 ? 'web' : 'app',
      assignee_id: status === 'in_progress' ? SUPPORT_ADMIN_ID : null,
      message,
      diagnostics:
        index % 3 === 2
          ? null
          : { app_version: '1.4.1', os: 'iOS 19.1', accounts: 2, last_sync_minutes: 1_440 },
      notes:
        index === 1
          ? [
              {
                id: uid('1212', 1),
                kind: 'internal',
                body: 'RevenueCat olayı işlenmemiş, yeniden senkron denenecek.',
                author: 'destek@dijitalasistan.app',
                created_at: at(now, -3 * HOUR),
              },
            ]
          : [],
      row: {
        id,
        reference: `DA-${(10_240 + index).toString()}`,
        category,
        status,
        subject,
        platform: index % 3 === 2 ? 'web' : (user?.platform ?? 'ios'),
        app_version: index % 3 === 2 ? null : '1.4.1',
        assignee: status === 'in_progress' ? 'Destek Ekibi' : null,
        created_at: at(now, -(index + 1) * 7 * HOUR),
        contact_email_masked: user === undefined ? null : maskEmail(user.email),
      },
    };
  });
}

function buildFeedback(now: number, users: readonly MockUser[]): Dataset['feedback'] {
  const specs: [
    Dataset['feedback'][number]['type'],
    number | null,
    string,
    Dataset['feedback'][number]['status'],
  ][] = [
    ['bug', 2, 'Takvim etkinlikleri iki kez görünüyor.', 'new'],
    ['feature', 5, 'Brifingi sesli dinleyebilmek harika olur.', 'planned'],
    ['general', 4, 'Uygulama çok hızlı, teşekkürler.', 'closed'],
    ['ai_quality', 1, 'Yanıt taslağı çok resmi oldu.', 'triaged'],
    ['bug', 3, 'Android widget güncellenmiyor.', 'new'],
    ['feature', null, 'Outlook görevleri de gelsin.', 'triaged'],
  ];
  return specs.map(([type, rating, message, status], index) => {
    const user = users[index + 1];
    return {
      id: uid('bbbb', index + 1),
      type,
      rating,
      message,
      screen: index % 2 === 0 ? 'today' : 'settings',
      status,
      platform: user?.platform ?? null,
      app_version: user?.app_version ?? null,
      assignee: status === 'triaged' ? 'Ürün Ekibi' : null,
      user_email_masked: user === undefined ? null : maskEmail(user.email),
      user_email: user?.email ?? null,
      created_at: at(now, -(index + 1) * 9 * HOUR),
    };
  });
}

function buildFlags(now: number): MockFlag[] {
  return R10_FLAG_KEYS.map((key, index) => {
    const enabled = !['feature.new_ai_model', 'voice.stt_server', 'ai.backfill.enabled'].includes(
      key,
    );
    return {
      row: {
        key,
        enabled,
        rollout_percent: key === 'feature.voice' ? 25 : enabled ? 100 : 0,
        platforms: key === 'feature.android_ni' ? ['android'] : [],
        plans: key === 'feature.midday' || key === 'feature.evening' ? ['pro'] : [],
        min_version: key === 'feature.voice' ? '1.4.0' : null,
        max_version: null,
        payload:
          key === 'ai.budget.org_daily_usd'
            ? { usd: 250 }
            : key === 'feature.android_ni'
              ? { denylist: ['com.whatsapp', 'com.android.systemui'] }
              : null,
        updated_by: index % 4 === 0 ? 'ai.ops@dijitalasistan.app' : 'ops@dijitalasistan.app',
        updated_at: at(now, -(index + 1) * 13 * HOUR),
      },
      description: null,
      archived_at: null,
      overrides:
        key === 'feature.voice'
          ? [
              {
                user_id: MAIN_USER_ID,
                email_masked: maskEmail(MAIN_USER_EMAIL),
                enabled: true,
                expires_at: at(now, 10 * DAY),
                created_at: at(now, -DAY),
              },
            ]
          : [],
      history: [
        {
          ts: at(now, -(index + 1) * 13 * HOUR),
          actor: 'ops@dijitalasistan.app',
          action: 'admin.flag.updated',
          reason: 'Kademeli açılış planı',
          before: { enabled: !enabled },
          after: { enabled },
        },
      ],
    };
  });
}

function buildAnnouncements(now: number): MockAnnouncement[] {
  return [
    {
      detail: {
        id: uid('cccc', 1),
        title_tr: 'Sesli brifing yayında',
        title_en: 'Voice briefing is live',
        body_tr: 'Sabah brifingini artık sesli dinleyebilirsin.',
        body_en: 'You can now listen to your morning briefing.',
        audience: 'pro',
        platforms: ['ios', 'android'],
        status: 'live',
        starts_at: at(now, -3 * DAY),
        ends_at: at(now, 11 * DAY),
        min_version: '1.4.0',
        max_version: null,
        cta_route: '/today',
        published_at: at(now, -3 * DAY),
        cancelled_at: null,
        dismissal_count: 412,
        created_by: 'ops@dijitalasistan.app',
        updated_at: at(now, -3 * DAY),
      },
    },
    {
      detail: {
        id: uid('cccc', 2),
        title_tr: 'Planlı bakım',
        title_en: 'Planned maintenance',
        body_tr: 'Pazar 03:00–04:00 arasında senkron kısa süre duraklayacak.',
        body_en: 'Sync pauses briefly on Sunday between 03:00 and 04:00.',
        audience: 'all',
        platforms: ['ios', 'android'],
        status: 'draft',
        starts_at: at(now, 4 * DAY),
        ends_at: at(now, 5 * DAY),
        min_version: null,
        max_version: null,
        cta_route: null,
        published_at: null,
        cancelled_at: null,
        dismissal_count: 0,
        created_by: 'ops@dijitalasistan.app',
        updated_at: at(now, -HOUR),
      },
    },
  ];
}

function buildDataRequests(now: number, users: readonly MockUser[]): MockDataRequest[] {
  const failedExport: MockDataRequest = {
    user_id: MAIN_USER_ID,
    row: {
      id: FAILED_EXPORT_ID,
      kind: 'export',
      status: 'failed',
      origin: 'app',
      requested_at: at(now, -30 * HOUR),
      completed_at: null,
      steps_summary: '3/5',
      user_ref: MAIN_USER_ID.slice(0, 8),
    },
    job: { id: uid('4444', 7), status: 'failed', progress: { step: 'upload', done: 3, total: 5 } },
    steps: [
      { step: 'collect_profile', status: 'done', detail_code: null, at: at(now, -30 * HOUR) },
      {
        step: 'collect_email_metadata',
        status: 'done',
        detail_code: null,
        at: at(now, -30 * HOUR + 60_000),
      },
      {
        step: 'collect_insights',
        status: 'done',
        detail_code: null,
        at: at(now, -30 * HOUR + 120_000),
      },
      {
        step: 'package',
        status: 'failed',
        detail_code: 'storage_write_failed',
        at: at(now, -30 * HOUR + 180_000),
      },
      { step: 'notify', status: 'pending', detail_code: null, at: null },
    ],
  };
  const expiredExport: MockDataRequest = {
    user_id: users[3]?.id ?? MAIN_USER_ID,
    row: {
      id: uid('dddd', 2),
      kind: 'export',
      status: 'expired',
      origin: 'web_otp',
      requested_at: at(now, -9 * DAY),
      completed_at: at(now, -9 * DAY + HOUR),
      steps_summary: '5/5',
      user_ref: (users[3]?.id ?? MAIN_USER_ID).slice(0, 8),
    },
    job: null,
    steps: [{ step: 'notify', status: 'done', detail_code: null, at: at(now, -9 * DAY + HOUR) }],
  };
  const deletion: MockDataRequest = {
    user_id: users[5]?.id ?? MAIN_USER_ID,
    row: {
      id: uid('dddd', 3),
      kind: 'account_deletion',
      status: 'processing',
      origin: 'app',
      requested_at: at(now, -4 * DAY),
      completed_at: null,
      steps_summary: '4/7',
      user_ref: (users[5]?.id ?? MAIN_USER_ID).slice(0, 8),
    },
    job: { id: uid('4444', 300), status: 'running', progress: { done: 4, total: 7 } },
    steps: [
      { step: 'revoke_tokens', status: 'done', detail_code: null, at: at(now, -4 * DAY) },
      { step: 'cancel_jobs', status: 'done', detail_code: null, at: at(now, -4 * DAY + 60_000) },
      {
        step: 'delete_content',
        status: 'done',
        detail_code: null,
        at: at(now, -4 * DAY + 120_000),
      },
      {
        step: 'delete_vectors',
        status: 'warning',
        detail_code: 'retry_scheduled',
        at: at(now, -4 * DAY + 180_000),
      },
      { step: 'delete_storage', status: 'pending', detail_code: null, at: null },
    ],
  };
  const history: MockDataRequest = {
    user_id: users[2]?.id ?? MAIN_USER_ID,
    row: {
      id: uid('dddd', 4),
      kind: 'history_deletion',
      status: 'requested',
      origin: 'web_otp',
      requested_at: at(now, -2 * HOUR),
      completed_at: null,
      steps_summary: null,
      user_ref: (users[2]?.id ?? MAIN_USER_ID).slice(0, 8),
    },
    job: null,
    steps: [],
  };
  return [failedExport, expiredExport, deletion, history];
}

function buildAdmins(now: number, role: Role): MockAdmin[] {
  const self: MockAdmin = {
    display_name: 'Ayşe Operasyon',
    row: {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      role,
      status: 'active',
      last_login_at: at(now, -HOUR),
      mfa_enrolled: true,
    },
  };
  return [
    self,
    {
      display_name: 'Kurucu Yönetici',
      row: {
        id: SUPER_ADMIN_ID,
        email: 'kurucu@dijitalasistan.app',
        role: 'super_admin',
        status: 'active',
        last_login_at: at(now, -2 * DAY),
        mfa_enrolled: true,
      },
    },
    {
      display_name: 'Destek Ekibi',
      row: {
        id: SUPPORT_ADMIN_ID,
        email: 'destek@dijitalasistan.app',
        role: 'support',
        status: 'active',
        last_login_at: at(now, -5 * HOUR),
        mfa_enrolled: true,
      },
    },
    {
      display_name: 'Finans',
      row: {
        id: uid('0000', 4),
        email: 'finans@dijitalasistan.app',
        role: 'finance',
        status: 'disabled',
        last_login_at: at(now, -40 * DAY),
        mfa_enrolled: true,
      },
    },
    {
      display_name: 'Yeni Analist',
      row: {
        id: INVITED_ADMIN_ID,
        email: 'analist@dijitalasistan.app',
        role: 'analyst',
        status: 'invited',
        last_login_at: null,
        mfa_enrolled: false,
      },
    },
    {
      display_name: 'AI Operasyon',
      row: {
        id: uid('0000', 6),
        email: 'ai.ops@dijitalasistan.app',
        role: 'ai_ops',
        status: 'active',
        last_login_at: at(now, -7 * HOUR),
        mfa_enrolled: true,
      },
    },
  ];
}

function buildAudit(now: number): MockAudit[] {
  const specs: [
    string,
    string,
    string | null,
    string | null,
    'success' | 'denied' | 'failure',
    string,
  ][] = [
    ['admin.session.started', 'admin_session', null, null, 'success', 'kurucu@dijitalasistan.app'],
    [
      'admin.user.force_sync',
      'user',
      MAIN_USER_ID,
      'Kullanıcı senkron sorunu bildirdi (DA-10240)',
      'success',
      'destek@dijitalasistan.app',
    ],
    [
      'admin.pii.revealed',
      'user',
      MAIN_USER_ID,
      'Destek talebi için e-posta doğrulaması',
      'success',
      'destek@dijitalasistan.app',
    ],
    [
      'admin.flag.updated',
      'feature_flag',
      'feature.voice',
      'Kademeli açılış planı',
      'success',
      'ai.ops@dijitalasistan.app',
    ],
    [
      'admin.permission_denied',
      'route',
      'POST /admins/invite',
      null,
      'denied',
      'destek@dijitalasistan.app',
    ],
    [
      'admin.job.retried',
      'job',
      uid('4444', 30),
      'Sağlayıcı kesintisi sonrası yeniden deneme',
      'success',
      'ops@dijitalasistan.app',
    ],
  ];
  let prev: string | null = null;
  return specs.map(([action, targetType, targetId, reason, result, actor], index) => {
    const hash = (index + 1).toString(16).padStart(64, 'a');
    const row: MockAudit = {
      actor_id: actor === ADMIN_EMAIL ? ADMIN_ID : SUPER_ADMIN_ID,
      row: {
        id: uid('eeee', index + 1),
        chain_seq: index + 1,
        ts: at(now, -(specs.length - index) * 3 * HOUR),
        actor_type: 'admin',
        actor,
        role: actor.startsWith('destek')
          ? 'support'
          : actor.startsWith('ai.ops')
            ? 'ai_ops'
            : 'super_admin',
        action,
        target_type: targetType,
        target_id: targetId,
        target_user: targetType === 'user' ? MAIN_USER_ID : null,
        reason,
        result,
        correlation_id: `corr-audit-${(index + 1).toString().padStart(3, '0')}`,
        metadata: result === 'denied' ? { permission: 'admins.manage' } : {},
        prev_hash: prev,
        hash,
      },
    };
    prev = hash;
    return row;
  });
}

function buildHealth(now: number): Dataset['health'] {
  const statuses: Partial<
    Record<Dataset['health'][number]['component'], Dataset['health'][number]['status']>
  > = {
    ai_openai: 'external_credential_required',
    microsoft_graph: 'degraded',
    email_delivery: 'external_credential_required',
  };
  const components: Dataset['health'][number]['component'][] = [
    'api',
    'database',
    'supabase_auth',
    'storage',
    'google_oauth',
    'microsoft_oauth',
    'gmail',
    'microsoft_graph',
    'push',
    'ai_anthropic',
    'ai_openai',
    'ai_voyage',
    'revenuecat',
    'cron',
    'webhooks',
    'email_delivery',
    'audit_chain',
  ];
  return components.map((component, index) => {
    const status = statuses[component] ?? 'healthy';
    return {
      component,
      status,
      latency_ms: status === 'external_credential_required' ? null : 40 + index * 17,
      checked_at: at(now, -(2 + (index % 4)) * 60_000),
      detail_code:
        status === 'degraded'
          ? 'elevated_latency'
          : status === 'external_credential_required'
            ? 'credential_missing'
            : null,
    };
  });
}

export function buildPlanLimits(): Dataset['planLimits'] {
  return {
    free: {
      max_mail_accounts: 1,
      max_calendar_accounts: 1,
      max_calendars: 3,
      ai_daily_budget_units: 40,
      ai_soft_cap_usd_day: 0.05,
      ai_hard_cap_usd_day: 0.1,
      ai_hard_cap_usd_month: 1.5,
      ai_routing_profile: 'lean',
      ai_briefing_reserve_pct: 30,
      midday_evening: false,
      meeting_prep: false,
      follow_up_commitments: false,
      voice_briefing: false,
      memory_search: false,
      vip_effects: false,
      advanced_planning: false,
      capture: true,
      android_ni: false,
      vip_max: 3,
      priority_rules_max: 5,
      email_analysis_daily: 50,
      reply_drafts_daily: 3,
      assistant_messages_daily: 10,
      assistant_retrieval_days: 30,
      transcribe_seconds_daily: 120,
      captures_daily: 5,
      meeting_preps_daily: 0,
      semantic_search_daily: 10,
      backfill_days: 14,
      referral_rewards_per_year: 6,
    },
    pro: {
      max_mail_accounts: 5,
      max_calendar_accounts: 5,
      max_calendars: 25,
      ai_daily_budget_units: null,
      ai_soft_cap_usd_day: 0.6,
      ai_hard_cap_usd_day: 1.2,
      ai_hard_cap_usd_month: 18,
      ai_routing_profile: 'balanced',
      ai_briefing_reserve_pct: 20,
      midday_evening: true,
      meeting_prep: true,
      follow_up_commitments: true,
      voice_briefing: true,
      memory_search: true,
      vip_effects: true,
      advanced_planning: true,
      capture: true,
      android_ni: true,
      vip_max: 25,
      priority_rules_max: 50,
      email_analysis_daily: 1_000,
      reply_drafts_daily: 50,
      assistant_messages_daily: 200,
      assistant_retrieval_days: null,
      transcribe_seconds_daily: 1_800,
      captures_daily: 100,
      meeting_preps_daily: 20,
      semantic_search_daily: 200,
      backfill_days: 90,
      referral_rewards_per_year: 6,
    },
  };
}

function buildSupportGrants(now: number): MockSupportGrant[] {
  return [
    {
      id: uid('ffff', 1),
      user_id: MAIN_USER_ID,
      admin_id: SUPPORT_ADMIN_ID,
      admin_name: 'Destek Ekibi',
      scopes: ['email_metadata', 'notifications'],
      reason: 'DA-10240 senkron sorunu incelemesi',
      starts_at: at(now, -3 * DAY),
      expires_at: at(now, -3 * DAY + 30 * 60_000),
      revoked_at: null,
      reveal_count: 2,
    },
  ];
}

/** A fresh dataset for one test (called by `/__mock/reset`). */
export function buildDataset(now: number, role: Role): Dataset {
  const users = buildUsers(now);
  return {
    users,
    accounts: buildAccounts(now, users),
    jobs: buildJobs(now, users),
    ...buildBriefings(now, users),
    notifications: buildNotifications(now, users),
    aiRequests: buildAiRequests(now, users),
    models: buildModels(now),
    planProfiles: { free: 'lean', pro: 'balanced' },
    prompts: buildPrompts(now),
    ...buildAiFeedback(now),
    ...buildSubscriptions(now, users),
    grants: buildGrants(now, users),
    referrals: buildReferrals(now, users),
    tickets: buildTickets(now, users),
    supportGrants: buildSupportGrants(now),
    feedback: buildFeedback(now, users),
    flags: buildFlags(now),
    announcements: buildAnnouncements(now),
    dataRequests: buildDataRequests(now, users),
    audit: buildAudit(now),
    health: buildHealth(now),
    admins: buildAdmins(now, role),
    planLimits: buildPlanLimits(),
    appSettings: {
      'app.min_supported_version': { ios: '1.4.0', android: '1.3.8' },
      'referral.reward_days': 14,
      'referral.max_rewards_per_year': 6,
      'referral.risk_threshold': 0.7,
      'referral.apply_window_days': 7,
      'google.calendar_write_scope': 'https://www.googleapis.com/auth/calendar.events.owned',
      'session.idle_minutes': 30,
      'session.absolute_hours': 12,
    },
  };
}
