/**
 * Synthetic rows and the eval user for the golden sets (AI_PIPELINE_PLAN §16.2: synthetic only, no
 * user data). The sets are written against one anchor, Thursday 24 September 2026 09:30 Istanbul, so
 * relative dates ("yarın", "Cuma") resolve the same way in every run. Nothing here is persisted.
 */
import type { AiFeature } from '@da/domain';
import type { AiUser } from '../../services/ai/runtime.ts';
import type { MeetingEventRow, MeetingNoteRow } from '../../services/assist/store.ts';
import type { MailMessageRow, MailThreadRow } from '../../services/intel/types.ts';
import type { FlagMap } from '../../services/flags.ts';

/** The golden-set anchor (Perşembe 09:30 Europe/Istanbul). */
export const EVAL_NOW = new Date('2026-09-24T06:30:00.000Z');
/** A fixed non-user id: eval rows are never written, and telemetry records `user_id = null`. */
export const EVAL_USER_ID = '00000000-0000-4000-8000-00000000e7a1';
const EVAL_ACCOUNT_ID = '00000000-0000-4000-8000-00000000e7a2';
export const EVAL_OWN_ADDRESS = 'yunus@firma.example';

let seq = 0;
/** Deterministic ids for synthetic rows (per process). */
export function evalId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
}

/**
 * Every switch the evaluated services consult, on: an eval measures the configured route even
 * while a kill switch keeps it out of production (activation is gated on the result).
 */
export function evalFlags(features: readonly AiFeature[]): FlagMap {
  const flags: Record<string, boolean> = {
    'ai.global.enabled': true,
    'ai.model.large.enabled': true,
    'ai.model.opus_escalation': false,
    'ai.provider.anthropic.enabled': true,
    'ai.provider.openai.enabled': true,
    'ai.provider.voyage.enabled': true,
    'feature.meeting_prep': true,
    'feature.capture': true,
    'feature.voice': true,
  };
  for (const feature of features) flags[`ai.feature.${feature}`] = true;
  return flags;
}

export function evalUser(features: readonly AiFeature[]): AiUser {
  return {
    userId: EVAL_USER_ID,
    plan: 'pro',
    isPro: true,
    profile: 'balanced',
    flags: evalFlags(features),
    timeZone: 'Europe/Istanbul',
    locale: 'tr',
    displayName: 'Yunus',
    dataAccess: {
      mailBody: true,
      attachments: true,
      calendar: true,
      contacts: true,
      locationCoarse: false,
    },
    learnFromInteractions: true,
    followUpAfterDays: 2,
    workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    userRef: null,
  };
}

const hourAgo = () => new Date(EVAL_NOW.getTime() - 3_600_000).toISOString();

export function evalThread(overrides: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    id: evalId(),
    user_id: EVAL_USER_ID,
    connected_account_id: EVAL_ACCOUNT_ID,
    provider: 'google',
    subject: 'Konu',
    participants: [],
    message_count: 1,
    last_message_at: hourAgo(),
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

export function evalMessage(overrides: Partial<MailMessageRow> = {}): MailMessageRow {
  const id = overrides.id ?? evalId();
  return {
    id,
    user_id: EVAL_USER_ID,
    connected_account_id: EVAL_ACCOUNT_ID,
    thread_id: evalId(),
    provider: 'google',
    provider_message_id: `eval-${id}`,
    direction: 'inbound',
    from_email: 'mehmet@yilmazendustri.example',
    from_name: 'Mehmet Yılmaz',
    to_emails: [EVAL_OWN_ADDRESS],
    cc_emails: [],
    subject: 'Konu',
    snippet: null,
    sent_at: null,
    received_at: hourAgo(),
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

export function evalMeetingEvent(overrides: Partial<MeetingEventRow> = {}): MeetingEventRow {
  return {
    id: evalId(),
    user_id: EVAL_USER_ID,
    connected_account_id: EVAL_ACCOUNT_ID,
    calendar_id: evalId(),
    provider: 'google',
    title: 'Teklif görüşmesi',
    start_at: new Date(EVAL_NOW.getTime() + 3 * 3_600_000).toISOString(),
    end_at: new Date(EVAL_NOW.getTime() + 4 * 3_600_000).toISOString(),
    all_day: false,
    status: 'confirmed',
    location: null,
    is_online: true,
    organizer_self: true,
    organizer_email: EVAL_OWN_ADDRESS,
    can_modify: true,
    attendees: [{ email: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
    attendee_count: 1,
    description_excerpt: null,
    conference_url: null,
    updated_at: new Date(EVAL_NOW.getTime() - 86_400_000).toISOString(),
    ...overrides,
  };
}

export function evalNote(
  eventId: string,
  body: string,
  kind: MeetingNoteRow['kind'] = 'post_meeting',
): MeetingNoteRow {
  return {
    id: evalId(),
    user_id: EVAL_USER_ID,
    calendar_event_id: eventId,
    kind,
    body,
    input: 'text',
    client_note_id: null,
    created_at: EVAL_NOW.toISOString(),
  };
}
