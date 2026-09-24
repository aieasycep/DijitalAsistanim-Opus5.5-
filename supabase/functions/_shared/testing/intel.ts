/**
 * In-memory kit for the AI pipeline tests (T-5.01…T-5.08, T-5.16, T-5.17): row builders, fakes of
 * every pipeline store with the semantics of their SQL counterparts (upsert by dedupe key,
 * user-state preservation, pending-proposal uniqueness), a fixture-provider AI runtime that counts
 * model calls, and a job context that records enqueued jobs.
 */
import type {
  AiFeature,
  BriefingKind,
  LearnedPreference,
  PriorityRule,
  Provider,
} from '@da/domain';
import type { AiRuntime } from '../ai/call.ts';
import { createFixtureProvider } from '../ai/providers/fixture.ts';
import { staticPriceSource } from '../ai/pricing.ts';
import { staticModelConfigSource } from '../ai/router.ts';
import type { ModelConfigRow } from '../ai/types.ts';
import type { EnqueueInput, JobContext, JobRow } from '../jobs/types.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import type { AiServices, AiUser } from '../services/ai/runtime.ts';
import type { FlagMap } from '../services/flags.ts';
import type { LifeEventInsert } from '../services/life/classify.ts';
import type {
  ContactRef,
  InsightSnapshot,
  MailBodySource,
  MailStore,
  MemorySource,
  MemoryStore,
  StatsStore,
  VipSet,
  WeeklyCounts,
} from '../services/intel/store.ts';
import type { BriefingJobStore } from '../services/intel/supabase-store.ts';
import type {
  AccountRow,
  ApprovalInsert,
  ApprovalRow,
  BriefingItemRow,
  BriefingRow,
  CalendarEventRow,
  CommitmentInsert,
  CommitmentRow,
  InsightRow,
  InsightUpsert,
  LifeEventRow,
  MailMessageRow,
  MailThreadRow,
  MemoryChunkInsert,
  MemoryChunkRow,
  TaskRow,
} from '../services/intel/types.ts';
import { allFlags, configRow, PRICES, memoryCache, recordingBudget, recordingTelemetry } from './ai.ts';
import { USER_A } from './jwt.ts';

export const NOW = new Date('2026-09-24T06:30:00.000Z'); // Perşembe 09:30 Europe/Istanbul
export const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
let seq = 0;
export function uuid(): string {
  seq += 1;
  const hex = seq.toString(16).padStart(12, '0');
  return `aaaaaaaa-0000-4000-8000-${hex}`;
}

export const PIPELINE_FEATURES: readonly AiFeature[] = [
  'email_triage',
  'thread_summary',
  'email_deep_extract',
  'commitment_extract',
  'life_intel_extract',
  'briefing_morning',
  'briefing_midday',
  'briefing_evening',
  'weekly_review',
  'embedding_doc',
  'embedding_query',
];

export function pipelineFlags(overrides: Record<string, boolean> = {}): FlagMap {
  const base: Record<string, boolean> = { ...allFlags('email_triage') };
  for (const f of PIPELINE_FEATURES) base[`ai.feature.${f}`] = true;
  return {
    ...base,
    'feature.midday': true,
    'feature.evening': true,
    'feature.weekly_review': true,
    'ai.feature.briefing_polish': false,
    ...overrides,
  };
}

export function aiUser(overrides: Partial<AiUser> = {}): AiUser {
  return {
    userId: USER_A,
    plan: 'pro',
    isPro: true,
    profile: 'balanced',
    flags: pipelineFlags(),
    timeZone: 'Europe/Istanbul',
    locale: 'tr',
    displayName: 'Yunus',
    dataAccess: { mailBody: true, attachments: true, calendar: true, contacts: true },
    learnFromInteractions: true,
    followUpAfterDays: 2,
    workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    userRef: 'ref-user-a',
    ...overrides,
  };
}

function rows(): ModelConfigRow[] {
  return PIPELINE_FEATURES.map((feature, i) =>
    configRow({
      id: `cfg-${i}`,
      feature,
      role: feature.startsWith('embedding') ? 'embedding' : 'classifier',
      tier: 't1',
      provider: feature.startsWith('embedding') ? 'voyage' : 'anthropic',
      model: 'primary-model',
      params: feature.startsWith('embedding') ? { output_dimension: 1024 } : { max_output_tokens: 1500 },
      fallback_targets: feature.startsWith('embedding')
        ? []
        : [{ provider: 'openai', model: 'fallback-model', params: {} }],
    }),
  );
}

export interface FixtureServices {
  readonly services: AiServices;
  readonly telemetry: ReturnType<typeof recordingTelemetry>;
  readonly budget: ReturnType<typeof recordingBudget>;
  readonly cache: ReturnType<typeof memoryCache>;
  /** Model calls that reached the (fixture) provider, by schema name. */
  readonly calls: string[];
  readonly users: Map<string, AiUser>;
}

/** An AI runtime whose every provider is the fixture provider (no network). */
export function fixtureServices(
  options: {
    user?: Partial<AiUser>;
    budget?: Parameters<typeof recordingBudget>[0];
    configs?: readonly ModelConfigRow[];
    embedAvailable?: boolean;
  } = {},
): FixtureServices {
  const fixture = createFixtureProvider();
  const calls: string[] = [];
  const counted = {
    ...fixture,
    generateStructured: <T>(...args: Parameters<NonNullable<typeof fixture.generateStructured>>) => {
      calls.push(args[0].schemaName);
      return fixture.generateStructured!<T>(args[0] as never, args[1]);
    },
  };
  const telemetry = recordingTelemetry();
  const budget = recordingBudget(options.budget ?? {});
  const cache = memoryCache();
  const runtime: AiRuntime = {
    router: {
      configs: staticModelConfigSource(options.configs ?? rows()),
      providerAvailable: (p) => p !== 'voyage' || options.embedAvailable !== false,
    },
    prompts: {
      active: (key) =>
        Promise.resolve({
          id: `00000000-0000-4000-8000-${String(key.length).padStart(12, '0')}`,
          prompt_key: key,
          version: 1,
          system_prompt: `Sistem: ${key}`,
          user_template: 'Sayı: {{count}}',
          output_schema_ref: key,
          schema_hash: 'a'.repeat(64),
          model_role: 'classifier',
          model_constraints: {},
        }),
    },
    prices: staticPriceSource(PRICES),
    telemetry,
    budget,
    cache,
    provider: (id) => (id === 'voyage' && options.embedAvailable === false ? null : (counted as never)),
    aiHashPepper: 'test-pepper',
    log: createLogger({ fn: 'worker', sink: memorySink().sink }),
  };
  const users = new Map<string, AiUser>();
  const base = aiUser(options.user ?? {});
  users.set(base.userId, base);
  return {
    services: {
      runtime,
      users: { load: (id) => Promise.resolve(users.get(id) ?? { ...base, userId: id }) },
      providers: {
        fixtureMode: true,
        get: () => counted as never,
        available: () => true,
      },
      canary: 'DA-CANARY-0000abcd',
    },
    telemetry,
    budget,
    cache,
    calls,
    users,
  };
}

// ── Row builders ─────────────────────────────────────────────────────────────

export function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: ACCOUNT_ID,
    user_id: USER_A,
    provider: 'google',
    account_email: 'yunus@firma.example',
    status: 'healthy',
    data_source_toggles: { mail_read: true, calendar_read: true },
    ...overrides,
  };
}

export function threadRow(overrides: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    id: uuid(),
    user_id: USER_A,
    connected_account_id: ACCOUNT_ID,
    provider: 'google',
    subject: 'Konu',
    participants: [],
    message_count: 1,
    last_message_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    category: null,
    category_tier: null,
    category_reason: null,
    category_rule_id: null,
    category_confidence: null,
    urgency: null,
    reply_state: 'none',
    ai_summary: null,
    key_points: [],
    deadline_at: null,
    deadline_evidence: null,
    rolling_summary: null,
    last_processed_message_id: null,
    follow_up_state: 'none',
    awaiting_since: null,
    expects_reply_message_id: null,
    is_muted: false,
    analysis_hash: null,
    analyzed_at: null,
    prompt_version_id: null,
    topic_label: null,
    expires_at: null,
    ...overrides,
  };
}

export function messageRow(overrides: Partial<MailMessageRow> = {}): MailMessageRow {
  const id = overrides.id ?? uuid();
  return {
    id,
    user_id: USER_A,
    connected_account_id: ACCOUNT_ID,
    thread_id: uuid(),
    provider: 'google',
    provider_message_id: `p-${id}`,
    direction: 'inbound',
    from_email: 'mehmet@yilmazendustri.example',
    from_name: 'Mehmet Yılmaz',
    to_emails: ['yunus@firma.example'],
    cc_emails: [],
    subject: 'Konu',
    snippet: null,
    sent_at: null,
    received_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    labels: [],
    list_unsubscribe: false,
    auto_submitted: false,
    precedence_bulk: false,
    dkim_pass: true,
    spf_pass: true,
    ai_status: 'pending_t0',
    classification: null,
    classification_tier: null,
    classification_reason: null,
    classification_rule_id: null,
    classification_confidence: null,
    key_points: [],
    ai_summary: null,
    analyzed_at: null,
    has_attachments: false,
    injection_suspected: false,
    life_signal: 'none',
    content_hash: `\\x${id.replace(/-/g, '')}`,
    expires_at: null,
    ...overrides,
  };
}

export function eventRow(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: uuid(),
    provider: 'google',
    title: 'Toplantı',
    start_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
    end_at: new Date(NOW.getTime() + 7_200_000).toISOString(),
    all_day: false,
    status: 'confirmed',
    location: null,
    is_online: false,
    organizer_self: true,
    can_modify: true,
    attendees: [],
    attendee_count: 1,
    description_excerpt: null,
    updated_at: new Date(NOW.getTime() - 86_400_000).toISOString(),
    ...overrides,
  };
}

export function insightRow(overrides: Partial<InsightRow> = {}): InsightRow {
  return {
    id: uuid(),
    kind: 'reply_needed',
    status: 'open',
    dedupe_key: `reply_needed:email_thread:${uuid()}`,
    urgency: 'today',
    title: 'Başlık',
    body: null,
    entity_type: 'email_thread',
    entity_id: uuid(),
    due_at: null,
    event_at: null,
    rank_score: 300,
    reason_code: 'awaiting_my_reply',
    source_type: 'email_message',
    source_id: uuid(),
    source_provider: 'google',
    source_timestamp: NOW.toISOString(),
    confidence: 0.9,
    evidence: [],
    created_at: NOW.toISOString(),
    suppression_key: null,
    flow_card_type: 'email',
    done_at: null,
    ...overrides,
  };
}

export function briefingRow(overrides: Partial<BriefingRow> = {}): BriefingRow {
  return {
    id: uuid(),
    user_id: USER_A,
    kind: 'morning',
    local_date: '2026-09-24',
    time_zone: 'Europe/Istanbul',
    scheduled_for: NOW.toISOString(),
    status: 'scheduled',
    generated_at: null,
    version: 1,
    origin: 'scheduled',
    idempotency_key: `briefing:${USER_A}:morning:2026-09-24`,
    counts: {},
    weekly_stats: null,
    evening_ready_at: null,
    provenance: {},
    job_id: null,
    ...overrides,
  };
}

// ── Stores ───────────────────────────────────────────────────────────────────

export class MemoryIntel {
  accounts: AccountRow[] = [accountRow()];
  messages: MailMessageRow[] = [];
  threads: MailThreadRow[] = [];
  rules: PriorityRule[] = [];
  learned: LearnedPreference[] = [];
  vipSet: VipSet = { contactIds: [], emails: [], notifyOff: [] };
  contacts = new Map<string, { id: string; name: string | null; organization: string | null }>();
  lifeEvents: (LifeEventInsert & { id: string })[] = [];
  commitments: (CommitmentInsert & { id: string; status: string })[] = [];
  approvals: (ApprovalInsert & { id: string; status: string })[] = [];
  events: CalendarEventRow[] = [];
  tasks: TaskRow[] = [];
  insights: (InsightUpsert & { id: string; status: InsightRow['status']; created_at: string; done_at: string | null })[] = [];
  briefings: BriefingRow[] = [];
  items: BriefingItemRow[] = [];
  chunks: (MemoryChunkInsert & { id: string; embedding: number[] | null; embedding_model: string | null })[] = [];
  batches: Record<string, Record<string, unknown>> = {};
  counts: WeeklyCounts = {
    mailsAnalyzed: 120,
    importantCount: 12,
    meetings: 6,
    prepNotes: 2,
    prepNotesOpened: 1,
    followups: 4,
    followupsAnswered: 3,
    deadlines: 3,
    deadlinesSurfacedInTime: 3,
    draftsSent: 1,
    meetingsByWeekday: { 2: 3, 4: 3 },
    busiest: { weekday: 2, meetings: 3, maxGapMin: 45 },
  };
  bodies = new Map<string, { text: string; html: string | null }>();
  own = ['yunus@firma.example'];
  contactStatsRefreshed: (readonly string[] | null)[] = [];

  mailStore(): MailStore {
    return {
      account: (id) => Promise.resolve(this.accounts.find((a) => a.id === id) ?? null),
      messages: (ids) => Promise.resolve(this.messages.filter((m) => ids.includes(m.id))),
      threads: (ids) => Promise.resolve(this.threads.filter((t) => ids.includes(t.id))),
      threadMessages: (threadId, limit) =>
        Promise.resolve(
          this.messages
            .filter((m) => m.thread_id === threadId)
            .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at))
            .slice(-limit),
        ),
      ownAddresses: () => Promise.resolve([...this.own]),
      rules: () => Promise.resolve([...this.rules]),
      learned: () => Promise.resolve([...this.learned]),
      vip: () => Promise.resolve(this.vipSet),
      senderHistory: (_u, emails) =>
        Promise.resolve({
          known: new Set(emails.filter((e) => this.contacts.has(e))),
          repliedBefore: new Set(emails.filter((e) => this.contacts.has(e))),
        }),
      updateMessage: (id, patch) => {
        this.messages = this.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as MailMessageRow) : m));
        return Promise.resolve();
      },
      updateThread: (id, patch) => {
        this.threads = this.threads.map((t) => (t.id === id ? ({ ...t, ...patch } as MailThreadRow) : t));
        return Promise.resolve();
      },
      upsertContacts: (_u, people) => {
        const out: Record<string, string> = {};
        for (const p of people) {
          const existing = this.contacts.get(p.email);
          const id = existing?.id ?? uuid();
          this.contacts.set(p.email, { id, name: p.name ?? existing?.name ?? null, organization: p.organization ?? null });
          out[p.email] = id;
        }
        return Promise.resolve(out);
      },
      linkContacts: () => Promise.resolve(),
      refreshContactStats: (_u, ids) => {
        this.contactStatsRefreshed.push(ids);
        return Promise.resolve();
      },
      contactsByEmail: (_u, emails) =>
        Promise.resolve(
          emails.flatMap((e): ContactRef[] => {
            const c = this.contacts.get(e.toLowerCase());
            return c === undefined ? [] : [{ id: c.id, display_name: c.name ?? e, emails: [e] }];
          }),
        ),
      upsertLifeEvents: (rowsIn) => {
        const out = rowsIn.map((r) => {
          const existing = this.lifeEvents.find((l) => l.user_id === r.user_id && l.dedupe_key === r.dedupe_key);
          if (existing !== undefined) {
            Object.assign(existing, r);
            return { id: existing.id, dedupe_key: r.dedupe_key };
          }
          const row = { ...r, id: uuid() };
          this.lifeEvents.push(row);
          return { id: row.id, dedupe_key: r.dedupe_key };
        });
        return Promise.resolve(out);
      },
      upsertCommitments: (rowsIn) => {
        const out: { id: string; dedupe_key: string }[] = [];
        for (const r of rowsIn) {
          if (this.commitments.some((c) => c.user_id === r.user_id && c.dedupe_key === r.dedupe_key)) continue;
          const row = { ...r, id: uuid(), status: 'open' };
          this.commitments.push(row);
          out.push({ id: row.id, dedupe_key: r.dedupe_key });
        }
        return Promise.resolve(out);
      },
      insertApprovals: (rowsIn) => {
        let n = 0;
        for (const r of rowsIn) {
          const pending = this.approvals.some(
            (a) => a.user_id === r.user_id && a.origin === r.origin && a.origin_ref_id === r.origin_ref_id && a.status === 'pending',
          );
          if (pending || this.approvals.some((a) => a.idempotency_key === r.idempotency_key)) continue;
          this.approvals.push({ ...r, id: uuid(), status: 'pending' });
          n++;
        }
        return Promise.resolve(n);
      },
      events: (_u, from, to) =>
        Promise.resolve(
          this.events.filter((e) => Date.parse(e.start_at) < to.getTime() && Date.parse(e.end_at) > from.getTime()),
        ),
      upsertInsights: (rowsIn) => this.upsertInsights(rowsIn),
    };
  }

  upsertInsights(rowsIn: readonly InsightUpsert[]): Promise<{ id: string; dedupe_key: string }[]> {
    return Promise.resolve(
      rowsIn.map((r) => {
        const existing = this.insights.find((i) => i.user_id === r.user_id && i.dedupe_key === r.dedupe_key);
        if (existing !== undefined) {
          Object.assign(existing, r);
          return { id: existing.id, dedupe_key: r.dedupe_key };
        }
        const row = { ...r, id: uuid(), status: 'open' as const, created_at: NOW.toISOString(), done_at: null };
        this.insights.push(row);
        return { id: row.id, dedupe_key: r.dedupe_key };
      }),
    );
  }

  insightRows(): InsightRow[] {
    return this.insights.map((i) => ({
      id: i.id,
      kind: i.kind,
      status: i.status,
      dedupe_key: i.dedupe_key,
      urgency: i.urgency,
      title: i.title,
      body: i.body,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      due_at: i.due_at,
      event_at: i.event_at,
      rank_score: i.rank_score,
      reason_code: i.reason_code,
      source_type: i.source_type,
      source_id: i.source_id,
      source_provider: i.source_provider,
      source_timestamp: i.source_timestamp,
      confidence: i.confidence,
      evidence: i.evidence,
      created_at: i.created_at,
      suppression_key: i.suppression_key,
      flow_card_type: i.flow_card_type,
      done_at: i.done_at,
    }));
  }

  snapshot(): InsightSnapshot {
    const latest = new Map<string, MailMessageRow>();
    for (const m of [...this.messages].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))) {
      if (m.direction === 'inbound' && !latest.has(m.thread_id)) latest.set(m.thread_id, m);
    }
    return {
      threads: this.threads,
      latestInbound: [...latest.values()],
      commitments: this.commitments.map((c) => ({
        id: c.id,
        contact_id: c.contact_id,
        counterparty_name: c.counterparty_name,
        direction: c.direction,
        text: c.text,
        due_at: c.due_at,
        due_is_date_only: c.due_is_date_only,
        status: c.status as CommitmentRow['status'],
        completed_at: null,
        source_type: c.source_type,
        source_id: c.source_id,
        source_provider: c.source_provider,
        source_timestamp: c.source_timestamp,
        confidence: c.confidence,
        evidence: c.evidence,
      })),
      lifeEvents: this.lifeEvents.map(
        (l): LifeEventRow => ({
          id: l.id,
          type: l.type,
          title: l.title,
          status: 'open',
          event_at: l.event_at,
          due_at: l.due_at,
          payload: l.payload,
          amount: l.amount,
          currency: l.currency,
          tracking_url: l.tracking_url,
          suppressed: false,
          resolved_at: null,
          updated_at: NOW.toISOString(),
          source_type: l.source_type,
          source_id: l.source_id,
          source_provider: l.source_provider,
          source_timestamp: l.source_timestamp,
          confidence: l.confidence,
          evidence: l.evidence,
        }),
      ),
      events: this.events,
      tasks: this.tasks,
      approvals: this.approvals.map(
        (a): ApprovalRow => ({
          id: a.id,
          action_type: a.action_type,
          status: a.status,
          what: a.what,
          approval_expires_at: new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
          executed_at: null,
          created_at: NOW.toISOString(),
        }),
      ),
      insights: this.insightRows(),
      vip: this.vipSet,
      ownAddresses: this.own,
      ownDomains: this.own.map((a) => a.split('@')[1] ?? ''),
      mutedContacts: [],
    };
  }

  briefingStore(): BriefingJobStore {
    return {
      byId: (id) => Promise.resolve(this.briefings.find((b) => b.id === id) ?? null),
      forDate: (userId, kind: BriefingKind, day) =>
        Promise.resolve(
          this.briefings.find((b) => b.user_id === userId && b.kind === kind && b.local_date === day) ?? null,
        ),
      ensure: (row) => {
        const found = this.briefings.find(
          (b) => b.user_id === row.user_id && b.kind === row.kind && b.local_date === row.local_date,
        );
        if (found !== undefined) return Promise.resolve(found);
        const created = briefingRow({ ...row, kind: row.kind, status: 'scheduled' });
        this.briefings.push(created);
        return Promise.resolve(created);
      },
      update: (id, patch) => {
        this.briefings = this.briefings.map((b) => (b.id === id ? ({ ...b, ...patch } as BriefingRow) : b));
        return Promise.resolve();
      },
      replaceItems: (briefingId, rowsIn) => {
        this.items = this.items.filter((i) => i.briefing_id !== briefingId || i.carried_over_to !== null);
        for (const r of rowsIn) this.items.push({ ...r, id: uuid(), carried_over_to: null });
        return Promise.resolve();
      },
      items: (briefingId) => Promise.resolve(this.items.filter((i) => i.briefing_id === briefingId)),
      carriedTo: (userId, day) =>
        Promise.resolve(this.items.filter((i) => i.user_id === userId && i.carried_over_to === day)),
      byJobIds: (ids) => Promise.resolve(this.briefings.filter((b) => b.job_id !== null && b.job_id !== undefined && ids.includes(b.job_id))),
      recordBatch: (row) => {
        this.batches[row.batch_id] = { status: 'submitted', ...row };
        return Promise.resolve();
      },
      updateBatch: (id, patch) => {
        this.batches[id] = { ...(this.batches[id] ?? {}), ...patch };
        return Promise.resolve();
      },
    };
  }

  statsStore(): StatsStore {
    return {
      mailCounts: () => Promise.resolve({ total: this.messages.length, attention: 2, calendars: this.events.length }),
      weekly: () => Promise.resolve(this.counts),
      freshness: () => Promise.resolve({ accounts: [{ provider: 'google', status: 'healthy' }] }),
    };
  }

  memoryStore(): MemoryStore {
    return {
      sources: (userId, itemsIn) =>
        Promise.resolve(
          itemsIn.flatMap((item): MemorySource[] => {
            const t = this.threads.find((x) => x.id === item.id);
            if (item.kind !== 'email_summary' || t === undefined || (t.rolling_summary ?? t.ai_summary) === null) return [];
            return [
              {
                userId,
                chunkKind: 'thread_summary',
                sourceType: 'email_thread',
                sourceId: t.id,
                sourceProvider: t.provider as Provider,
                sourceTimestamp: t.last_message_at,
                occurredAt: t.last_message_at,
                confidence: 0.9,
                evidence: [],
                contactIds: [],
                content: `Konu: ${t.subject ?? ''}\nÖzet: ${t.rolling_summary ?? t.ai_summary ?? ''}`,
                expiresAt: t.expires_at,
              },
            ];
          }),
        ),
      upsertChunks: (rowsIn) => {
        const out: MemoryChunkRow[] = [];
        for (const r of rowsIn) {
          if (this.chunks.some((c) => c.source_id === r.source_id && c.chunk_kind === r.chunk_kind && c.content_hash === r.content_hash)) continue;
          this.chunks = this.chunks.filter((c) => !(c.source_id === r.source_id && c.chunk_kind === r.chunk_kind));
          const row = { ...r, id: uuid(), embedding: null, embedding_model: null };
          this.chunks.push(row);
          out.push({ id: row.id, user_id: r.user_id, content: r.content, embedding_model: null });
        }
        return Promise.resolve(out);
      },
      pendingChunks: (userId, ids, limit) =>
        Promise.resolve(
          this.chunks
            .filter((c) => c.user_id === userId && c.embedding_model === null && (ids === null || ids.includes(c.id)))
            .slice(0, limit)
            .map((c) => ({ id: c.id, user_id: c.user_id, content: c.content, embedding_model: null })),
        ),
      writeEmbeddings: (rowsIn) => {
        for (const r of rowsIn) {
          const c = this.chunks.find((x) => x.id === r.id);
          if (c !== undefined) {
            c.embedding = [...r.embedding];
            c.embedding_model = r.model;
          }
        }
        return Promise.resolve();
      },
    };
  }

  bodySource(): MailBodySource {
    return {
      fetch: ({ providerMessageId }) => {
        const body = this.bodies.get(providerMessageId);
        return Promise.resolve(
          body === undefined ? null : { text: body.text, html: body.html, truncated: false, attachments: [] },
        );
      },
    };
  }
}

export interface RecordingJobContext<P> extends JobContext<P> {
  readonly enqueued: EnqueueInput[];
}

export function jobContext<P>(
  payload: P,
  options: { now?: Date; attempts?: number; maxAttempts?: number; type?: JobRow['type']; id?: string } = {},
): RecordingJobContext<P> {
  const enqueued: EnqueueInput[] = [];
  const job: JobRow = {
    id: options.id ?? uuid(),
    type: options.type ?? 'email_triage',
    status: 'running',
    user_id: USER_A,
    connected_account_id: null,
    payload: payload as never,
    idempotency_key: 'test',
    attempts: options.attempts ?? 1,
    max_attempts: options.maxAttempts ?? 5,
    correlation_id: '99999999-9999-4999-8999-999999999999',
    lease_owner: 'w1',
    lease_expires_at: null,
    run_after: NOW.toISOString(),
  };
  return {
    job,
    payload,
    signal: new AbortController().signal,
    log: createLogger({ fn: 'worker', sink: memorySink().sink }),
    correlationId: job.correlation_id,
    workerId: 'w1',
    enqueue(input) {
      enqueued.push(input);
      return Promise.resolve(`job-${enqueued.length}`);
    },
    progress: () => Promise.resolve(),
    now: () => options.now ?? NOW,
    enqueued,
  };
}
