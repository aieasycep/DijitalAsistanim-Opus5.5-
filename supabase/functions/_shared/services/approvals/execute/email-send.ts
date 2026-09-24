/**
 * `email_send` execution (IMPLEMENTATION_PLAN T-6.02; API_CONTRACTS §6.4; INTEGRATION_PLAN §3.12).
 *
 * The reply goes out through `MailProvider.sendReply` exactly as approved (recipients, subject and
 * body from the approved payload; `From` = the connected mailbox) with the marker
 * `Message-ID: <approval-{id}@mail.dijitalasistan.app>` and the thread's `In-Reply-To` /
 * `References`. Before any retry (a later attempt or a row found `executing`) the adapter's
 * `findSentByMarker` looks for the marker in Sent (Gmail `rfc822msgid:`, Graph extended property);
 * Graph Sent Items can lag, so that probe is repeated 3 × 10 s before re-sending. Found → executed
 * with the existing message, nothing is sent twice.
 */
import type { OutboundReply, WriteOutcome } from '@da/domain';
import { mailSync, openDestination, outcomeResult, toFailure } from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

export const GRAPH_PROBE_ATTEMPTS = 3;
export const GRAPH_PROBE_INTERVAL_MS = 10_000;
/** Graph mail: the first retry waits at least 30 s (Sent Items lag, JOB-17). */
export const GRAPH_FIRST_RETRY_S = 30;

export async function executeEmailSend(env: ExecEnv): Promise<ExecOutcome> {
  const payload = env.approval.payload;
  if (payload.action_type !== 'email_send') throw new ExecutionFailure('PROVIDER_REJECTED', false);
  const { session, account } = await openDestination(
    env,
    payload.connected_account_id,
    'mail_send',
  );
  const mail = session.adapters.mail;
  if (mail === undefined)
    throw new ExecutionFailure('FEATURE_DISABLED', false, null, 'mail_adapter');
  const thread = await env.repo.mailContext(
    env.approval.user_id,
    payload.thread.email_thread_id,
    payload.thread.reply_to_message_id,
  );
  if (thread === null) throw new ExecutionFailure('SOURCE_GONE', false, null, 'thread_gone');
  const fromAddress = account.email;
  if (fromAddress === null)
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'no_mailbox');
  const reply: OutboundReply = {
    inReplyToProviderMessageId: thread.providerMessageId,
    providerThreadId: thread.providerThreadId,
    originalRfc822MessageId: thread.internetMessageId,
    originalReferences: [...thread.references],
    from: { address: fromAddress, name: await env.repo.displayName(env.approval.user_id) },
    to: payload.to.map((r) => ({ address: r.email, name: r.name ?? null })),
    cc: payload.cc.map((r) => ({ address: r.email, name: r.name ?? null })),
    subject: payload.subject,
    bodyText: payload.body_text,
    marker: env.marker,
  };

  let outcome: WriteOutcome | null = null;
  try {
    if (env.probeFirst) {
      const sentAfter = new Date(
        Date.parse(env.approval.approved_at ?? env.approval.created_at) - 60_000,
      ).toISOString();
      const probes = account.provider === 'microsoft' ? GRAPH_PROBE_ATTEMPTS : 1;
      for (let i = 0; i < probes && outcome === null; i++) {
        if (i > 0) await env.sleep(GRAPH_PROBE_INTERVAL_MS);
        outcome = await mail.findSentByMarker(session.ctx, env.marker, reply, sentAfter);
      }
    }
    if (outcome === null) outcome = await mail.sendReply(session.ctx, reply);
  } catch (error) {
    const failure = toFailure(error);
    if (account.provider === 'microsoft' && failure.retryable) {
      throw new ExecutionFailure(
        failure.code,
        true,
        Math.max(failure.retryAfterSeconds ?? 0, GRAPH_FIRST_RETRY_S),
        failure.message,
      );
    }
    throw failure;
  }

  const followUps =
    account.provider === 'google' || account.provider === 'microsoft' ? [mailSync(account)] : [];
  return {
    providerRef: env.marker.rfc822MessageId,
    result: outcomeResult(outcome, { target: 'provider', provider: account.provider }),
    followUps,
  };
}
