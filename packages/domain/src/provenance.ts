/**
 * Provenance of every derived object (ADR-05, M§83, M§97): where it came from, when, how sure we
 * are, and verified evidence quotes. `sourceLabel()` renders the source line shown under every AI
 * inference ("Gmail · Mehmet Yılmaz · 08:42").
 */
import type { Provider, SourceType } from './enums.ts';
import { SOURCE_TYPE_VALUES } from './enums.ts';
import type { MessageResolver } from './entities/message.ts';
import { type AppLocale, formatInZone } from './time/format.ts';
import { type Instant, localDate, localTime, toDate } from './time/zone.ts';

/** Maximum evidence items per row and quote length (DATABASE_AND_RLS_PLAN ⟨EVID⟩). */
export const MAX_EVIDENCE_ITEMS = 5;
export const MAX_QUOTE_LENGTH = 300;

/** Evidence as persisted in `evidence jsonb` (keys whitelisted by `private.valid_evidence`). */
export interface StoredEvidence {
  readonly quote: string;
  readonly field: string;
  readonly locator?: string;
}

export type SourceProvider = Provider | 'in_app';

/** The ⟨PROV⟩ + ⟨EVID⟩ columns of a derived row. */
export interface Provenance {
  readonly source_type: SourceType;
  readonly source_id: string;
  /** Null only for `user_input`. */
  readonly source_provider: Provider | null;
  /** ISO 8601 instant. */
  readonly source_timestamp: string;
  /** Calibrated confidence in [0, 1] with 3 decimals (numeric(4,3)). */
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
}

const EVIDENCE_KEYS = new Set(['quote', 'field', 'locator']);

/** Mirrors `private.valid_evidence(evidence)`: array ≤5, quote 1..300, field non-empty, key whitelist. */
export function isValidEvidence(value: unknown): value is readonly StoredEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ITEMS) return false;
  return value.every((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const rec = item as Record<string, unknown>;
    if (!Object.keys(rec).every((k) => EVIDENCE_KEYS.has(k))) return false;
    const { quote, field, locator } = rec;
    return (
      typeof quote === 'string' &&
      quote.length > 0 &&
      quote.length <= MAX_QUOTE_LENGTH &&
      typeof field === 'string' &&
      field.length > 0 &&
      (locator === undefined || typeof locator === 'string')
    );
  });
}

/** Clamps to [0, 1] and rounds to 3 decimals; NaN becomes 0. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}

export function makeProvenance(input: {
  sourceType: SourceType;
  sourceId: string;
  sourceProvider: Provider | null;
  sourceTimestamp: Instant;
  confidence: number;
  evidence?: readonly StoredEvidence[];
}): Provenance {
  if (!SOURCE_TYPE_VALUES.includes(input.sourceType)) {
    throw new RangeError(`unknown source_type ${input.sourceType}`);
  }
  if (input.sourceProvider === null && input.sourceType !== 'user_input') {
    throw new RangeError('source_provider is required unless source_type is user_input');
  }
  if (input.sourceId.length < 1 || input.sourceId.length > 200) {
    throw new RangeError('source_id must be 1..200 chars');
  }
  const evidence = (input.evidence ?? []).slice(0, MAX_EVIDENCE_ITEMS).map((e) => ({
    ...e,
    quote: e.quote.slice(0, MAX_QUOTE_LENGTH),
  }));
  if (!isValidEvidence(evidence)) throw new RangeError('invalid evidence');
  return {
    source_type: input.sourceType,
    source_id: input.sourceId,
    source_provider: input.sourceProvider,
    source_timestamp: toDate(input.sourceTimestamp).toISOString(),
    confidence: clampConfidence(input.confidence),
    evidence,
  };
}

/** Stable key of a source name, resolvable as i18n key `common.source.{key}`. */
export type SourceNameKey =
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'apple_calendar'
  | 'device_calendar'
  | 'google_tasks'
  | 'microsoft_todo'
  | 'apple_reminders'
  | 'in_app'
  | 'demo'
  | 'capture'
  | 'meeting_note'
  | 'phone_notification'
  | 'assistant'
  | 'user'
  | 'commitment'
  | 'life'
  | 'contact'
  | 'briefing'
  | 'feedback';

/** Brand and product names (proper nouns) plus the Turkish/English defaults. */
const SOURCE_NAMES: Readonly<Record<SourceNameKey, Readonly<Record<AppLocale, string>>>> = {
  gmail: { tr: 'Gmail', en: 'Gmail' },
  outlook: { tr: 'Outlook', en: 'Outlook' },
  google_calendar: { tr: 'Google Takvim', en: 'Google Calendar' },
  outlook_calendar: { tr: 'Outlook Takvim', en: 'Outlook Calendar' },
  apple_calendar: { tr: 'Apple Takvim', en: 'Apple Calendar' },
  device_calendar: { tr: 'Cihaz takvimi', en: 'Device calendar' },
  google_tasks: { tr: 'Google Görevler', en: 'Google Tasks' },
  microsoft_todo: { tr: 'Microsoft To Do', en: 'Microsoft To Do' },
  apple_reminders: { tr: 'Apple Anımsatıcılar', en: 'Apple Reminders' },
  in_app: { tr: 'Dijital Asistan', en: 'Dijital Asistan' },
  demo: { tr: 'Demo', en: 'Demo' },
  capture: { tr: 'Yakalama', en: 'Capture' },
  meeting_note: { tr: 'Toplantı notu', en: 'Meeting note' },
  phone_notification: { tr: 'Telefon bildirimi', en: 'Phone notification' },
  assistant: { tr: 'Asistan', en: 'Assistant' },
  user: { tr: 'Sen', en: 'You' },
  commitment: { tr: 'Taahhüt', en: 'Commitment' },
  life: { tr: 'Kişisel', en: 'Personal' },
  contact: { tr: 'Kişi', en: 'Contact' },
  briefing: { tr: 'Brifing', en: 'Briefing' },
  feedback: { tr: 'Geri bildirim', en: 'Feedback' },
};

/** Which source name applies to a provider + source type. */
export function sourceNameKey(
  provider: SourceProvider | null,
  sourceType: SourceType,
): SourceNameKey {
  switch (sourceType) {
    case 'email_message':
    case 'email_thread':
      if (provider === 'microsoft') return 'outlook';
      if (provider === 'demo') return 'demo';
      return 'gmail';
    case 'calendar_event':
      if (provider === 'microsoft') return 'outlook_calendar';
      if (provider === 'demo') return 'demo';
      if (provider === 'apple_device') return 'apple_calendar';
      if (provider === 'android_device') return 'device_calendar';
      return 'google_calendar';
    case 'device_calendar_event':
      return provider === 'apple_device' ? 'apple_calendar' : 'device_calendar';
    case 'task':
      if (provider === 'google') return 'google_tasks';
      if (provider === 'microsoft') return 'microsoft_todo';
      if (provider === 'apple_device') return 'apple_reminders';
      if (provider === 'demo') return 'demo';
      return 'in_app';
    case 'capture':
      return 'capture';
    case 'meeting_note':
    case 'post_meeting_note':
      return 'meeting_note';
    case 'android_notification':
      return 'phone_notification';
    case 'assistant_message':
      return 'assistant';
    case 'user_input':
      return 'user';
    case 'commitment':
      return 'commitment';
    case 'life_event':
      return 'life';
    case 'contact':
      return 'contact';
    case 'briefing':
      return 'briefing';
    case 'ai_feedback':
      return 'feedback';
  }
}

export interface SourceLabelInput {
  readonly provider: SourceProvider | null;
  readonly sourceType: SourceType;
  /** Display name of the person behind the source (sender, organiser), if known. */
  readonly person?: string | null;
  readonly at: Instant;
  readonly timeZone: string;
  /** When given and `at` is on another local day, the date is included ("23 Eyl 08:42"). */
  readonly now?: Instant;
  readonly locale?: AppLocale;
}

/** Separator of the source line parts. */
export const SOURCE_LABEL_SEPARATOR = ' · ';

/**
 * "Gmail · Mehmet Yılmaz · 08:42". The source name comes from `resolve('common.source.{key}')`
 * when a resolver is passed, otherwise from the built-in tr/en names.
 */
export function sourceLabel(input: SourceLabelInput, resolve?: MessageResolver): string {
  const locale = input.locale ?? 'tr';
  const key = sourceNameKey(input.provider, input.sourceType);
  const name = resolve ? resolve(`common.source.${key}`, {}) : SOURCE_NAMES[key][locale];
  const sameDay =
    input.now === undefined ||
    localDate(input.at, input.timeZone) === localDate(input.now, input.timeZone);
  const when = sameDay
    ? localTime(input.at, input.timeZone)
    : formatInZone(input.at, input.timeZone, 'd MMM HH:mm', locale);
  const person = input.person?.trim();
  return [name, person, when]
    .filter((p): p is string => p !== undefined && p !== '')
    .join(SOURCE_LABEL_SEPARATOR);
}
