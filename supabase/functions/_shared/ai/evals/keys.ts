/**
 * The prompt keys that have an eval suite (`suites.ts`), as data only, so `admin-api` can refuse an
 * eval request for a key without a golden set without loading the suites and their services.
 * `suites.test.ts` keeps this list equal to `EVAL_SUITES`.
 */
import type { PromptKey } from '@da/validation';

export const EVAL_SUITE_KEYS: readonly PromptKey[] = [
  'email_classification',
  'post_meeting',
  'meeting_prep',
  'assistant_intent',
  'reply_draft',
  'capture',
];

export function hasEvalSuite(key: string): boolean {
  return (EVAL_SUITE_KEYS as readonly string[]).includes(key);
}
