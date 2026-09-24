/**
 * The model-written answer of API-SRCH-01 `mode=answer` (IMPLEMENTATION_PLAN T-5.11; AI_PIPELINE_PLAN
 * §11.4). The top retrieved rows go to the `(profile, 'assistant_qa')` route as `search_result`
 * blocks with prompt `assistant`; only sentences that pass the claim check are kept. Without a
 * grounded sentence the answer is "Bunu kayıtlarında bulamadım." with `confidence_label='unsure'`.
 * A route that cannot run maps onto the interactive errors (AI_UNAVAILABLE, FEATURE_DISABLED,
 * EXTERNAL_CREDENTIAL_REQUIRED, QUOTA_EXCEEDED for the daily AI budget).
 */
import type { AiRuntime } from '../../ai/call.ts';
import { AiError } from '../../ai/errors.ts';
import { AppError } from '../../errors.ts';
import type { AiUser } from '../ai/runtime.ts';
import { interactiveAiError } from '../assist/common.ts';
import { copy } from '../copy.ts';
import type { SearchAnswerView, SearchResultView } from '../memory/search.ts';
import { answerText, planQa } from './answer.ts';
import { retrievalDocs } from './tools.ts';

const MAX_TEXT = 1200;
const MAX_SPANS = 20;

export async function searchAnswer(
  runtime: AiRuntime,
  user: AiUser,
  input: {
    readonly question: string;
    readonly results: readonly SearchResultView[];
    readonly correlationId: string;
    readonly canary?: string;
  },
): Promise<{ answer: SearchAnswerView; sources: SearchResultView[] }> {
  const notFound = {
    answer: {
      text: copy(user.locale, 'search.generated.notFound'),
      emphasis_spans: [],
      confidence_label: 'unsure' as const,
      source_count: 0,
    },
    sources: [],
  };
  const plan = await planQa(runtime, user, input.canary);
  if (plan.kind !== 'ok') throw interactiveAiError(plan.reason);
  const { docs } = retrievalDocs(input.results);
  const used = input.results
    .filter((r) => r.title !== '' || r.snippet !== '')
    .slice(0, docs.length);
  if (docs.length === 0) return notFound;
  let qa;
  try {
    qa = await answerText(runtime, plan, {
      user,
      question: input.question,
      history: [],
      results: docs,
      correlationId: input.correlationId,
    });
  } catch (error) {
    if (error instanceof AiError)
      throw new AppError('AI_UNAVAILABLE', { details: { reason: error.code } });
    throw error;
  }
  if (!qa.grounded || qa.text === '') return notFound;
  const text = qa.text.slice(0, MAX_TEXT);
  const sources = qa.cited
    .map((i) => used[i])
    .filter((r): r is SearchResultView => r !== undefined);
  const spans: { start: number; end: number }[] = [];
  for (const source of sources) {
    const title = source.title.trim();
    if (title.length < 3) continue;
    const start = text.indexOf(title);
    if (start >= 0 && !spans.some((s) => s.start === start))
      spans.push({ start, end: start + title.length });
  }
  const verified = qa.blocks.every((b) => b.verified);
  return {
    answer: {
      text,
      emphasis_spans: spans.sort((a, b) => a.start - b.start).slice(0, MAX_SPANS),
      confidence_label:
        verified && (qa.coverage === null || qa.coverage >= 0.75) ? 'high' : 'partial',
      source_count: sources.length,
    },
    sources: sources.slice(0, 12),
  };
}
