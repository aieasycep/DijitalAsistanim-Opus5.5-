import { z } from 'zod';
import {
  Confidence,
  DeadlineClaim,
  Evidence,
  ReasonCode,
  Ref,
  Refiner,
  ScheduleRequestClaim,
  TEXT_CAPS,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/** §4.3.1 · prompt `email_classification` · inbound mail only, up to 5 emails per request. */
export const EmailTriageItem = z.strictObject({
  ref: Ref,
  category: z.enum([
    'important',
    'awaiting_my_reply',
    'has_deadline',
    'informational',
    'low_priority',
  ]),
  important: z.boolean(),
  urgency: z.enum(['urgent', 'today', 'normal', 'low']),
  needs_reply: z.boolean(),
  reply_ask_tr: z.string().nullable(),
  reply_evidence: Evidence.nullable(),
  reason_code: ReasonCode,
  reason_tr: z.string(),
  summary_tr: z.string().nullable(),
  key_points_tr: z.array(z.string()),
  deadlines: z.array(DeadlineClaim),
  life_signal: z.enum(['none', 'shipment', 'flight', 'reservation', 'payment', 'subscription']),
  life_evidence: Evidence.nullable(),
  schedule_request: ScheduleRequestClaim.nullable(),
  counterparty_commitment: Evidence.nullable(),
  needs_deep_extract: z.boolean(),
  thread_note_tr: z.string().nullable(),
  injection_suspected: z.boolean(),
  confidence: Confidence,
});
export type EmailTriageItem = z.infer<typeof EmailTriageItem>;
export const EmailTriageV1 = z.strictObject({ items: z.array(EmailTriageItem) });
export type EmailTriageV1 = z.infer<typeof EmailTriageV1>;

export interface EmailTriageRefineContext extends BaseRefineContext {
  /** Number of emails in the request; the output must hold exactly one item per email. */
  readonly inputCount: number;
}

export const EMAIL_TRIAGE_LIMITS = {
  max_emails: 5,
  key_points: 3,
  key_point_chars: 80,
  deadlines: 5,
  reply_ask_chars: 140,
  thread_note_chars: 300,
} as const;

/** Applies the §4.3.1 refinements: counts, unique refs, caps, token hygiene, evidence nulling. */
export function refineEmailTriageV1(
  parsed: EmailTriageV1,
  ctx: EmailTriageRefineContext,
): RefineResult<EmailTriageV1> {
  const r = new Refiner(ctx.aliases);
  if (parsed.items.length !== ctx.inputCount) r.fail('item_count_mismatch');
  const seen = new Set<string>();
  const items: EmailTriageItem[] = [];
  parsed.items.forEach((item, index) => {
    const path = `items.${index}`;
    if (seen.has(item.ref)) {
      r.drop(`${path}.ref`, 'duplicate_ref');
      r.fail('duplicate_ref');
      return;
    }
    seen.add(item.ref);
    if (!r.ref(item.ref, `${path}.ref`)) {
      r.fail('unknown_ref');
      return;
    }
    const hygiene =
      (item.category === 'informational' || item.category === 'low_priority') &&
      !item.important &&
      !item.needs_reply;
    let summary = r.nullableText(item.summary_tr, TEXT_CAPS.summary_tr, `${path}.summary_tr`);
    let keyPoints = r
      .cap(item.key_points_tr, EMAIL_TRIAGE_LIMITS.key_points, `${path}.key_points_tr`)
      .map((p, i) => r.text(p, EMAIL_TRIAGE_LIMITS.key_point_chars, `${path}.key_points_tr.${i}`))
      .filter((p) => p !== '');
    if (hygiene && (summary !== null || keyPoints.length > 0)) {
      r.drop(`${path}.summary_tr`, 'cleared');
      summary = null;
      keyPoints = [];
    }
    const deadlines = r
      .cap(item.deadlines, EMAIL_TRIAGE_LIMITS.deadlines, `${path}.deadlines`)
      .filter((d, i) => r.evidence(d.evidence, `${path}.deadlines.${i}.evidence`))
      .map((d, i) => ({
        ...d,
        what_tr: r.text(d.what_tr, TEXT_CAPS.what_tr, `${path}.deadlines.${i}.what_tr`),
      }));
    let lifeEvidence = r.optionalEvidence(item.life_evidence, `${path}.life_evidence`);
    if (item.life_signal === 'none' && lifeEvidence !== null) {
      r.drop(`${path}.life_evidence`, 'cleared');
      lifeEvidence = null;
    }
    const schedule =
      item.schedule_request !== null &&
      r.evidence(item.schedule_request.evidence, `${path}.schedule_request.evidence`)
        ? item.schedule_request
        : null;
    const replyEvidence = r.optionalEvidence(item.reply_evidence, `${path}.reply_evidence`);
    items.push({
      ...item,
      reply_ask_tr: r.nullableText(
        item.reply_ask_tr,
        EMAIL_TRIAGE_LIMITS.reply_ask_chars,
        `${path}.reply_ask_tr`,
      ),
      reply_evidence: replyEvidence,
      reason_tr: r.text(item.reason_tr, TEXT_CAPS.reason_tr, `${path}.reason_tr`),
      summary_tr: summary,
      key_points_tr: keyPoints,
      deadlines,
      life_evidence: lifeEvidence,
      schedule_request: schedule,
      counterparty_commitment: r.optionalEvidence(
        item.counterparty_commitment,
        `${path}.counterparty_commitment`,
      ),
      thread_note_tr: r.nullableText(
        item.thread_note_tr,
        EMAIL_TRIAGE_LIMITS.thread_note_chars,
        `${path}.thread_note_tr`,
      ),
    });
  });
  return r.result({ items });
}
