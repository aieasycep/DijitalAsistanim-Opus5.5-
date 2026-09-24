/**
 * Deterministic identifiers: SHA-256 (pure TypeScript, synchronous, identical in Node, Deno and
 * Hermes), dedupe keys and idempotency keys. Formats follow DATABASE_AND_RLS_PLAN §1.5 and the job
 * key catalogue in §6.2; every key is stable for equal input.
 */
import type {
  ApprovalActionType,
  BriefingKind,
  CommitmentDirection,
  InsightKind,
  LifeEventType,
  NotificationCategory,
  ReferralSide,
  SourceType,
} from './enums.ts';
import { foldTR, normalizeTR } from './extract/normalize-tr.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 4122 UUID (versions 1–8). */
export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** UTF-8 encoding without TextEncoder (not part of the ES2022 lib). */
export function utf8Bytes(input: string): number[] {
  const out: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 of the UTF-8 encoding of `input`, as 64 lowercase hex characters. */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLength / 0x100000000);
  const lo = bitLength >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      const i = off + t * 4;
      w[t] =
        (((bytes[i] ?? 0) << 24) |
          ((bytes[i + 1] ?? 0) << 16) |
          ((bytes[i + 2] ?? 0) << 8) |
          (bytes[i + 3] ?? 0)) >>>
        0;
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let k = 0; k < 8; k++) h[k] = ((h[k] ?? 0) + (next[k] ?? 0)) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** First `n` hex chars of SHA-256 (e.g. `hash16`). */
export function shortHash(input: string, n = 16): string {
  return sha256Hex(input).slice(0, n);
}

/** Separator used when hashing a tuple of identity fields (ASCII unit separator). */
export const FIELD_SEPARATOR = '\u001f';

function need(value: string, name: string): string {
  if (value.length === 0) throw new RangeError(`${name} must be non-empty`);
  return value;
}

function positiveInt(n: number, name: string): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${name} must be a positive integer`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Idempotency keys (DATABASE_AND_RLS_PLAN §1.5, §6.2; API_CONTRACTS §6.3)
// ---------------------------------------------------------------------------------------------

/** `briefing:{user}:{kind}:{local_date}` — briefings row and job key. */
export function briefingKey(userId: string, kind: BriefingKind, localDate: string): string {
  return `briefing:${need(userId, 'userId')}:${kind}:${need(localDate, 'localDate')}`;
}

/** `approval:{id}:v{payload_version}` — `approval_actions.idempotency_key` (new per edit). */
export function approvalIdempotencyKey(approvalId: string, payloadVersion: number): string {
  return `approval:${need(approvalId, 'approvalId')}:v${positiveInt(payloadVersion, 'payloadVersion')}`;
}

/** `approval_execute:{approval_id}:v{payload_version}` — one execution job per approved version. */
export function approvalExecuteJobKey(approvalId: string, payloadVersion: number): string {
  return `approval_execute:${need(approvalId, 'approvalId')}:v${positiveInt(payloadVersion, 'payloadVersion')}`;
}

/** AI-proposed approvals: `ai:{action_type}:{source_type}:{source_id}:{item_hash16}:{payload_version}`. */
export function aiProposalIdempotencyKey(
  actionType: ApprovalActionType,
  sourceType: SourceType,
  sourceId: string,
  itemFingerprint: string,
  payloadVersion = 1,
): string {
  return `ai:${actionType}:${sourceType}:${need(sourceId, 'sourceId')}:${shortHash(itemFingerprint)}:${positiveInt(payloadVersion, 'payloadVersion')}`;
}

/** `sync:{account}:{cursor}` — incremental sync step. */
export function syncKey(accountId: string, cursor: string): string {
  return `sync:${need(accountId, 'accountId')}:${need(cursor, 'cursor')}`;
}

/** `notify:{id}` — a notification job for one ledger row. */
export function notifyKey(notificationId: string): string {
  return `notify:${need(notificationId, 'notificationId')}`;
}

/** `notif:{user}:{dedupe_key}` — JOB-18 idempotency key. */
export function notificationJobKey(userId: string, dedupeKey: string): string {
  return `notif:${need(userId, 'userId')}:${need(dedupeKey, 'dedupeKey')}`;
}

/** `meeting_prep:{event_id}:{start_at_epoch}` */
export function meetingPrepKey(eventId: string, startAtEpoch: number): string {
  return `meeting_prep:${need(eventId, 'eventId')}:${Math.trunc(startAtEpoch)}`;
}

/** `meeting_prep_notify:{event_id}:{start_at_epoch}` (R-23 prep push). */
export function meetingPrepNotifyKey(eventId: string, startAtEpoch: number): string {
  return `meeting_prep_notify:${need(eventId, 'eventId')}:${Math.trunc(startAtEpoch)}`;
}

/** `post_meeting:{event_id}` */
export function postMeetingKey(eventId: string): string {
  return `post_meeting:${need(eventId, 'eventId')}`;
}

/** `reminder:{reminder_id}` — reminder push job and notification dedupe key. */
export function reminderKey(reminderId: string): string {
  return `reminder:${need(reminderId, 'reminderId')}`;
}

/** `nudge:{insight_id}:{local_date}` — deadline / follow-up nudges. */
export function nudgeKey(insightId: string, localDate: string): string {
  return `nudge:${need(insightId, 'insightId')}:${need(localDate, 'localDate')}`;
}

/** `referral:{referral_id}:{side}` — referral credits and entitlement grants. */
export function referralCreditKey(referralId: string, side: ReferralSide): string {
  return `referral:${need(referralId, 'referralId')}:${side}`;
}

/** `webhook:{source}:{external_id}` */
export function webhookKey(source: string, externalId: string): string {
  return `webhook:${need(source, 'source')}:${need(externalId, 'externalId')}`;
}

/** `first_analysis:{user}` */
export function firstAnalysisKey(userId: string): string {
  return `first_analysis:${need(userId, 'userId')}`;
}

/** `initial_sync:{account}:{connected_at_epoch}` */
export function initialSyncKey(accountId: string, connectedAtEpoch: number): string {
  return `initial_sync:${need(accountId, 'accountId')}:${Math.trunc(connectedAtEpoch)}`;
}

/** `capture_analysis:{capture_id}` */
export function captureAnalysisKey(captureId: string): string {
  return `capture_analysis:${need(captureId, 'captureId')}`;
}

/** `briefing_audio:{briefing_id}:{version}` */
export function briefingAudioKey(briefingId: string, version: number): string {
  return `briefing_audio:${need(briefingId, 'briefingId')}:${positiveInt(version, 'version')}`;
}

/** `export:{request_id}` / `deletion:{request_id}` */
export function exportKey(requestId: string): string {
  return `export:${need(requestId, 'requestId')}`;
}
export function deletionKey(requestId: string): string {
  return `deletion:${need(requestId, 'requestId')}`;
}

// ---------------------------------------------------------------------------------------------
// Dedupe keys (unique per user)
// ---------------------------------------------------------------------------------------------

export type InsightEntityType =
  | 'email_thread'
  | 'email_message'
  | 'calendar_event'
  | 'commitment'
  | 'life_event'
  | 'task'
  | 'capture'
  | 'approval_action'
  | 'contact'
  | 'briefing';

/** `insights.dedupe_key` = `{kind}:{entity_type}:{entity_id}[:{discriminator}]`. */
export function insightDedupeKey(input: {
  kind: InsightKind;
  entityType: InsightEntityType;
  entityId: string;
  discriminator?: string;
}): string {
  const base = `${input.kind}:${input.entityType}:${need(input.entityId, 'entityId')}`;
  return input.discriminator ? `${base}:${input.discriminator}` : base;
}

/**
 * Conflict insight discriminator: the unordered event pair and their start epochs, so the same
 * pair at the same times always maps to one insight ("Böyle kalsın" suppression key).
 */
export function conflictPairKey(
  a: { id: string; startEpoch: number },
  b: { id: string; startEpoch: number },
): string {
  const [x, y] = a.id <= b.id ? [a, b] : [b, a];
  return `${x.id}:${y.id}:${Math.trunc(x.startEpoch)}:${Math.trunc(y.startEpoch)}`;
}

/** Normalised identity field: Turkish-normalised, ASCII-folded, trimmed. */
export function identityPart(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return foldTR(normalizeTR(String(value)));
}

/**
 * `life_events.dedupe_key` = `{type}:` + hex(sha256(normalised identity fields)). Identity fields
 * per type: shipment carrier+tracking_no · flight flight_no+depart_date · reservation venue+at ·
 * payment payee+due_date · subscription service+renews_at · security provider+event+at.
 */
export function lifeEventDedupeKey(
  type: LifeEventType,
  identity: readonly (string | number | null | undefined)[],
): string {
  return `${type}:${sha256Hex(identity.map(identityPart).join(FIELD_SEPARATOR))}`;
}

/**
 * `commitments.dedupe_key` = `{source_type}:{source_id}:` + hex(sha256(lower(unaccent(text)) ‖
 * direction ‖ coalesce(contact_id, counterparty_name))).
 */
export function commitmentDedupeKey(input: {
  sourceType: SourceType;
  sourceId: string;
  text: string;
  direction: CommitmentDirection;
  contactId?: string | null;
  counterpartyName?: string | null;
}): string {
  const who = input.contactId ?? identityPart(input.counterpartyName);
  const digest = sha256Hex([identityPart(input.text), input.direction, who].join(FIELD_SEPARATOR));
  return `${input.sourceType}:${need(input.sourceId, 'sourceId')}:${digest}`;
}

/**
 * `notifications.dedupe_key` = `{category}:{entity_type}:{entity_id}:{local_date}`; briefings use
 * `briefing:{briefing_id}`.
 */
export function notificationDedupeKey(input: {
  category: NotificationCategory;
  entityType: string;
  entityId: string;
  localDate: string;
}): string {
  return `${input.category}:${need(input.entityType, 'entityType')}:${need(input.entityId, 'entityId')}:${need(input.localDate, 'localDate')}`;
}

/** Briefing push dedupe key `briefing:{briefing_id}`. */
export function briefingNotificationDedupeKey(briefingId: string): string {
  return `briefing:${need(briefingId, 'briefingId')}`;
}
