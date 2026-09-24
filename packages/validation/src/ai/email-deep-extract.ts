import { z } from 'zod';
import { refineCommitmentClaims } from './commitment-extract.ts';
import {
  CommitmentClaim,
  Confidence,
  DeadlineClaim,
  Evidence,
  Ref,
  Refiner,
  ScheduleRequestClaim,
  TEXT_CAPS,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/** §4.3.4 · prompt `email_deep_extract` (T2 escalation for survivors that need extraction). */
export const EmailDeepExtractV1 = z.strictObject({
  ref: Ref,
  summary_tr: z.string(),
  key_points: z.array(z.strictObject({ text_tr: z.string(), evidence: Evidence })),
  deadlines: z.array(DeadlineClaim),
  schedule_requests: z.array(ScheduleRequestClaim),
  tasks_for_user: z.array(
    z.strictObject({ what_tr: z.string(), due_quote: z.string().nullable(), evidence: Evidence }),
  ),
  amounts: z.array(
    z.strictObject({ label_tr: z.string(), amount_quote: z.string(), evidence: Evidence }),
  ),
  commitments: z.array(CommitmentClaim),
  people: z.array(
    z.strictObject({ name_quote: z.string(), role_tr: z.string().nullable(), evidence: Evidence }),
  ),
  injection_suspected: z.boolean(),
  confidence: Confidence,
});
export type EmailDeepExtractV1 = z.infer<typeof EmailDeepExtractV1>;

export interface EmailDeepExtractRefineContext extends BaseRefineContext {
  /** `true` when `ref` is the user's own sent message (commitment owner rule). */
  readonly ownText: boolean;
}

export const EMAIL_DEEP_EXTRACT_LIMITS = {
  key_points: 5,
  deadlines: 8,
  schedule_requests: 3,
  tasks_for_user: 5,
  amounts: 5,
  commitments: 5,
  people: 6,
  key_point_chars: 200,
  label_chars: 80,
} as const;

export function refineEmailDeepExtractV1(
  parsed: EmailDeepExtractV1,
  ctx: EmailDeepExtractRefineContext,
): RefineResult<EmailDeepExtractV1> {
  const r = new Refiner(ctx.aliases);
  if (!r.ref(parsed.ref, 'ref')) r.fail('unknown_ref');
  const L = EMAIL_DEEP_EXTRACT_LIMITS;
  const withEvidence = <T extends { evidence: Evidence }>(
    items: readonly T[],
    max: number,
    path: string,
  ): T[] =>
    r.cap(items, max, path).filter((item, i) => r.evidence(item.evidence, `${path}.${i}.evidence`));
  return r.result({
    ...parsed,
    summary_tr: r.text(parsed.summary_tr, TEXT_CAPS.summary_tr, 'summary_tr'),
    key_points: withEvidence(parsed.key_points, L.key_points, 'key_points').map((k, i) => ({
      ...k,
      text_tr: r.text(k.text_tr, L.key_point_chars, `key_points.${i}.text_tr`),
    })),
    deadlines: withEvidence(parsed.deadlines, L.deadlines, 'deadlines').map((d, i) => ({
      ...d,
      what_tr: r.text(d.what_tr, TEXT_CAPS.what_tr, `deadlines.${i}.what_tr`),
    })),
    schedule_requests: withEvidence(
      parsed.schedule_requests,
      L.schedule_requests,
      'schedule_requests',
    ),
    tasks_for_user: withEvidence(parsed.tasks_for_user, L.tasks_for_user, 'tasks_for_user').map(
      (t, i) => ({
        ...t,
        what_tr: r.text(t.what_tr, TEXT_CAPS.what_tr, `tasks_for_user.${i}.what_tr`),
      }),
    ),
    amounts: withEvidence(parsed.amounts, L.amounts, 'amounts').map((a, i) => ({
      ...a,
      label_tr: r.text(a.label_tr, L.label_chars, `amounts.${i}.label_tr`),
    })),
    commitments: refineCommitmentClaims(
      r,
      parsed.commitments,
      L.commitments,
      ctx.ownText,
      'commitments',
    ),
    people: withEvidence(parsed.people, L.people, 'people').map((p, i) => ({
      ...p,
      role_tr: r.nullableText(p.role_tr, L.label_chars, `people.${i}.role_tr`),
    })),
  });
}
