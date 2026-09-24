/**
 * Follow-up state machine application (IMPLEMENTATION_PLAN T-5.03; M§17; AI_PIPELINE_PLAN §3.3 #4):
 * `email_threads.reply_state` (who owes a reply) and `follow_up_state` (Smart Follow-Up lifecycle)
 * are computed by T0 code from the thread's message metadata — `awaiting_their_reply` is never a
 * model label. Both directions emit insights: `reply_needed` (awaiting me) and `follow_up`
 * (awaiting them, once due).
 */
import {
  type ExpectsReply,
  followUpState,
  type FollowUpState,
  threadReplyState,
  type ThreadMessageMeta,
  waitingDays,
} from '@da/domain';
import type { MailMessageRow, MailThreadRow, ThreadPatch } from './intel/types.ts';

export interface ThreadStateInput {
  readonly thread: MailThreadRow;
  readonly messages: readonly MailMessageRow[];
  /** Expects-reply results computed in this run (sent mail with a transient body). */
  readonly expectsReply?: ReadonlyMap<string, ExpectsReply>;
  /** Needs-reply results computed in this run (inbound triage). */
  readonly needsReply?: ReadonlyMap<string, boolean>;
  readonly now: Date;
  readonly timeZone: string;
  readonly followUpAfterDays: number;
  readonly vip: boolean;
  /** Person-level "Bunu takip etme" (learned preference `{follow_up:'mute'}`). */
  readonly muted: boolean;
}

function automated(m: MailMessageRow): boolean {
  return m.list_unsubscribe || m.auto_submitted || m.precedence_bulk;
}

/** Recomputes `reply_state`, `awaiting_since`, `expects_reply_message_id` and `follow_up_state`. */
export function computeThreadState(input: ThreadStateInput): ThreadPatch {
  const meta: ThreadMessageMeta[] = input.messages.map((m) => {
    if (m.direction === 'outbound') {
      const computed = input.expectsReply?.get(m.id);
      const expects: ExpectsReply =
        computed ?? (input.thread.expects_reply_message_id === m.id ? 'yes' : 'no');
      return { direction: 'outbound', at: m.received_at, expectsReply: expects };
    }
    const needs = input.needsReply?.get(m.id) ?? m.classification === 'awaiting_my_reply';
    return { direction: 'inbound', at: m.received_at, needsReply: needs, automated: automated(m) };
  });
  const reply = threadReplyState(meta);
  const expectingId =
    reply.state === 'awaiting_their_reply'
      ? ([...input.messages]
          .filter((m) => m.direction === 'outbound')
          .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))[0]?.id ?? null)
      : null;
  const next: FollowUpState = followUpState({
    replyState: reply.state,
    awaitingSince: reply.since,
    now: input.now,
    timeZone: input.timeZone,
    followUpAfterDays: input.followUpAfterDays,
    vip: input.vip,
    muted: input.muted,
    previous: input.thread.follow_up_state as FollowUpState,
  });
  return {
    reply_state: reply.state,
    awaiting_since: reply.since?.toISOString() ?? null,
    expects_reply_message_id: expectingId ?? input.thread.expects_reply_message_id,
    follow_up_state: next,
  };
}

/** Ages an existing thread state (insight_refresh): `waiting` → `nudge_due` once due. */
export function ageFollowUp(
  thread: MailThreadRow,
  now: Date,
  timeZone: string,
  followUpAfterDays: number,
  vip: boolean,
  muted: boolean,
): { state: FollowUpState; days: number } {
  const state = followUpState({
    replyState: thread.reply_state,
    awaitingSince: thread.awaiting_since,
    now,
    timeZone,
    followUpAfterDays,
    vip,
    muted,
    previous: thread.follow_up_state as FollowUpState,
  });
  const days =
    thread.awaiting_since === null ? 0 : waitingDays(thread.awaiting_since, now, timeZone);
  return { state, days };
}
