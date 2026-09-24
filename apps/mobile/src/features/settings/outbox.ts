/**
 * Offline outbox for `POST /feedback` (API §2.16 classes it queueable): a submit made offline goes
 * to the app's offline mutation queue (T-8.23, kind `feedback`) with its Idempotency-Key and is
 * replayed in order when the connection returns, so a replay can never create a duplicate. The
 * screen shows the queued state, never a success; after a successful replay the toast
 * "Geri bildirimin gönderildi." appears (the queue handler also records `feedback_submitted`).
 */
import {
  flushMutationQueue,
  queueMutation,
  queuedMutations,
  resetMutationQueueForTests,
  type FeedbackBody,
} from '../../lib/offline/mutations';

export type { FeedbackBody } from '../../lib/offline/mutations';

export function queueFeedback(body: FeedbackBody, idempotencyKey: string): void {
  queueMutation('feedback', { body }, { idempotencyKey });
}

export function queuedFeedbackCount(): number {
  return queuedMutations().filter((entry) => entry.kind === 'feedback').length;
}

/** Replays the queue (feedback included) in order. */
export function flushFeedbackOutbox(): Promise<void> {
  return flushMutationQueue();
}

export function resetFeedbackOutboxForTests(): void {
  resetMutationQueueForTests();
}
