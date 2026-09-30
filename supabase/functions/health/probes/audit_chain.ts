/**
 * `audit_chain` probe (BACKOFFICE_PLAN §11, SECURITY_AND_PRIVACY_PLAN CTL-3.8): re-verifies the hash
 * chain of the latest audit rows through `private.audit_verify_chain`. A broken chain is `down`.
 * Like `email_delivery`, its component awaits the DB check extension (BACKOFFICE_PLAN §16 #21).
 */
import { type Probe, timed } from './types.ts';

export const AUDIT_CHAIN_WINDOW = 1000;

export const auditChainProbe: Probe = async (ctx) => {
  const result = await timed(ctx, () => ctx.data.auditChain(AUDIT_CHAIN_WINDOW));
  if (!result.ok)
    return {
      component: 'audit_chain',
      status: 'unknown',
      latencyMs: result.latencyMs,
      detailCode: 'verify_failed',
    };
  const { ok, checked, firstBadSeq } = result.value;
  return {
    component: 'audit_chain',
    status: ok ? 'healthy' : 'down',
    latencyMs: result.latencyMs,
    detailCode: ok ? null : 'chain_broken',
    detail: { checked, first_bad_seq: firstBadSeq },
  };
};
