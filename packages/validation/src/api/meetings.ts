import { z } from 'zod';
import { COMMITMENT_DIRECTION_VALUES } from '@da/domain';
import { ApprovalView } from './approvals.ts';
import { IsoDateTime, JobRef, Locale, Provenance, SourceRef, Uuid } from './common.ts';
import { Success } from './envelope.ts';

export const EventIdParams = z.strictObject({ eventId: Uuid });

/** Conferencing hosts allowed for `join_url` / `meeting_url` (SREQ-23). */
export const CONFERENCING_HOSTS = [
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
] as const;

/** `true` for `https:` URLs on an allow-listed conferencing host (including `*.zoom.us`). */
export function isAllowedConferencingUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return (
    (CONFERENCING_HOSTS as readonly string[]).includes(host) ||
    host === 'zoom.us' ||
    host.endsWith('.zoom.us')
  );
}
export const ConferencingUrl = z
  .url()
  .refine(isAllowedConferencingUrl, 'conferencing_host_not_allowed');

// API-MEET-01 · POST /meetings/:eventId/prep
export const MeetingPrepBody = z.strictObject({ refresh: z.boolean().default(false) });
const CommitmentLine = z.object({
  commitment_id: Uuid,
  text: z.string(),
  due_at: IsoDateTime.nullable(),
});
export const MeetingPrepView = z.object({
  id: Uuid,
  calendar_event_id: Uuid,
  status: z.enum(['generating', 'ready', 'failed']),
  event: z.object({
    title: z.string(),
    start: IsoDateTime,
    end: IsoDateTime,
    location: z.string().nullable(),
    join_url: ConferencingUrl.nullable(),
  }),
  people: z.array(
    z.object({ contact_id: Uuid, name: z.string(), role_text: z.string().nullable() }),
  ),
  purpose: z.object({ text: z.string().max(300), provenance: Provenance }).nullable(),
  previous_communication: z
    .array(z.object({ text: z.string().max(200), source: SourceRef }))
    .max(5),
  recent_emails: z
    .array(
      z.object({
        email_message_id: Uuid,
        subject: z.string(),
        summary: z.string().max(200),
        date: IsoDateTime,
      }),
    )
    .max(5),
  open_loops: z.array(z.object({ text: z.string(), source: SourceRef })).max(5),
  user_commitments: z.array(CommitmentLine),
  other_commitments: z.array(CommitmentLine),
  relevant_files: z.array(
    z.object({ name: z.string(), attachment_ref: z.string(), email_message_id: Uuid }),
  ),
  talking_points: z
    .array(z.object({ text: z.string().max(200), sources: z.array(SourceRef).min(1) }))
    .max(3),
  two_minute_summary: z
    .object({ text: z.string().max(1800), sources: z.array(SourceRef) })
    .nullable(),
  generated_at: IsoDateTime.nullable(),
  source_hash: z.string(),
});
export type MeetingPrepView = z.infer<typeof MeetingPrepView>;
export const MeetingPrepResponse = Success(
  z.object({ prep: MeetingPrepView, job: JobRef.nullable() }),
);

// API-MEET-02 · POST /meetings/:eventId/notes
export const MeetingNoteBody = z
  .strictObject({
    client_note_id: Uuid,
    body: z.string().min(1).max(10000),
    source: z.enum(['text', 'voice']),
    transcript_confidence: z.number().min(0).max(1).optional(),
  })
  .refine((b) => b.source === 'voice' || b.transcript_confidence === undefined, {
    message: 'confidence_voice_only',
    path: ['transcript_confidence'],
  });
export const MeetingNoteResponse = Success(
  z.object({
    id: Uuid,
    calendar_event_id: Uuid,
    body: z.string(),
    source: z.string(),
    created_at: IsoDateTime,
  }),
);

// API-MEET-03 · POST /meetings/:eventId/post
export const MeetingPostBody = z.strictObject({
  client_post_id: Uuid,
  text: z.string().min(1).max(5000),
  source: z.enum(['text', 'voice']),
});
export const MeetingPostResponse = Success(
  z.object({
    note_id: Uuid,
    proposals: z
      .array(
        z.object({
          approval: ApprovalView,
          text: z.string(),
          counterparty_label: z.string(),
          due_at: IsoDateTime.nullable(),
          due_text: z.string().nullable(),
          direction: z.enum(COMMITMENT_DIRECTION_VALUES),
          confidence: z.number(),
          quote: z.string(),
        }),
      )
      .max(10),
    none_found: z.boolean(),
  }),
);

// API-MEET-04 · POST /meetings/:eventId/prep/audio
export const MeetingPrepAudioBody = z.strictObject({ prep_version_hash: z.string().max(64) });
export const MeetingPrepAudioResponse = Success(
  z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('premium'),
      signed_url: z.url(),
      expires_at: IsoDateTime,
      duration_s: z.int(),
      chapters: z.array(z.object({ index: z.int(), title: z.string(), start_s: z.int() })),
    }),
    z.object({
      mode: z.literal('native'),
      language: Locale,
      paragraphs: z.array(z.string().max(1200)).max(8),
      notice_key: z.string().nullable(),
      premium_status: z.enum(['generating', 'unavailable']).nullable(),
    }),
  ]),
);
