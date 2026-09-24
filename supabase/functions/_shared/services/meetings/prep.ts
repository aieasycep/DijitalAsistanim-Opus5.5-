/**
 * Meeting prep (IMPLEMENTATION_PLAN T-5.10; AI_PIPELINE_PLAN §13.1; API-MEET-01, JOB-15; M§21,
 * M§150): event → attendees → contacts → recent mail summaries, notes, open commitments and
 * waiting threads → source-set hash → T2 `MeetingPrepV1` → grounding → persisted view data.
 *
 * Only derived data reaches the model (summaries and snippets, never bodies). Every talking point
 * keeps a verified quote and at least one source; "Senden beklenenler" / "Senin beklediklerin" and
 * the recent-mail list are computed by code. Without a model (budget, kill switch, credentials)
 * the T0 fallback persists the previous-communication list and the commitments only.
 */
import { isAllowedConferencingUrl, type MeetingPrepView } from '@da/validation';
import { MeetingPrepV1, refineMeetingPrepV1 } from '@da/validation';
import { localDate, localTime, type Provider, type SourceType } from '@da/domain';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import { aliasMap, bandConfidence, groundQuote, storedEvidence } from '../ai/grounding.ts';
import { injectionScan } from '../ai/hygiene.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { sourceRef } from '../assist/common.ts';
import type {
  AssistStore,
  MeetingContact,
  MeetingEventRow,
  MeetingNoteRow,
  MeetingPrepRow,
  MeetingPrepUpsert,
} from '../assist/store.ts';
import { clip } from '../copy.ts';
import type { CommitmentRow, MailMessageRow, MailThreadRow } from '../intel/types.ts';

export const PREP_MAIL_DAYS = 60;
export const PREP_MAIL_LIMIT = 10;
/** A ready prep younger than this with an unchanged source set is served as is (API-MEET-01). */
export const PREP_FRESH_MS = 30 * 60_000;
/** Reading speed of the "2 Dakikalık Özet" (≈130 wpm TTS). */
const WORDS_PER_SECOND = 130 / 60;

export interface Attendee {
  readonly email: string;
  readonly name: string | null;
}

export interface PrepSources {
  readonly event: MeetingEventRow;
  readonly attendees: readonly Attendee[];
  readonly contacts: readonly MeetingContact[];
  readonly mails: readonly MailMessageRow[];
  readonly notes: readonly MeetingNoteRow[];
  readonly commitments: readonly CommitmentRow[];
  readonly awaiting: readonly MailThreadRow[];
  /** sha256 of the sorted source ids and their change markers (the regeneration key). */
  readonly hash: string;
}

type Ref = ReturnType<typeof sourceRef>;

/** Stored in `meeting_preps.sources` (view extras computed by code). */
type SourceEntry =
  | { kind: 'person'; contact_id: string; name: string; role_text: string | null }
  | {
      kind: 'recent_email';
      email_message_id: string;
      subject: string;
      summary: string;
      date: string;
    }
  | { kind: 'previous'; text: string; source: Ref }
  | {
      kind: 'commitment';
      direction: 'user_owes' | 'they_owe';
      commitment_id: string;
      text: string;
      due_at: string | null;
    }
  | { kind: 'summary_source'; source: Ref };

export function attendeesOf(event: MeetingEventRow): Attendee[] {
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const a of event.attendees) {
    const email = a.email?.trim().toLowerCase();
    if (email === undefined || email === '' || a.self === true || a.response === 'declined')
      continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: a.name ?? null });
  }
  return out;
}

export async function loadPrepSources(
  store: AssistStore,
  userId: string,
  event: MeetingEventRow,
  now: Date,
): Promise<PrepSources> {
  const attendees = attendeesOf(event);
  const emails = attendees.map((a) => a.email);
  const [contacts, mails, notes, awaiting] = await Promise.all([
    store.contactsForEmails(userId, emails),
    store.mailsWith(
      userId,
      emails,
      new Date(now.getTime() - PREP_MAIL_DAYS * 86_400_000),
      PREP_MAIL_LIMIT,
    ),
    store.meetingNotes(userId, event.id),
    store.awaitingThreadsWith(userId, emails),
  ]);
  const commitments = await store.openCommitmentsWith(
    userId,
    contacts.map((c) => c.id),
    attendees.map((a) => a.name ?? '').filter((n) => n !== ''),
  );
  const markers = [
    `e:${event.id}:${event.updated_at}`,
    ...mails.map((m) => `m:${m.id}`).sort(),
    ...notes.map((n) => `n:${n.id}`).sort(),
    ...commitments.map((c) => `c:${c.id}:${c.status}:${c.due_at ?? ''}`).sort(),
    ...awaiting.map((t) => `t:${t.id}:${t.reply_state}:${t.last_message_at}`).sort(),
  ];
  return {
    event,
    attendees,
    contacts,
    mails,
    notes,
    commitments,
    awaiting,
    hash: await sha256Hex(markers.join('|')),
  };
}

interface DocSource {
  readonly type: SourceType;
  readonly id: string;
  readonly provider: Provider | null;
  readonly at: string;
}

function mailText(m: MailMessageRow): string {
  return [m.subject ?? '', m.ai_summary ?? m.snippet ?? '']
    .filter((t) => t.trim() !== '')
    .join('\n');
}

function words(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

function commitmentEntries(sources: PrepSources): SourceEntry[] {
  return sources.commitments.map((c) => ({
    kind: 'commitment' as const,
    direction: c.direction,
    commitment_id: c.id,
    text: clip(c.text, 300),
    due_at: c.due_at,
  }));
}

function t0Entries(sources: PrepSources): SourceEntry[] {
  const people: SourceEntry[] = sources.contacts.map((c) => ({
    kind: 'person',
    contact_id: c.id,
    name: c.display_name,
    role_text: c.role_text,
  }));
  const recent: SourceEntry[] = sources.mails.slice(0, 5).map((m) => ({
    kind: 'recent_email',
    email_message_id: m.id,
    subject: clip(m.subject ?? '', 300),
    summary: clip(m.ai_summary ?? m.snippet ?? '', 200),
    date: new Date(m.received_at).toISOString(),
  }));
  const previous: SourceEntry[] = sources.mails.slice(0, 3).map((m) => ({
    kind: 'previous',
    text: clip(m.ai_summary ?? m.subject ?? m.snippet ?? '', 200),
    source: sourceRef({
      source_type: 'email_message',
      source_id: m.id,
      source_provider: m.provider,
      source_timestamp: m.received_at,
    }),
  }));
  return [...people, ...recent, ...previous, ...commitmentEntries(sources)];
}

function openLoopsT0(sources: PrepSources) {
  return sources.awaiting.slice(0, 5).map((t) => ({
    text: clip(t.subject ?? t.ai_summary ?? '', 200),
    source: sourceRef({
      source_type: 'email_thread',
      source_id: t.id,
      source_provider: t.provider,
      source_timestamp: t.last_message_at,
    }),
  }));
}

export interface ComposedPrep {
  readonly row: MeetingPrepUpsert;
  readonly mode: 'ai' | 'template';
  readonly reason: string | null;
}

function baseRow(
  userId: string,
  sources: PrepSources,
  now: Date,
): Omit<
  MeetingPrepUpsert,
  | 'purpose'
  | 'purpose_evidence'
  | 'talking_points'
  | 'summary_2min'
  | 'reading_time_sec'
  | 'last_interaction'
  | 'open_loops'
  | 'sources'
  | 'prompt_version_id'
  | 'ai_request_id'
  | 'confidence'
> {
  return {
    user_id: userId,
    calendar_event_id: sources.event.id,
    status: 'ready',
    primary_contact_id: sources.contacts[0]?.id ?? null,
    recent_email_ids: sources.mails.slice(0, 5).map((m) => m.id),
    user_commitment_ids: sources.commitments
      .filter((c) => c.direction === 'user_owes')
      .map((c) => c.id),
    their_commitment_ids: sources.commitments
      .filter((c) => c.direction === 'they_owe')
      .map((c) => c.id),
    relevant_files: [],
    source_hash: sources.hash,
    generated_at: now.toISOString(),
    source_provider: sources.event.provider,
    source_timestamp: sources.event.updated_at,
  };
}

/** The T0 prep: previous communication, open loops and commitments (no model). */
export function templatePrep(
  userId: string,
  sources: PrepSources,
  now: Date,
  reason: string,
): ComposedPrep {
  return {
    mode: 'template',
    reason,
    row: {
      ...baseRow(userId, sources, now),
      purpose: null,
      purpose_evidence: [],
      last_interaction: null,
      open_loops: openLoopsT0(sources),
      talking_points: [],
      summary_2min: null,
      reading_time_sec: null,
      sources: t0Entries(sources),
      prompt_version_id: null,
      ai_request_id: null,
      confidence: 0.5,
    },
  };
}

export async function composePrep(
  pipeline: PipelineContext,
  sources: PrepSources,
  now: Date,
): Promise<ComposedPrep> {
  const userId = pipeline.user.userId;
  const event = sources.event;
  const docs: UntrustedDoc[] = [];
  const bySource = new Map<string, DocSource>();
  const add = (ref: string, kind: UntrustedDoc['kind'], text: string, src: DocSource) => {
    if (text.trim() === '') return;
    docs.push({ ref, kind, text: clip(text, 1500) });
    bySource.set(ref, src);
  };
  const eventSource: DocSource = {
    type: 'calendar_event',
    id: event.id,
    provider: event.provider,
    at: event.updated_at,
  };
  if (event.description_excerpt !== null)
    add('e1', 'event', event.description_excerpt, eventSource);
  sources.mails.forEach((m, i) =>
    add(`m${i + 1}`, 'summary', mailText(m), {
      type: 'email_message',
      id: m.id,
      provider: m.provider,
      at: m.received_at,
    }),
  );
  sources.notes.forEach((n, i) =>
    add(`n${i + 1}`, 'note', n.body, {
      type: 'meeting_note',
      id: n.id,
      provider: null,
      at: n.created_at,
    }),
  );
  sources.commitments.slice(0, 8).forEach((c, i) =>
    add(`c${i + 1}`, 'summary', c.text, {
      type: 'commitment',
      id: c.id,
      provider: null,
      at: c.source_timestamp,
    }),
  );
  if (docs.length === 0) return templatePrep(userId, sources, now, 'no_sources');

  const tz = pipeline.user.timeZone;
  const context = [
    ...trustedHeader(pipeline.user, now),
    `Toplantı: ${clip(event.title ?? '', 200)} · ${localDate(event.start_at, tz)} ${localTime(event.start_at, tz)}`,
    `Katılımcılar: ${sources.attendees.map((a) => a.name ?? a.email.split('@')[0]).join(', ')}`,
    `Senden beklenenler: ${sources.commitments.filter((c) => c.direction === 'user_owes').length}`,
    `Senin beklediklerin: ${sources.commitments.filter((c) => c.direction === 'they_owe').length + sources.awaiting.filter((t) => t.reply_state === 'awaiting_their_reply').length}`,
  ];
  const result = await callModel(pipeline, {
    feature: 'meeting_prep',
    schema: MeetingPrepV1,
    schemaName: 'MeetingPrepV1',
    context,
    docs,
    vars: { count: docs.length },
    cacheContent: `meeting_prep\n${event.id}\n${sources.hash}`,
    units: 1,
    injection: injectionScan(docs.map((d) => d.text).join('\n')),
  });
  if (result.kind !== 'ai') return templatePrep(userId, sources, now, result.reason);
  const refined = refineMeetingPrepV1(result.data, { aliases: docs.map((d) => d.ref) });
  if (!refined.ok) return templatePrep(userId, sources, now, 'refine_failed');
  const data = refined.data;
  const scope = {
    aliases: aliasMap(docs.map((d) => [d.ref, d.text] as const)),
    anchor: now,
    timeZone: tz,
  };
  const refOf = (ref: string): Ref | null => {
    const src = bySource.get(ref);
    return src === undefined
      ? null
      : sourceRef({
          source_type: src.type,
          source_id: src.id,
          source_provider: src.provider,
          source_timestamp: src.at,
        });
  };
  const refsOf = (refs: readonly string[]): Ref[] =>
    [...new Set(refs)].map(refOf).filter((r): r is Ref => r !== null);

  const talking = data.talking_points.flatMap((p) => {
    if (groundQuote(p.evidence, scope, undefined, 'talking_points') === null) return [];
    const srcs = refsOf([p.evidence.ref, ...p.refs]);
    if (srcs.length === 0) return [];
    const text = [p.title_tr, p.body_tr].filter((t) => t.trim() !== '').join(' — ');
    return [{ text: clip(text, 200), sources: srcs }];
  });
  if (talking.length === 0) return templatePrep(userId, sources, now, 'no_grounded_points');

  const purposeEv =
    data.purpose.evidence === null
      ? null
      : groundQuote(data.purpose.evidence, scope, undefined, 'purpose');
  const last =
    data.last_interaction !== null && groundQuote(data.last_interaction.evidence, scope) !== null
      ? {
          text: clip(data.last_interaction.text_tr, 200),
          source: refOf(data.last_interaction.evidence.ref),
        }
      : null;
  const loops = data.open_loops.flatMap((l) => {
    const src = refOf(l.evidence.ref);
    return groundQuote(l.evidence, scope) === null || src === null
      ? []
      : [{ text: clip(l.text_tr, 200), source: src }];
  });
  const summary = data.summary_2min
    .map((p) => p.text_tr.trim())
    .filter((t) => t !== '')
    .join('\n\n');
  const summarySources = refsOf(data.summary_2min.flatMap((p) => p.refs));
  const entries: SourceEntry[] = [
    ...t0Entries(sources).filter((e) => e.kind !== 'previous'),
    ...(last === null || last.source === null
      ? t0Entries(sources).filter((e) => e.kind === 'previous')
      : [{ kind: 'previous' as const, text: last.text, source: last.source }]),
    ...summarySources.map((source) => ({ kind: 'summary_source' as const, source })),
  ];
  return {
    mode: 'ai',
    reason: null,
    row: {
      ...baseRow(userId, sources, now),
      purpose: data.purpose.text_tr === '' ? null : clip(data.purpose.text_tr, 300),
      purpose_evidence: purposeEv === null ? [] : [storedEvidence('purpose', purposeEv)],
      last_interaction:
        last === null || last.source === null ? null : { text: last.text, source: last.source },
      open_loops: loops.length > 0 ? loops : openLoopsT0(sources),
      talking_points: talking.slice(0, 3),
      summary_2min: summary === '' ? null : clip(summary, 1800),
      reading_time_sec: summary === '' ? null : Math.round(words(summary) / WORDS_PER_SECOND),
      sources: entries,
      prompt_version_id: result.promptVersionId,
      ai_request_id: result.aiRequestId,
      confidence: bandConfidence(data.confidence),
    },
  };
}

function entriesOf(row: MeetingPrepRow): SourceEntry[] {
  return (row.sources as SourceEntry[]).filter(
    (e) => typeof e === 'object' && e !== null && 'kind' in e,
  );
}

/** The API view of a prep (`MeetingPrepView`). */
export function prepView(row: MeetingPrepRow, event: MeetingEventRow): MeetingPrepView {
  const entries = entriesOf(row);
  const purposeEvidence = (row.purpose_evidence as { quote?: string }[]).flatMap((e) =>
    typeof e.quote === 'string'
      ? [
          {
            quote: e.quote.slice(0, 300),
            source: sourceRef({
              source_type: 'calendar_event',
              source_id: event.id,
              source_provider: event.provider,
              source_timestamp: event.updated_at,
            }),
          },
        ]
      : [],
  );
  const eventRef = sourceRef({
    source_type: 'calendar_event',
    source_id: event.id,
    source_provider: event.provider,
    source_timestamp: event.updated_at,
  });
  const summarySources = entries.flatMap((e) => (e.kind === 'summary_source' ? [e.source] : []));
  return {
    id: row.id,
    calendar_event_id: row.calendar_event_id,
    status: row.status === 'ready' ? 'ready' : row.status === 'failed' ? 'failed' : 'generating',
    event: {
      title: event.title ?? '',
      start: new Date(event.start_at).toISOString(),
      end: new Date(event.end_at).toISOString(),
      location: event.location,
      join_url:
        event.conference_url !== null && isAllowedConferencingUrl(event.conference_url)
          ? event.conference_url
          : null,
    },
    people: entries.flatMap((e) =>
      e.kind === 'person'
        ? [{ contact_id: e.contact_id, name: e.name, role_text: e.role_text }]
        : [],
    ),
    purpose:
      row.purpose === null
        ? null
        : {
            text: row.purpose.slice(0, 300),
            provenance: {
              source_type: eventRef.source_type,
              source_id: eventRef.source_id,
              source_provider: eventRef.source_provider,
              source_timestamp: eventRef.source_timestamp,
              confidence: purposeEvidence.length > 0 ? 0.9 : 0.6,
              evidence: purposeEvidence.slice(0, 5),
            },
          },
    previous_communication: entries
      .flatMap((e) =>
        e.kind === 'previous' ? [{ text: e.text.slice(0, 200), source: e.source }] : [],
      )
      .slice(0, 5),
    recent_emails: entries
      .flatMap((e) =>
        e.kind === 'recent_email'
          ? [
              {
                email_message_id: e.email_message_id,
                subject: e.subject,
                summary: e.summary.slice(0, 200),
                date: e.date,
              },
            ]
          : [],
      )
      .slice(0, 5),
    open_loops: (row.open_loops as { text: string; source: Ref }[]).slice(0, 5),
    user_commitments: entries.flatMap((e) =>
      e.kind === 'commitment' && e.direction === 'user_owes'
        ? [
            {
              commitment_id: e.commitment_id,
              text: e.text,
              due_at: e.due_at === null ? null : new Date(e.due_at).toISOString(),
            },
          ]
        : [],
    ),
    other_commitments: entries.flatMap((e) =>
      e.kind === 'commitment' && e.direction === 'they_owe'
        ? [
            {
              commitment_id: e.commitment_id,
              text: e.text,
              due_at: e.due_at === null ? null : new Date(e.due_at).toISOString(),
            },
          ]
        : [],
    ),
    relevant_files: [],
    talking_points: (row.talking_points as { text: string; sources: Ref[] }[])
      .filter((p) => p.sources.length > 0)
      .slice(0, 3),
    two_minute_summary:
      row.summary_2min === null
        ? null
        : { text: row.summary_2min.slice(0, 1800), sources: summarySources },
    generated_at: row.generated_at === null ? null : new Date(row.generated_at).toISOString(),
    source_hash: row.source_hash ?? '',
  };
}

/** Paragraphs of the "2 Dakikalık Özet" for native TTS (API-MEET-04). */
export function summaryParagraphs(row: MeetingPrepRow): string[] {
  return (row.summary_2min ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => p.slice(0, 1200))
    .slice(0, 8);
}
