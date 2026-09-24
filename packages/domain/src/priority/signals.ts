/**
 * Deterministic (T0) mail signals (AI_PIPELINE_PLAN §7.4, §8.2, §8.3). Pure header/metadata
 * inspection; no content leaves this function.
 */
import { foldTR, normalizeTR } from '../extract/normalize-tr.ts';

export type SignalCode =
  | 'security_verified'
  | 'security_unverified'
  | 'list_unsubscribe'
  | 'precedence_bulk'
  | 'auto_submitted'
  | 'category_promotions'
  | 'category_social'
  | 'category_forums'
  | 'category_updates'
  | 'esp_bulk'
  | 'noreply_sender'
  | 'cc_only_unknown'
  | 'calendar_invite'
  | 'transactional'
  | 'awaiting_my_reply'
  | 'deadline_today'
  | 'deadline_tomorrow'
  | 'known_contact'
  | 'replied_before'
  | 'direct_to'
  | 'urgency_keyword'
  | 'interest_match';

/** Signals that put a message in the bulk baseline (`low_priority`, T0-final). */
export const BULK_SIGNALS: readonly SignalCode[] = [
  'list_unsubscribe',
  'precedence_bulk',
  'auto_submitted',
  'category_promotions',
  'category_social',
  'category_forums',
  'esp_bulk',
];

/** Signals that put a message in the `informational` baseline. */
export const INFORMATIONAL_SIGNALS: readonly SignalCode[] = [
  'category_updates',
  'noreply_sender',
  'cc_only_unknown',
  'transactional',
  'security_unverified',
];

export interface MailHeaders {
  /** A `List-Unsubscribe` header is present. */
  readonly listUnsubscribe?: boolean;
  /** `Precedence:` header value. */
  readonly precedence?: string | null;
  /** `Auto-Submitted:` header value. */
  readonly autoSubmitted?: string | null;
}

export interface SignalInput {
  readonly fromEmail: string;
  readonly toEmails?: readonly string[];
  readonly ccEmails?: readonly string[];
  /** The user's own addresses (all connected aliases). */
  readonly userAddresses?: readonly string[];
  /** Gmail labels (`CATEGORY_PROMOTIONS` …) or Graph categories. */
  readonly labels?: readonly string[];
  readonly headers?: MailHeaders;
  /** DKIM `d=` signing domain, when the signature verified. */
  readonly dkimDomain?: string | null;
  readonly dkimPass?: boolean | null;
  /** The message matched a provider security template ("Hesabında yeni giriş"). */
  readonly securityTemplate?: boolean;
  /** Domain the security template claims to come from (e.g. `google.com`). */
  readonly securityProviderDomain?: string | null;
  readonly calendarInvite?: boolean;
  /** Transactional template / JSON-LD order, shipment, invoice. */
  readonly transactional?: boolean;
  readonly knownContact?: boolean;
  readonly repliedBefore?: boolean;
  /** The thread is awaiting the user's answer. */
  readonly awaitingUserReply?: boolean;
  /** Days from today to a verified deadline (0 today, 1 tomorrow). */
  readonly verifiedDeadlineInDays?: number | null;
  readonly subject?: string | null;
  /** First visible characters (≤400) used only for the urgency keyword trigger. */
  readonly snippet?: string | null;
  /** The item matches one of the user's `interest_categories` (SREQ-54). */
  readonly interestMatch?: boolean;
}

const ESP_DKIM = [
  'mailchimp',
  'mcsv.net',
  'mcdlv.net',
  'sendgrid',
  'amazonses',
  'mailgun',
  'sparkpost',
  'hubspot',
  'hs-mail',
  'salesforce',
  'exacttarget',
];
const NOREPLY = /^(?:no-?reply|donotreply|do-not-reply|bildirim|info|notifications?)[@+.]/i;
/** TR urgency keywords (§8.3), matched on the folded subject + first 400 visible chars. */
const URGENCY =
  /(?<!\p{L})(?:acil|ivedi|hemen|bugun|bu aksam|yarin sabah|son tarih|son gun|en gec|mesai bitimine|deadline|urgent|asap)(?!\p{L})/u;

export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function domainOf(d: string | null | undefined): string {
  return (d ?? '').toLowerCase();
}

function alignedDomain(signing: string, claimed: string): boolean {
  return signing === claimed || signing.endsWith(`.${claimed}`) || claimed.endsWith(`.${signing}`);
}

export function hasUrgencyKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  return URGENCY.test(foldTR(normalizeTR(text.slice(0, 600))));
}

/** All deterministic signals present on a message, in a stable order. */
export function detectSignals(input: SignalInput): SignalCode[] {
  const out: SignalCode[] = [];
  const labels = (input.labels ?? []).map((l) => l.toUpperCase());
  const h = input.headers ?? {};

  if (input.securityTemplate) {
    const signing = domainOf(input.dkimDomain);
    const claimed = domainOf(input.securityProviderDomain ?? emailDomain(input.fromEmail));
    const verified = input.dkimPass === true && signing !== '' && alignedDomain(signing, claimed);
    out.push(verified ? 'security_verified' : 'security_unverified');
  }
  if (h.listUnsubscribe) out.push('list_unsubscribe');
  if (h.precedence && /^(bulk|list|junk)$/i.test(h.precedence.trim())) out.push('precedence_bulk');
  if (h.autoSubmitted && /^auto-/i.test(h.autoSubmitted.trim())) out.push('auto_submitted');
  if (labels.includes('CATEGORY_PROMOTIONS')) out.push('category_promotions');
  if (labels.includes('CATEGORY_SOCIAL')) out.push('category_social');
  if (labels.includes('CATEGORY_FORUMS')) out.push('category_forums');
  if (labels.includes('CATEGORY_UPDATES')) out.push('category_updates');
  const signing = domainOf(input.dkimDomain);
  if (signing && ESP_DKIM.some((esp) => signing.includes(esp))) out.push('esp_bulk');
  if (NOREPLY.test(input.fromEmail.trim())) out.push('noreply_sender');

  const mine = input.userAddresses ?? [];
  const inTo = (input.toEmails ?? []).some((t) => mine.some((u) => sameAddress(t, u)));
  if (mine.length > 0) {
    // Cc, Bcc or a list copy from an unknown sender is informational
    if (inTo) out.push('direct_to');
    else if (!input.knownContact) out.push('cc_only_unknown');
  }
  if (input.calendarInvite) out.push('calendar_invite');
  if (input.transactional) out.push('transactional');
  if (input.awaitingUserReply) out.push('awaiting_my_reply');
  if (input.verifiedDeadlineInDays === 0) out.push('deadline_today');
  else if (input.verifiedDeadlineInDays === 1) out.push('deadline_tomorrow');
  if (input.knownContact) out.push('known_contact');
  if (input.repliedBefore) out.push('replied_before');
  if (hasUrgencyKeyword(`${input.subject ?? ''} ${input.snippet ?? ''}`))
    out.push('urgency_keyword');
  if (input.interestMatch) out.push('interest_match');
  return out;
}

export function isBulk(signals: readonly SignalCode[]): boolean {
  return signals.some((s) => BULK_SIGNALS.includes(s));
}
