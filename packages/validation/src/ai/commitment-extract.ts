import { z } from 'zod';
import {
  CommitmentClaim,
  Evidence,
  Ref,
  Refiner,
  TEXT_CAPS,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/** §4.3.3 · prompt `commitment` · sent mail and inbound counterparty promises. */
export const CommitmentExtractItem = z.strictObject({
  ref: Ref,
  commitments: z.array(CommitmentClaim),
  expects_reply: z.boolean(),
  expects_reply_evidence: Evidence.nullable(),
  injection_suspected: z.boolean(),
});
export type CommitmentExtractItem = z.infer<typeof CommitmentExtractItem>;
export const CommitmentExtractV1 = z.strictObject({ items: z.array(CommitmentExtractItem) });
export type CommitmentExtractV1 = z.infer<typeof CommitmentExtractV1>;

export interface CommitmentRefineContext extends BaseRefineContext {
  /** Refs of the user's own sent messages or notes (from `direction` metadata). */
  readonly ownRefs: Iterable<string>;
}

export const COMMITMENT_EXTRACT_LIMITS = { commitments_per_email: 4 } as const;

/**
 * Keeps only verified, non-negated claims; `owner='user'` survives only on the user's own text
 * (otherwise it is rewritten to `counterparty`); `expects_reply` is forced off for inbound mail.
 */
export function refineCommitmentClaims(
  r: Refiner,
  claims: readonly CommitmentClaim[],
  max: number,
  ownText: boolean,
  path: string,
): CommitmentClaim[] {
  return r
    .cap(claims, max, path)
    .filter((claim, i) => {
      if (claim.certainty === 'negated') {
        r.drop(`${path}.${i}`, 'negated');
        return false;
      }
      return r.evidence(claim.evidence, `${path}.${i}.evidence`);
    })
    .map((claim, i) => {
      const owner = claim.owner === 'user' && !ownText ? 'counterparty' : claim.owner;
      if (owner !== claim.owner) r.drop(`${path}.${i}.owner`, 'owner_rewritten');
      return {
        ...claim,
        owner,
        what_tr: r.text(claim.what_tr, TEXT_CAPS.what_tr, `${path}.${i}.what_tr`),
      };
    });
}

export function refineCommitmentExtractV1(
  parsed: CommitmentExtractV1,
  ctx: CommitmentRefineContext,
): RefineResult<CommitmentExtractV1> {
  const r = new Refiner(ctx.aliases);
  const own = new Set(ctx.ownRefs);
  const items = parsed.items
    .filter((item, index) => r.ref(item.ref, `items.${index}.ref`))
    .map((item, index) => {
      const path = `items.${index}`;
      const ownText = own.has(item.ref);
      const expects = ownText && item.expects_reply;
      if (item.expects_reply && !ownText) r.drop(`${path}.expects_reply`, 'cleared');
      return {
        ...item,
        commitments: refineCommitmentClaims(
          r,
          item.commitments,
          COMMITMENT_EXTRACT_LIMITS.commitments_per_email,
          ownText,
          `${path}.commitments`,
        ),
        expects_reply: expects,
        expects_reply_evidence: expects
          ? r.optionalEvidence(item.expects_reply_evidence, `${path}.expects_reply_evidence`)
          : null,
      };
    });
  return r.result({ items });
}
