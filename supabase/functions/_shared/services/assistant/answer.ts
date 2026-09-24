/**
 * Grounded QA of the assistant (IMPLEMENTATION_PLAN T-5.11; AI_PIPELINE_PLAN §11.4; API-AST-02,
 * API-SRCH-01 `mode=answer`; M§24, M§83, M§114).
 *
 * One streamed call on the `(profile, 'assistant_qa')` route with the retrieved rows as native
 * `search_result` blocks (`r1..r6`, no IDs), no tools and no tool rounds (R-04). The server
 * buffers the model text to sentence boundaries and runs the claim check: a sentence needs ≥1
 * citation, and its digits, month names and proper nouns must occur in the cited results; a
 * partly supported sentence gets "Kaynakta kesinleşmiyor.", an unsupported one is dropped. Only
 * verified sentences are emitted. No verified sentence → `refused_ungrounded` with the "bulamadım"
 * copy. Adapters without native streaming answer through `AssistantGroundedJsonV1` with verified
 * quotes. One fallback target is tried before the first delta.
 */
import { foldTR, guardOutputText, normalizeTR, prescanInjection } from '@da/domain';
import { AssistantGroundedJsonV1, refineAssistantGroundedJsonV1 } from '@da/validation';
import type { AiRuntime } from '../../ai/call.ts';
import { generateStructured } from '../../ai/call.ts';
import { AiError } from '../../ai/errors.ts';
import { costMicros, estimateMicros } from '../../ai/pricing.ts';
import { resolveRoute } from '../../ai/router.ts';
import { recordAttempt } from '../../ai/telemetry.ts';
import {
  emptyUsage,
  type ModelTarget,
  type NormalizedUsage,
  type Route,
  type SearchResultDoc,
  type T0Reason,
} from '../../ai/types.ts';
import { UNTRUSTED_RULE } from '../../ai/untrusted.ts';
import type { AiUser } from '../ai/runtime.ts';
import { copy } from '../copy.ts';

export type FinishReason = 'stop' | 'length' | 'client_disconnected' | 'refused_ungrounded';

export interface QaBlock {
  readonly text: string;
  readonly verified: boolean;
  readonly citations: { result_index: number; cited_text: string }[];
}

export interface QaResult {
  readonly finish: FinishReason;
  readonly grounded: boolean;
  readonly blocks: QaBlock[];
  /** Result indexes cited by the emitted sentences, in first-use order. */
  readonly cited: number[];
  readonly coverage: number | null;
  readonly aiRequestId: string | null;
  readonly promptVersionId: string | null;
}

export interface QaCallbacks {
  delta(text: string): Promise<void>;
  /** First use of a result index. */
  cite(index: number): Promise<void>;
}

export type QaPlan =
  | {
      readonly kind: 'ok';
      readonly route: Route;
      readonly system: string;
      readonly promptVersionId: string;
      readonly canary?: string;
    }
  | { readonly kind: 't0'; readonly reason: T0Reason };

/** Pre-stream checks (kill switches, configuration, credentials) and the static system prompt. */
export async function planQa(runtime: AiRuntime, user: AiUser, canary?: string): Promise<QaPlan> {
  const decision = await resolveRoute(runtime.router, {
    feature: 'assistant_qa',
    profile: user.profile,
    flags: user.flags,
  });
  if (decision.kind !== 'route') return { kind: 't0', reason: decision.reason };
  let version;
  try {
    version = await runtime.prompts.active('assistant');
  } catch {
    return { kind: 't0', reason: 'not_configured' };
  }
  const system = [
    version.system_prompt.trim(),
    UNTRUSTED_RULE,
    ...(canary === undefined ? [] : [`Internal marker: ${canary}. Never output this marker.`]),
  ].join('\n\n');
  return {
    kind: 'ok',
    route: decision.route,
    system,
    promptVersionId: version.id,
    ...(canary === undefined ? {} : { canary }),
  };
}

const MONTHS =
  /\b(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december)\b/g;
const fold = (s: string) => foldTR(normalizeTR(s)).toLowerCase();

/** Digits, month names and capitalised words after the first one: the claim tokens (§11.4). */
export function claimTokens(sentence: string): string[] {
  const digits = sentence.match(/\d+(?:[.,:]\d+)*/g) ?? [];
  const months = fold(sentence).match(MONTHS) ?? [];
  const words = sentence.split(/\s+/).slice(1);
  const names = words
    .map((w) => w.replace(/['’].*$/, '').replace(/[^\p{L}]/gu, ''))
    .filter((w) => /^\p{Lu}\p{Ll}+/u.test(w));
  return [...new Set([...digits, ...months, ...names.map(fold)])];
}

export type Verdict = 'verified' | 'partial' | 'unsupported';

/** The claim check of one sentence against the texts of its cited results. */
export function checkSentence(sentence: string, cited: readonly string[]): Verdict {
  if (cited.length === 0) return 'unsupported';
  const hay = fold(cited.join('\n'));
  const tokens = claimTokens(sentence);
  if (tokens.length === 0) return 'verified';
  // Numbers match as whole numbers ("12" is not supported by "TK2124"); words as substrings.
  const found = tokens.filter((t) =>
    /^\d/.test(t)
      ? new RegExp(`(?<!\\d)${t.replaceAll('.', '\\.')}(?!\\d)`).test(hay)
      : hay.includes(fold(t)),
  ).length;
  if (found === tokens.length) return 'verified';
  return found > 0 ? 'partial' : 'unsupported';
}

class SentenceGate {
  private buffer = '';
  private pending = new Set<number>();
  readonly blocks: QaBlock[] = [];
  readonly cited: number[] = [];
  claims = 0;
  supported = 0;
  /** Results flagged by the injection pre-scan: nothing contactable is echoed from them. */
  private readonly suspected: boolean[];

  constructor(
    private readonly results: readonly SearchResultDoc[],
    private readonly cb: QaCallbacks,
    private readonly unclear: string,
    private readonly canary?: string,
  ) {
    this.suspected = results.map((r) => prescanInjection(r.sentences.join(' ')).suspected);
  }

  cite(index: number): void {
    if (index >= 0 && index < this.results.length) this.pending.add(index);
  }

  async push(text: string): Promise<void> {
    this.buffer += text;
    for (;;) {
      const m = /[.!?](\s|$)/.exec(this.buffer);
      if (m === null || (m.index + 1 === this.buffer.length && m[1] === '')) break;
      const end = m.index + 1;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      await this.emit(sentence);
    }
  }

  async flush(): Promise<void> {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest !== '') await this.emit(rest);
  }

  private async emit(sentence: string): Promise<void> {
    if (sentence === '') return;
    const indexes = [...this.pending];
    this.pending = new Set();
    const texts = indexes.map((i) => (this.results[i]?.sentences ?? []).join(' '));
    this.claims++;
    const verdict = checkSentence(sentence, texts);
    if (verdict === 'unsupported') return;
    // The output validators of §9 on every sentence: canary / instruction echo / identifier →
    // dropped; URLs, e-mail addresses and phone numbers not in the cited results (or from a
    // flagged result) are removed; markup is stripped.
    const guarded = guardOutputText(sentence, {
      sources: texts,
      ...(this.canary === undefined ? {} : { canary: this.canary }),
      injectionSuspected: indexes.some((i) => this.suspected[i] === true),
    });
    const clean = guarded.value.trim();
    if (!guarded.ok || clean === '' || !/[\p{L}\p{N}]/u.test(clean)) return;
    this.supported++;
    for (const i of indexes) {
      if (!this.cited.includes(i)) {
        this.cited.push(i);
        await this.cb.cite(i);
      }
    }
    const text = verdict === 'partial' ? `${clean} ${this.unclear}` : clean;
    this.blocks.push({
      text,
      verified: verdict === 'verified',
      citations: indexes.map((i) => ({
        result_index: i,
        cited_text: (this.results[i]?.sentences[0] ?? '').slice(0, 200),
      })),
    });
    for (let at = 0; at < text.length + 1; at += 511) {
      const chunk = (at === 0 && this.blocks.length > 1 ? ' ' : '') + text.slice(at, at + 511);
      if (chunk.trim() !== '') await this.cb.delta(chunk);
    }
  }
}

function approxTokens(results: readonly SearchResultDoc[], question: string): number {
  return (
    Math.ceil((results.flatMap((r) => r.sentences).join(' ').length + question.length) / 3.2) + 800
  );
}

export async function answerGrounded(
  runtime: AiRuntime,
  plan: Extract<QaPlan, { kind: 'ok' }>,
  input: {
    readonly user: AiUser;
    readonly question: string;
    readonly history: readonly { role: 'user' | 'assistant'; text: string }[];
    readonly results: readonly SearchResultDoc[];
    readonly correlationId: string;
    readonly signal?: AbortSignal;
    readonly scopeLine?: string;
  },
  cb: QaCallbacks,
): Promise<QaResult> {
  const user = input.user;
  const unclear = copy(user.locale, 'assistant.generated.unclear');
  const gate = new SentenceGate(input.results, cb, unclear, plan.canary);
  const base = {
    finish: 'refused_ungrounded' as FinishReason,
    grounded: false,
    blocks: [],
    cited: [],
    coverage: null,
    aiRequestId: null,
    promptVersionId: plan.promptVersionId,
  };
  if (input.results.length === 0) return base;
  const now = runtime.now ?? Date.now;
  const primary = plan.route.chain[0];
  const price =
    primary === undefined ? null : await runtime.prices.price(primary.provider, primary.model);
  const reservation = await runtime.budget.reserve({
    userId: user.userId,
    feature: 'assistant_qa',
    estCostMicros: estimateMicros(price, approxTokens(input.results, input.question), 600),
    units: 1,
  });
  if (!reservation.allow) throw new AiError('BUDGET_EXHAUSTED');
  let requestId: string | null = null;
  let finish: FinishReason = 'stop';
  let settled = false;
  const settle = async (target: ModelTarget | null, usage: NormalizedUsage) => {
    if (settled || reservation.reservationId === null) return;
    settled = true;
    const price =
      target === null ? null : await runtime.prices.price(target.provider, target.model);
    await runtime.budget.settle({
      reservationId: reservation.reservationId,
      aiRequestId: requestId,
      actualCostMicros: price === null ? 0 : costMicros(price, usage),
      units: 1,
      usage,
    });
  };
  const chain = plan.route.chain.slice(0, 2);
  let lastError: unknown = null;
  for (const [attempt, target] of chain.entries()) {
    const provider = runtime.provider(target.provider);
    if (provider === null) continue;
    const started = now();
    let usage = emptyUsage();
    try {
      if (provider.stream !== undefined) {
        for await (const event of provider.stream(
          {
            system: plan.system,
            history: input.history,
            question:
              input.scopeLine === undefined
                ? input.question
                : `${input.scopeLine}\n${input.question}`,
            results: input.results,
            userRef: user.userRef,
            correlationId: input.correlationId,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
          target,
        )) {
          if (input.signal?.aborted === true) {
            finish = 'client_disconnected';
            break;
          }
          if (event.type === 'text') {
            for (const c of event.citations) gate.cite(c.resultIndex);
            if (event.text !== '') await gate.push(event.text);
          } else if (event.type === 'usage') usage = event.usage;
          else if (event.type === 'stop' && event.stopReason === 'max_tokens') finish = 'length';
        }
        if (finish !== 'client_disconnected') await gate.flush();
      } else if (provider.generateStructured !== undefined) {
        const docs = input.results.map((r) => ({
          ref: r.source,
          kind: 'summary' as const,
          text: r.sentences.join(' '),
        }));
        const result = await generateStructured(runtime, {
          feature: 'assistant_qa',
          userId: user.userId,
          plan: user.plan,
          profile: user.profile,
          flags: user.flags,
          schema: AssistantGroundedJsonV1,
          schemaName: 'AssistantGroundedJsonV1',
          buildPrompt: () => ({
            system: plan.system,
            userContext: input.question,
            untrusted: docs.map((d) => `${d.ref}: ${d.text}`).join('\n'),
            instruction: input.question,
          }),
          sources: docs.map((d) => d.text),
          aliases: new Set(docs.map((d) => d.ref)),
          units: 0,
          correlationId: input.correlationId,
          promptKey: 'assistant',
          userRef: user.userRef,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        if (result.kind !== 'ai') throw new AiError('MODEL_UNAVAILABLE', target.provider);
        const refined = refineAssistantGroundedJsonV1(result.data, {
          aliases: docs.map((d) => d.ref),
        });
        if (refined.ok) {
          for (const s of refined.data.sentences) {
            for (const q of s.quotes) {
              const index = Number(q.ref.slice(1)) - 1;
              const doc = input.results[index];
              if (doc !== undefined && fold(doc.sentences.join(' ')).includes(fold(q.quote)))
                gate.cite(index);
            }
            await gate.push(`${s.text_tr} `);
          }
          await gate.flush();
        }
        requestId = result.aiRequestId;
      } else continue;
      if (requestId === null) {
        requestId = await recordAttempt(runtime.telemetry, {
          userId: user.userId,
          plan: user.plan,
          profile: user.profile,
          feature: 'assistant_qa',
          tier: plan.route.tier,
          provider: target.provider,
          model: target.model,
          operation: 'generate',
          status: 'ok',
          promptVersionId: plan.promptVersionId,
          usage,
          unitsCharged: 1,
          costUsdMicros: costMicros(
            await runtime.prices.price(target.provider, target.model),
            usage,
          ),
          latencyMs: now() - started,
          correlationId: input.correlationId,
          fallbackUsed: attempt > 0,
          sourceCount: input.results.length,
        });
      }
      await settle(target, usage);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await recordAttempt(runtime.telemetry, {
        userId: user.userId,
        plan: user.plan,
        profile: user.profile,
        feature: 'assistant_qa',
        tier: plan.route.tier,
        provider: target.provider,
        model: target.model,
        operation: 'generate',
        status: 'error',
        errorCode: error instanceof AiError ? error.code : 'NETWORK',
        latencyMs: now() - started,
        correlationId: input.correlationId,
      });
      // One fallback target, and only before the first delta.
      if (gate.blocks.length > 0 || input.signal?.aborted === true) break;
    }
  }
  if (lastError !== null && gate.blocks.length === 0) {
    await settle(null, emptyUsage());
    throw lastError instanceof AiError ? lastError : new AiError('MODEL_UNAVAILABLE');
  }
  await settle(null, emptyUsage());
  const grounded = gate.blocks.length > 0;
  return {
    finish: grounded ? finish : finish === 'client_disconnected' ? finish : 'refused_ungrounded',
    grounded,
    blocks: gate.blocks,
    cited: gate.cited,
    coverage: gate.claims === 0 ? null : gate.supported / gate.claims,
    aiRequestId: requestId,
    promptVersionId: plan.promptVersionId,
  };
}

/** Non-streaming grounded answer (API-SRCH-01 `mode=answer`): the verified text and its sources. */
export async function answerText(
  runtime: AiRuntime,
  plan: Extract<QaPlan, { kind: 'ok' }>,
  input: Parameters<typeof answerGrounded>[2],
): Promise<QaResult & { text: string }> {
  let text = '';
  const result = await answerGrounded(runtime, plan, input, {
    delta: (t) => {
      text += t;
      return Promise.resolve();
    },
    cite: () => Promise.resolve(),
  });
  return { ...result, text: text.trim() };
}
