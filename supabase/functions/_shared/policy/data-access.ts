/**
 * AI Accessible Data guard (SECURITY_AND_PRIVACY_PLAN §4.4 "`_shared/policy/data-access.ts`",
 * API_CONTRACTS §4.5, SCREEN_AND_FLOW_MAP M-SET-32 / M-SET-33): the one place that decides which
 * data classes of `user_preferences.ai_data_access` may reach a model prompt or the AI memory.
 * Every context builder tags the parts that carry a class; `callModel` (the pipeline's single
 * structured-call path), the assistant retrieval, the embedding job and the direct model callers
 * (capture, reply drafts) filter through the functions below, so a class that is off never reaches a
 * prompt and is never embedded, and derived rows of that class already stored stay out of
 * retrieval.
 *
 * Classes (the toggle copy of M-SET-32 is the contract):
 * - `mail_body`: mail bodies and what the model derived from them (summaries, key points, thread
 *   summaries); with it off a model sees sender and subject only.
 * - `attachments`: attachment files and names, file / photo captures and their extractions.
 * - `calendar`: "Takvim ayrıntıları" = attendees, locations and descriptions of events (a prompt
 *   keeps the title and time, as the M-SET-33 consequence copy states).
 * - `contacts`: the contact book: person profiles and facts, relationship data, person scopes.
 * - `location_coarse`: the user's approximate location. The app never requests location, so no
 *   context builder produces this class; it defaults to off and any future source must be tagged
 *   with it to pass the guard.
 */
import { AppError } from '../errors.ts';

export const DATA_CLASSES = [
  'mail_body',
  'attachments',
  'calendar',
  'contacts',
  'location_coarse',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** `user_preferences.ai_data_access`, parsed (DB default: the first four on, location off). */
export interface AiDataAccess {
  readonly mailBody: boolean;
  readonly attachments: boolean;
  readonly calendar: boolean;
  readonly contacts: boolean;
  readonly locationCoarse: boolean;
}

export const DEFAULT_AI_DATA_ACCESS: AiDataAccess = {
  mailBody: true,
  attachments: true,
  calendar: true,
  contacts: true,
  locationCoarse: false,
};

/** Parses the stored jsonb; a missing key takes the DB default (`location_coarse` stays off). */
export function parseAiDataAccess(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): AiDataAccess {
  const value = raw ?? {};
  return {
    mailBody: value.mail_body !== false,
    attachments: value.attachments !== false,
    calendar: value.calendar !== false,
    contacts: value.contacts !== false,
    locationCoarse: value.location_coarse === true,
  };
}

export function dataAllowed(access: AiDataAccess, cls: DataClass): boolean {
  switch (cls) {
    case 'mail_body':
      return access.mailBody;
    case 'attachments':
      return access.attachments;
    case 'calendar':
      return access.calendar;
    case 'contacts':
      return access.contacts;
    case 'location_coarse':
      return access.locationCoarse;
  }
}

/** True when every class in `requires` is on (an untagged part is always allowed). */
export function allAllowed(
  access: AiDataAccess,
  requires: readonly DataClass[] | undefined,
): boolean {
  return (requires ?? []).every((cls) => dataAllowed(access, cls));
}

/** The classes that are off (content-free: for logs and results). */
export function disabledClasses(access: AiDataAccess): DataClass[] {
  return DATA_CLASSES.filter((cls) => !dataAllowed(access, cls));
}

/** Interactive routes whose whole purpose needs a class answer `403 DATA_SOURCE_DISABLED`. */
export function assertDataAllowed(access: AiDataAccess, cls: DataClass): void {
  if (!dataAllowed(access, cls)) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: `ai_data_access.${cls}` } });
  }
}

/** A prompt part (context line or document) with the classes it carries. */
export interface Guarded {
  readonly requires?: readonly DataClass[];
}

/** Keeps the parts whose classes are all on. */
export function admit<T extends Guarded>(access: AiDataAccess, parts: readonly T[]): T[] {
  return parts.filter((p) => allAllowed(access, p.requires));
}

/** A trusted context line, optionally tagged. */
export type ContextLine =
  string | { readonly text: string; readonly requires: readonly DataClass[] };

export function admitContext(access: AiDataAccess, lines: readonly ContextLine[]): string[] {
  return lines.flatMap((line) =>
    typeof line === 'string' ? [line] : allAllowed(access, line.requires) ? [line.text] : [],
  );
}

/** A tagged context line (convenience for the builders). */
export function tagged(text: string, ...requires: DataClass[]): ContextLine {
  return { text, requires };
}

/** The calendar fields a prompt may carry: title and time always, details only with `calendar`. */
export function eventDetailsAllowed(access: AiDataAccess): boolean {
  return access.calendar;
}

// ── Memory and retrieval ────────────────────────────────────────────────────────────────────

const MAIL_BODY_CHUNKS: ReadonlySet<string> = new Set([
  'email_summary',
  'thread_summary',
  'key_point',
]);
const CALENDAR_SOURCES: ReadonlySet<string> = new Set(['calendar_event', 'device_calendar_event']);

/** The classes a memory chunk (or its source) is derived from. */
export function chunkDataClasses(chunk: {
  readonly chunk_kind: string;
  readonly source_type: string;
}): DataClass[] {
  const out: DataClass[] = [];
  if (MAIL_BODY_CHUNKS.has(chunk.chunk_kind)) out.push('mail_body');
  if (chunk.chunk_kind === 'event' || CALENDAR_SOURCES.has(chunk.source_type)) out.push('calendar');
  if (chunk.source_type === 'contact') out.push('contacts');
  // Chunks do not keep the capture kind: every capture extraction counts as attachment-derived.
  if (chunk.source_type === 'capture') out.push('attachments');
  return out;
}

export function chunkAllowed(
  access: AiDataAccess,
  chunk: { readonly chunk_kind: string; readonly source_type: string },
): boolean {
  return allAllowed(access, chunkDataClasses(chunk));
}

/** One retrieved row (RPC-02 `search_user_content`) before it becomes a `search_result` block. */
export interface RetrievedRow {
  readonly type: string;
  readonly title: string;
  readonly snippet: string;
  readonly source: { readonly source_type: string };
}

/**
 * Retrieval for a model prompt (assistant grounded QA): rows of a disabled class are dropped,
 * and rows whose snippet carries a disabled class keep their title only (an email result's snippet
 * is the stored AI summary; an event result's snippet is its location or description).
 */
export function admitRetrieved<T extends RetrievedRow>(
  access: AiDataAccess,
  rows: readonly T[],
): T[] {
  return rows.flatMap((row): T[] => {
    switch (row.type) {
      case 'person':
        return access.contacts ? [row] : [];
      case 'capture':
        return access.attachments ? [row] : [];
      case 'email':
        return access.mailBody ? [row] : [{ ...row, snippet: '' }];
      case 'event':
        return access.calendar ? [row] : [{ ...row, snippet: '' }];
      case 'memory': {
        const st = row.source.source_type;
        const classes: DataClass[] = [];
        if (st === 'email_message' || st === 'email_thread') classes.push('mail_body');
        if (CALENDAR_SOURCES.has(st)) classes.push('calendar');
        if (st === 'contact') classes.push('contacts');
        if (st === 'capture') classes.push('attachments');
        return allAllowed(access, classes) ? [row] : [];
      }
      default:
        return [row];
    }
  });
}
