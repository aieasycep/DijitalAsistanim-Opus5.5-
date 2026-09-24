/**
 * In-memory `AssistStore` and `ObjectStorage` for the AI pipeline part-2 tests (T-5.09…T-5.15).
 * Mail, threads, events and insights come from a `MemoryIntel`; the part-2 tables live here.
 */
import type {
  AccountSource,
  AssistantMessageRow,
  AssistantThreadRow,
  AssistStore,
  BriefingAudioRow,
  CaptureRow,
  ContactMatch,
  JobView,
  MeetingEventRow,
  MeetingNoteRow,
  MeetingPrepRow,
  PlanInsightRow,
  ReplyDraftRow,
  WritableCalendar,
} from '../services/assist/store.ts';
import type { Bucket, ObjectStorage } from '../services/storage.ts';
import type { ModelConfigRow } from '../ai/types.ts';
import type { AiFeature } from '@da/domain';
import type { IntelDeps } from '../../worker/handlers/intel.ts';
import type { AssistJobDeps } from '../../worker/handlers/assist.ts';
import { configRow } from './ai.ts';
import {
  ACCOUNT_ID,
  fixtureServices,
  type MemoryIntel,
  NOW,
  pipelineFlags,
  PIPELINE_FEATURES,
} from './intel.ts';
import { USER_A } from './jwt.ts';
import type { AiUser } from '../services/ai/runtime.ts';

/** The part-2 routes (T-5.09…T-5.15) with their model roles and providers. */
export const PART2_ROUTES: readonly {
  feature: AiFeature;
  role: ModelConfigRow['role'];
  provider: ModelConfigRow['provider'];
}[] = [
  { feature: 'reply_draft', role: 'reasoning', provider: 'anthropic' },
  { feature: 'follow_up_draft', role: 'reasoning', provider: 'anthropic' },
  { feature: 'meeting_prep', role: 'reasoning', provider: 'anthropic' },
  { feature: 'post_meeting_parse', role: 'classifier', provider: 'anthropic' },
  { feature: 'capture_extract', role: 'classifier', provider: 'anthropic' },
  { feature: 'capture_extract', role: 'reasoning', provider: 'anthropic' },
  { feature: 'assistant_intent', role: 'classifier', provider: 'anthropic' },
  { feature: 'assistant_qa', role: 'assistant', provider: 'anthropic' },
  { feature: 'stt', role: 'stt', provider: 'openai' },
  { feature: 'tts', role: 'tts', provider: 'openai' },
];

/** Model configs of the part-1 and part-2 features (fixture provider serves every target). */
export function assistConfigs(omit: readonly AiFeature[] = []): ModelConfigRow[] {
  const base = PIPELINE_FEATURES.map((feature, i) =>
    configRow({
      id: `cfg-${i}`,
      feature,
      role: feature.startsWith('embedding') ? 'embedding' : 'classifier',
      tier: 't1',
      provider: feature.startsWith('embedding') ? 'voyage' : 'anthropic',
      params: feature.startsWith('embedding')
        ? { output_dimension: 1024 }
        : { max_output_tokens: 1500 },
      fallback_targets: [],
    }),
  );
  const part2 = PART2_ROUTES.filter((r) => !omit.includes(r.feature)).map((r, i) =>
    configRow({
      id: `cfg-p2-${i}`,
      feature: r.feature,
      role: r.role,
      tier: 't2',
      provider: r.provider,
      params: {},
      fallback_targets: [],
    }),
  );
  return [...base, ...part2];
}

export function assistFlags(overrides: Record<string, boolean> = {}) {
  const on: Record<string, boolean> = {};
  for (const r of PART2_ROUTES) on[`ai.feature.${r.feature}`] = true;
  return pipelineFlags({
    ...on,
    'feature.voice': true,
    'feature.meeting_prep': true,
    'feature.capture': true,
    'voice.stt_server': true,
    'voice.tts_premium': false,
    ...overrides,
  });
}

export function intelDepsOf(mem: MemoryIntel, ai: ReturnType<typeof fixtureServices>): IntelDeps {
  return {
    ai: ai.services,
    mail: mem.mailStore(),
    insights: {
      snapshot: () => Promise.resolve(mem.snapshot()),
      upsertInsights: (rows) => mem.upsertInsights(rows),
      expireInsights: () => Promise.resolve(),
      updateThreads: () => Promise.resolve(),
    },
    briefings: mem.briefingStore(),
    stats: mem.statsStore(),
    memory: mem.memoryStore(),
    bodies: mem.bodySource(),
    reconciliation: {
      env: {},
      fetch: () => Promise.reject(new Error('no network')),
      costByModel: () => Promise.resolve([]),
      recordHealth: () => Promise.resolve(),
      audit: { append: () => Promise.resolve() },
    },
  };
}

/** A calendar event three hours from `NOW` with one external attendee. */
export function meetingEventRow(overrides: Partial<MeetingEventRow> = {}): MeetingEventRow {
  return {
    id: '44444444-4444-4444-8444-000000000001',
    user_id: USER_A,
    connected_account_id: ACCOUNT_ID,
    calendar_id: '44444444-4444-4444-8444-000000000002',
    provider: 'google',
    title: 'Teklif görüşmesi',
    start_at: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(),
    end_at: new Date(NOW.getTime() + 4 * 3_600_000).toISOString(),
    all_day: false,
    status: 'confirmed',
    location: null,
    is_online: true,
    organizer_self: true,
    organizer_email: 'yunus@firma.example',
    can_modify: true,
    attendees: [{ email: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
    attendee_count: 1,
    description_excerpt: 'Ekim teslimatı için fiyat revizyonunu görüşelim.',
    conference_url: null,
    updated_at: new Date(NOW.getTime() - 86_400_000).toISOString(),
    ...overrides,
  };
}

export interface AssistFixture {
  readonly mem: MemoryIntel;
  readonly store: MemoryAssist;
  readonly storage: ReturnType<typeof memoryStorage>;
  readonly ai: ReturnType<typeof fixtureServices>;
  readonly intel: IntelDeps;
  readonly jobs: AssistJobDeps;
}

export function assistFixture(
  mem: MemoryIntel,
  options: {
    user?: Partial<AiUser>;
    flags?: Record<string, boolean>;
    omit?: readonly AiFeature[];
    fetch?: typeof fetch;
  } = {},
): AssistFixture {
  const ai = fixtureServices({
    user: { ...options.user, flags: assistFlags(options.flags ?? {}) },
    configs: assistConfigs(options.omit ?? []),
  });
  const store = new MemoryAssist(mem, () => NOW);
  const storage = memoryStorage();
  const intel = intelDepsOf(mem, ai);
  return {
    mem,
    store,
    storage,
    ai,
    intel,
    jobs: {
      intel,
      store,
      storage,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      resolver: () => Promise.resolve(['93.184.215.14']),
    },
  };
}

export function memoryStorage(): ObjectStorage & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  removed: string[];
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const removed: string[] = [];
  const key = (b: Bucket, p: string) => `${b}/${p}`;
  return {
    objects,
    removed,
    signedUploadUrl: (bucket, path) =>
      Promise.resolve({
        signedUrl: `https://storage.test/upload/${bucket}/${path}?token=t`,
        token: 't',
        path,
      }),
    signedUrl: (bucket, path, expiresIn) =>
      Promise.resolve(`https://storage.test/sign/${bucket}/${path}?expires=${expiresIn}`),
    upload(bucket, path, bytes, contentType) {
      objects.set(key(bucket, path), { bytes, contentType });
      return Promise.resolve();
    },
    download(bucket, path) {
      return Promise.resolve(objects.get(key(bucket, path))?.bytes ?? null);
    },
    stat(bucket, path) {
      const o = objects.get(key(bucket, path));
      return Promise.resolve(o === undefined ? null : { size: o.bytes.byteLength });
    },
    remove(bucket, paths) {
      for (const p of paths) {
        objects.delete(key(bucket, p));
        removed.push(key(bucket, p));
      }
      return Promise.resolve();
    },
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class MemoryAssist implements AssistStore {
  drafts: Mutable<ReplyDraftRow>[] = [];
  meetingEvents: MeetingEventRow[] = [];
  preps: Mutable<MeetingPrepRow>[] = [];
  notes: MeetingNoteRow[] = [];
  contacts: (ContactMatch & { emails: string[] })[] = [];
  threads: AssistantThreadRow[] = [];
  messages: Mutable<AssistantMessageRow>[] = [];
  captures: Mutable<CaptureRow>[] = [];
  accounts: AccountSource[] = [];
  calendars: WritableCalendar[] = [];
  planInsights: Mutable<PlanInsightRow>[] = [];
  jobs: Mutable<JobView>[] = [];
  counts = {
    mails_found: 0,
    classified: 0,
    potential_important: 0,
    upcoming_events: 0,
    possible_followups: 0,
  };
  briefings: Mutable<BriefingAudioRow>[] = [];
  batches = new Map<string, string[]>();
  steps: string[] = [];
  phones: string[] = [];

  constructor(
    readonly intel: MemoryIntel,
    readonly now: () => Date = () => new Date(),
  ) {}

  private stamp(): string {
    return this.now().toISOString();
  }

  replyDraft(userId: string, id: string) {
    return Promise.resolve(this.drafts.find((d) => d.id === id && d.user_id === userId) ?? null);
  }
  insertReplyDraft(row: Parameters<AssistStore['insertReplyDraft']>[0]) {
    const { expires_at: _e, ...rest } = row;
    const d: Mutable<ReplyDraftRow> = {
      ...rest,
      id: crypto.randomUUID(),
      version: 1,
      status: 'draft',
      approval_action_id: null,
      created_at: this.stamp(),
      updated_at: this.stamp(),
    };
    this.drafts.push(d);
    return Promise.resolve({ ...d });
  }
  updateReplyDraft(
    userId: string,
    id: string,
    expected: number,
    patch: Parameters<AssistStore['updateReplyDraft']>[3],
  ) {
    const d = this.drafts.find((x) => x.id === id && x.user_id === userId);
    if (d === undefined || d.version !== expected) return Promise.resolve(null);
    Object.assign(d, patch, { version: expected + 1, updated_at: this.stamp() });
    return Promise.resolve({ ...d });
  }
  reusableDraft(userId: string, key: string, since: Date) {
    const hit = this.drafts.find(
      (d) =>
        d.user_id === userId &&
        d.content_key === key &&
        d.status === 'draft' &&
        Date.parse(d.created_at) >= since.getTime(),
    );
    return Promise.resolve(hit === undefined ? null : { ...hit });
  }
  messageWebLink() {
    return Promise.resolve(null);
  }

  meetingEvent(userId: string, eventId: string) {
    return Promise.resolve(
      this.meetingEvents.find((e) => e.id === eventId && e.user_id === userId) ?? null,
    );
  }
  meetingPrep(userId: string, eventId: string) {
    return Promise.resolve(
      this.preps.find((p) => p.calendar_event_id === eventId && p.user_id === userId) ?? null,
    );
  }
  meetingPrepById(userId: string, id: string) {
    return Promise.resolve(this.preps.find((p) => p.id === id && p.user_id === userId) ?? null);
  }
  upsertMeetingPrep(row: Parameters<AssistStore['upsertMeetingPrep']>[0]) {
    const {
      source_provider: _p,
      source_timestamp: _t,
      confidence: _c,
      ...rest
    } = row as typeof row & { id?: string; updated_at?: string };
    const existing = this.preps.find(
      (p) => p.calendar_event_id === row.calendar_event_id && p.user_id === row.user_id,
    );
    if (existing !== undefined) {
      Object.assign(existing, rest, { id: existing.id, updated_at: this.stamp() });
      return Promise.resolve({ ...existing });
    }
    const created = {
      ...rest,
      id: crypto.randomUUID(),
      updated_at: this.stamp(),
    } as Mutable<MeetingPrepRow>;
    this.preps.push(created);
    return Promise.resolve({ ...created });
  }
  meetingNoteByClient(userId: string, clientId: string) {
    return Promise.resolve(
      this.notes.find((n) => n.user_id === userId && n.client_note_id === clientId) ?? null,
    );
  }
  insertMeetingNote(row: Omit<MeetingNoteRow, 'id' | 'created_at'>) {
    const n = { ...row, id: crypto.randomUUID(), created_at: this.stamp() };
    this.notes.push(n);
    return Promise.resolve(n);
  }
  meetingNotes(userId: string, eventId: string) {
    return Promise.resolve(
      this.notes.filter(
        (n) => n.user_id === userId && n.calendar_event_id === eventId && n.kind === 'prep_note',
      ),
    );
  }
  contactsForEmails(_userId: string, emails: readonly string[]) {
    const lower = emails.map((e) => e.toLowerCase());
    return Promise.resolve(
      this.contacts
        .filter((c) => c.emails.some((e) => lower.includes(e)))
        .map((c) => ({
          id: c.id,
          display_name: c.display_name,
          emails: c.emails,
          organization: c.organization,
          role_text: null,
        })),
    );
  }
  mailsWith(userId: string, emails: readonly string[], since: Date, limit: number) {
    const lower = emails.map((e) => e.toLowerCase());
    return Promise.resolve(
      this.intel.messages
        .filter((m) => m.user_id === userId && Date.parse(m.received_at) >= since.getTime())
        .filter(
          (m) =>
            lower.includes(m.from_email.toLowerCase()) ||
            m.to_emails.some((t) => lower.includes(t.toLowerCase())),
        )
        .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
        .slice(0, limit),
    );
  }
  awaitingThreadsWith(userId: string, emails: readonly string[]) {
    const lower = emails.map((e) => e.toLowerCase());
    return Promise.resolve(
      this.intel.threads.filter(
        (t) =>
          t.user_id === userId &&
          t.reply_state !== 'none' &&
          t.participants.some((p) => lower.includes(p.email.toLowerCase())),
      ),
    );
  }
  openCommitmentsWith(_userId: string, contactIds: readonly string[], names: readonly string[]) {
    return Promise.resolve(
      this.intel.commitments
        .filter((c) => c.status === 'open')
        .filter(
          (c) =>
            (c.contact_id !== null && contactIds.includes(c.contact_id)) ||
            names.some((n) => (c.counterparty_name ?? '').startsWith(n)),
        )
        .map((c) => ({ ...c, completed_at: null }) as never),
    );
  }

  assistantThread(userId: string, id: string) {
    return Promise.resolve(this.threads.find((t) => t.id === id && t.user_id === userId) ?? null);
  }
  assistantThreadByClient(userId: string, clientId: string) {
    return Promise.resolve(
      this.threads.find((t) => t.user_id === userId && t.client_thread_id === clientId) ?? null,
    );
  }
  insertAssistantThread(row: Omit<AssistantThreadRow, 'id' | 'created_at'>) {
    const t = { ...row, id: crypto.randomUUID(), created_at: this.stamp() };
    this.threads.push(t);
    return Promise.resolve(t);
  }
  assistantMessageByClient(threadId: string, clientId: string) {
    const m = this.messages.find(
      (x) => x.thread_id === threadId && x.client_message_id === clientId && x.role === 'assistant',
    );
    return Promise.resolve(m === undefined ? null : { ...m });
  }
  insertAssistantMessage(row: Parameters<AssistStore['insertAssistantMessage']>[0]) {
    const m = {
      ...row,
      id: row.id ?? crypto.randomUUID(),
      created_at: this.stamp(),
    } as Mutable<AssistantMessageRow>;
    this.messages.push(m);
    return Promise.resolve({ ...m });
  }
  updateAssistantMessage(id: string, patch: Parameters<AssistStore['updateAssistantMessage']>[1]) {
    const m = this.messages.find((x) => x.id === id);
    if (m !== undefined) Object.assign(m, patch);
    return Promise.resolve();
  }
  assistantHistory(threadId: string, limit: number) {
    return Promise.resolve(
      this.messages
        .filter((m) => m.thread_id === threadId && m.status === 'complete')
        .slice(-limit),
    );
  }
  streamingMessage(userId: string, since: Date) {
    return Promise.resolve(
      this.messages.find(
        (m) =>
          m.user_id === userId &&
          m.status === 'streaming' &&
          Date.parse(m.created_at) >= since.getTime(),
      ) ?? null,
    );
  }
  touchAssistantThread() {
    return Promise.resolve();
  }
  contactsNamed(_userId: string, names: readonly string[]) {
    const lower = names.map((n) => n.toLocaleLowerCase('tr-TR'));
    return Promise.resolve(
      this.contacts
        .filter((c) => lower.some((n) => c.display_name.toLocaleLowerCase('tr-TR').startsWith(n)))
        .map(({ emails: _e, ...c }) => c),
    );
  }
  approvalIdsByBatch(_userId: string, batchId: string) {
    return Promise.resolve(this.batches.get(batchId) ?? []);
  }
  contact(_userId: string, id: string) {
    const c = this.contacts.find((x) => x.id === id);
    if (c === undefined) return Promise.resolve(null);
    const { emails: _e, ...rest } = c;
    return Promise.resolve(rest);
  }

  capture(userId: string, id: string) {
    const c = this.captures.find((x) => x.id === id && x.user_id === userId);
    return Promise.resolve(c === undefined ? null : { ...c });
  }
  captureByClient(userId: string, clientId: string) {
    const c = this.captures.find((x) => x.user_id === userId && x.idempotency_key === clientId);
    return Promise.resolve(c === undefined ? null : { ...c });
  }
  insertCapture(row: Parameters<AssistStore['insertCapture']>[0]) {
    const c: Mutable<CaptureRow> = {
      ...row,
      final_url: null,
      page_count: null,
      extracted: [],
      extracted_types: [],
      primary_type: null,
      progress: {},
      file_deleted_at: null,
      error_code: null,
      analyzed_at: null,
      created_at: this.stamp(),
      expires_at: null,
    };
    this.captures.push(c);
    return Promise.resolve({ ...c });
  }
  updateCapture(userId: string, id: string, patch: Parameters<AssistStore['updateCapture']>[2]) {
    const c = this.captures.find((x) => x.id === id && x.user_id === userId);
    if (c === undefined) return Promise.resolve(null);
    const { ai_request_id: _a, ...rest } = patch;
    Object.assign(c, rest);
    return Promise.resolve({ ...c });
  }
  discardCapture(userId: string, id: string) {
    const c = this.captures.find((x) => x.id === id && x.user_id === userId);
    if (c === undefined) throw new Error('NOT_FOUND');
    const path = c.file_deleted_at === null ? c.storage_path : null;
    c.status = 'discarded';
    c.file_deleted_at = this.stamp();
    return Promise.resolve({ capture: { ...c }, storagePath: path });
  }
  capturesWithStaleFiles(userId: string, before: Date) {
    return Promise.resolve(
      this.captures.filter(
        (c) =>
          c.user_id === userId &&
          c.file_deleted_at === null &&
          c.storage_path !== null &&
          c.analyzed_at !== null &&
          Date.parse(c.analyzed_at) < before.getTime(),
      ),
    );
  }

  accountSources() {
    return Promise.resolve(this.accounts);
  }
  timedTasks() {
    return Promise.resolve([]);
  }
  quietHours() {
    return Promise.resolve(null);
  }
  writableCalendar(_userId: string, calendarId: string | null) {
    return Promise.resolve(
      (calendarId === null ? this.calendars[0] : this.calendars.find((c) => c.id === calendarId)) ??
        null,
    );
  }
  planItem(_userId: string, item: { type: string; id: string }) {
    const task = this.intel.tasks.find((t) => t.id === item.id);
    if (task !== undefined)
      return Promise.resolve({ title: task.title, due_at: task.due_at, personal: false });
    const c = this.intel.commitments.find((x) => x.id === item.id);
    return Promise.resolve(
      c === undefined ? null : { title: c.text, due_at: c.due_at, personal: false },
    );
  }
  planInsight(userId: string, id: string) {
    return Promise.resolve(
      this.planInsights.find((i) => i.id === id && i.user_id === userId) ?? null,
    );
  }
  setInsightPayload(_userId: string, id: string, payload: Record<string, unknown>) {
    const i = this.planInsights.find((x) => x.id === id);
    if (i !== undefined) i.payload = payload;
    return Promise.resolve();
  }
  linkInsightApproval(_userId: string, id: string, approvalId: string) {
    const i = this.intel.insights.find((x) => x.id === id);
    if (i !== undefined)
      Object.assign(i, { entity_type: 'approval_action', entity_id: approvalId });
    return Promise.resolve();
  }
  dismissInsight(_userId: string, id: string, suppressionKey: string) {
    const i = this.planInsights.find((x) => x.id === id);
    if (i !== undefined) Object.assign(i, { status: 'dismissed', suppression_key: suppressionKey });
    return Promise.resolve();
  }
  sourcePhones() {
    return Promise.resolve(this.phones);
  }

  job(id: string) {
    return Promise.resolve(this.jobs.find((j) => j.id === id) ?? null);
  }
  jobByKey(key: string) {
    return Promise.resolve(this.jobs.find((j) => j.idempotency_key === key) ?? null);
  }
  jobsByKeyPrefix(prefix: string) {
    return Promise.resolve(this.jobs.filter((j) => j.idempotency_key.startsWith(prefix)));
  }
  firstAnalysisCounts() {
    return Promise.resolve({ ...this.counts });
  }
  topInsights(_userId: string, limit: number) {
    const open = this.intel
      .insightRows()
      .filter((i) => i.status === 'open')
      .sort((a, b) => b.rank_score - a.rank_score);
    return Promise.resolve({
      items: open.slice(0, limit).map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        due_at: i.due_at,
        event_at: i.event_at,
      })),
      total: open.length,
    });
  }
  setOnboardingStep(_userId: string, step: string) {
    this.steps.push(step);
    return Promise.resolve();
  }

  briefingAudio(userId: string, id: string) {
    return Promise.resolve(this.briefings.find((b) => b.id === id && b.user_id === userId) ?? null);
  }
  briefingItems(_userId: string, briefingId: string) {
    return Promise.resolve(this.intel.items.filter((i) => i.briefing_id === briefingId));
  }
  updateBriefingAudio(id: string, patch: Parameters<AssistStore['updateBriefingAudio']>[1]) {
    const b = this.briefings.find((x) => x.id === id);
    if (b !== undefined) {
      const { audio_engine: _e, ...rest } = patch;
      Object.assign(b, rest);
    }
    return Promise.resolve();
  }
}
