/**
 * Post-meeting commitments (IMPLEMENTATION_PLAN T-5.10; AI_PIPELINE_PLAN §13.2; API-MEET-03; C-06).
 * The user's own note (`n1`) goes to T1 `PostMeetingCommitmentV1` (no tools). Code keeps an item
 * only when its quote is a substring of the note, re-parses the due date from the quote in the
 * user's time zone (anchor = meeting end: "yarın" → D+1), resolves the counterparty against the
 * attendee contacts (ambiguous → name only) and builds `commitment_create` payloads; the route
 * proposes them through B's approval path, and "Kaydet" approves them with `approved_via='in_place'`.
 */
import { resolveCommitmentDue } from '@da/domain';
import {
  type ApprovalPayload,
  PostMeetingCommitmentV1,
  refinePostMeetingCommitmentV1,
} from '@da/validation';
import type { T0Reason } from '../../ai/types.ts';
import { aliasMap, groundQuote } from '../ai/grounding.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import type { MeetingContact, MeetingEventRow, MeetingNoteRow } from '../assist/store.ts';
import { clip } from '../copy.ts';
import type { Attendee } from './prep.ts';

type CommitmentPayload = Extract<ApprovalPayload, { action_type: 'commitment_create' }>;

export interface PostProposal {
  readonly payload: CommitmentPayload;
  readonly text: string;
  readonly counterpartyLabel: string;
  readonly dueAt: string | null;
  readonly dueText: string | null;
  readonly direction: 'user_owes' | 'they_owe';
  readonly confidence: number;
  readonly quote: string;
}

export type PostOutcome =
  | { readonly kind: 'ok'; readonly proposals: PostProposal[]; readonly summary: string | null }
  | { readonly kind: 't0'; readonly reason: T0Reason | 'refine_failed' };

function stem(name: string): string {
  const trimmed = name.trim();
  const apostrophe = trimmed.search(/['’]/);
  const base = apostrophe === -1 ? trimmed : trimmed.slice(0, apostrophe);
  return base.toLocaleLowerCase('tr-TR');
}

/** Attendee contacts first; one match → the contact, otherwise the name only (confirmation). */
export function resolveCounterparty(
  quote: string | null,
  contacts: readonly MeetingContact[],
  attendees: readonly Attendee[],
): { contactId: string | null; name: string | null; email: string | null } {
  if (quote === null || quote.trim() === '') {
    const only = contacts.length === 1 ? contacts[0] : undefined;
    return only === undefined
      ? { contactId: null, name: null, email: null }
      : { contactId: only.id, name: only.display_name, email: null };
  }
  const key = stem(quote);
  const matches = contacts.filter((c) =>
    c.display_name
      .toLocaleLowerCase('tr-TR')
      .split(/\s+/)
      .some((part) => part === key || c.display_name.toLocaleLowerCase('tr-TR') === key),
  );
  if (matches.length === 1)
    return { contactId: matches[0]!.id, name: matches[0]!.display_name, email: null };
  const attendee = attendees.filter((a) =>
    (a.name ?? '').toLocaleLowerCase('tr-TR').split(/\s+/).includes(key),
  );
  if (attendee.length === 1) {
    return { contactId: null, name: attendee[0]!.name, email: attendee[0]!.email };
  }
  return { contactId: null, name: clip(quote.trim().replace(/['’].*$/, ''), 200), email: null };
}

export async function extractPostMeeting(
  pipeline: PipelineContext,
  input: {
    readonly event: MeetingEventRow;
    readonly note: MeetingNoteRow;
    readonly attendees: readonly Attendee[];
    readonly contacts: readonly MeetingContact[];
    readonly now: Date;
  },
): Promise<PostOutcome> {
  const text = input.note.body;
  const docs = [{ ref: 'n1', kind: 'transcript' as const, text }];
  const context = [
    ...trustedHeader(pipeline.user, input.now),
    `Toplantı: ${clip(input.event.title ?? '', 200)}`,
    `Katılımcılar: ${input.attendees.map((a) => a.name ?? a.email.split('@')[0]).join(', ')}`,
  ];
  const result = await callModel(pipeline, {
    feature: 'post_meeting_parse',
    schema: PostMeetingCommitmentV1,
    schemaName: 'PostMeetingCommitmentV1',
    promptKey: 'post_meeting',
    context,
    docs,
    units: 1,
  });
  if (result.kind !== 'ai') return { kind: 't0', reason: result.reason };
  const refined = refinePostMeetingCommitmentV1(result.data);
  if (!refined.ok) return { kind: 't0', reason: 'refine_failed' };
  const scope = {
    aliases: aliasMap([['n1', text]]),
    anchor: input.event.end_at,
    timeZone: pipeline.user.timeZone,
  };
  const source = {
    source_type: 'post_meeting_note' as const,
    source_id: input.note.id,
    source_provider: 'in_app' as const,
    source_timestamp: new Date(input.note.created_at).toISOString(),
  };
  const proposals: PostProposal[] = [];
  for (const item of refined.data.items.slice(0, 10)) {
    const verified = groundQuote(item.evidence, scope, undefined, 'items');
    if (verified === null) continue;
    const due =
      item.due_quote === null || !verified.quote.includes(item.due_quote.trim())
        ? resolveCommitmentDue(verified.quote, {
            anchor: input.event.end_at,
            timeZone: pipeline.user.timeZone,
          })
        : resolveCommitmentDue(item.due_quote, {
            anchor: input.event.end_at,
            timeZone: pipeline.user.timeZone,
          });
    const party = resolveCounterparty(item.counterparty_quote, input.contacts, input.attendees);
    const direction = item.owner === 'counterparty' ? 'they_owe' : 'user_owes';
    const confidence = item.certainty === 'explicit' ? 0.9 : 0.6;
    const label = party.name ?? party.email ?? input.event.title ?? '';
    const counterparty =
      party.contactId !== null
        ? {
            contact_id: party.contactId,
            ...(party.name === null ? {} : { name: clip(party.name, 200) }),
          }
        : party.email !== null
          ? { email: party.email, ...(party.name === null ? {} : { name: clip(party.name, 200) }) }
          : { name: clip(label === '' ? item.what_tr : label, 200) };
    const dueText = item.due_quote === null ? null : clip(item.due_quote, 100);
    const payload: CommitmentPayload = {
      action_type: 'commitment_create',
      text: clip(item.what_tr, 500),
      direction,
      counterparty,
      due_at: due === null ? null : due.dueAt.toISOString(),
      ...(dueText === null ? {} : { due_text: dueText }),
      due_precision: due === null ? 'none' : due.dateOnly ? 'date' : 'datetime',
      source,
      evidence: { quote: verified.quote.slice(0, 300), source },
      confidence,
    };
    proposals.push({
      payload,
      text: payload.text,
      counterpartyLabel: clip(label, 200),
      dueAt: payload.due_at,
      dueText,
      direction,
      confidence,
      quote: verified.quote.slice(0, 300),
    });
  }
  return { kind: 'ok', proposals, summary: refined.data.note_summary_tr };
}
