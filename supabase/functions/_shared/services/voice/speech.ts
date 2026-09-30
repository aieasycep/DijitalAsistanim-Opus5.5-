/**
 * Speech through the AI router (AI_PIPELINE_PLAN §14; API-AST-03 STT, JOB-30 TTS). Both use the
 * `ai_model_config` routes `(profile, 'stt')` / `(profile, 'tts')`: kill switches, the provider
 * credentials and the breakers decide the chain, the first adapter that implements the operation
 * runs, and every attempt writes one content-free `ai_requests` row plus the budget settlement.
 * Audio and text are never logged or stored here.
 */
import type { AiRuntime } from '../../ai/call.ts';
import { AiError } from '../../ai/errors.ts';
import { costMicros, estimateMicros } from '../../ai/pricing.ts';
import { resolveRoute } from '../../ai/router.ts';
import { recordAttempt } from '../../ai/telemetry.ts';
import {
  emptyUsage,
  type LLMProvider,
  type ModelTarget,
  type NormalizedUsage,
  type RoutingProfile,
} from '../../ai/types.ts';
import type { FlagMap } from '../flags.ts';

export interface SpeechCaller {
  readonly userId: string;
  readonly plan: 'free' | 'pro';
  readonly profile: RoutingProfile;
  readonly flags: FlagMap;
  readonly correlationId: string;
  readonly jobId?: string | null;
  readonly signal?: AbortSignal;
}

export type SpeechUnavailable = {
  readonly kind: 'unavailable';
  /** `not_configured` / `feature_disabled` / `kill_switch` / `no_target` → no usable credential. */
  readonly reason: string;
  readonly retryable: boolean;
};

export type TranscribeOutcome =
  | {
      readonly kind: 'ok';
      readonly text: string;
      readonly confidence: number | null;
      readonly seconds: number;
      readonly provider: string;
    }
  | SpeechUnavailable;

export type SynthesizeOutcome =
  | {
      readonly kind: 'ok';
      readonly bytes: Uint8Array;
      readonly mime: string;
      readonly characters: number;
      readonly aiRequestId: string | null;
    }
  | SpeechUnavailable;

type Op = 'transcribe' | 'synthesize';

async function pick(
  runtime: AiRuntime,
  caller: SpeechCaller,
  feature: 'stt' | 'tts',
  op: Op,
): Promise<
  | { kind: 'ok'; target: ModelTarget; provider: LLMProvider; tier: 't0' | 't1' | 't2' | 't3' }
  | SpeechUnavailable
> {
  const decision = await resolveRoute(runtime.router, {
    feature,
    profile: caller.profile,
    flags: caller.flags,
    role: feature,
  });
  if (decision.kind !== 'route')
    return { kind: 'unavailable', reason: decision.reason, retryable: false };
  for (const target of decision.route.chain) {
    const provider = runtime.provider(target.provider);
    if (provider?.[op] !== undefined) {
      return { kind: 'ok', target, provider, tier: decision.route.tier };
    }
  }
  return { kind: 'unavailable', reason: 'no_target', retryable: false };
}

/** Whether a usable route exists for the feature (premium TTS / server STT availability). */
export async function speechAvailable(
  runtime: AiRuntime,
  caller: Pick<SpeechCaller, 'profile' | 'flags'> & { userId?: string },
  feature: 'stt' | 'tts',
): Promise<boolean> {
  const chosen = await pick(
    runtime,
    { userId: caller.userId ?? '', plan: 'pro', correlationId: '', ...caller },
    feature,
    feature === 'stt' ? 'transcribe' : 'synthesize',
  );
  return chosen.kind === 'ok';
}

async function settle(
  runtime: AiRuntime,
  reservationId: string | null,
  requestId: string | null,
  cost: number,
  usage: NormalizedUsage,
): Promise<void> {
  if (reservationId === null) return;
  await runtime.budget.settle({
    reservationId,
    aiRequestId: requestId,
    actualCostMicros: cost,
    units: 0,
    usage,
  });
}

async function run<R>(
  runtime: AiRuntime,
  caller: SpeechCaller,
  feature: 'stt' | 'tts',
  op: Op,
  estimate: number,
  call: (
    provider: LLMProvider,
    target: ModelTarget,
  ) => Promise<{ result: R; usage: NormalizedUsage }>,
): Promise<
  { kind: 'ok'; result: R; requestId: string | null; provider: string } | SpeechUnavailable
> {
  const chosen = await pick(runtime, caller, feature, op);
  if (chosen.kind !== 'ok') return chosen;
  const { target, provider, tier } = chosen;
  const price = await runtime.prices.price(target.provider, target.model);
  const reservation = await runtime.budget.reserve({
    userId: caller.userId,
    feature,
    estCostMicros: estimateMicros(price, estimate, 0),
    units: 0,
  });
  if (!reservation.allow) {
    return { kind: 'unavailable', reason: reservation.reason ?? 'budget', retryable: false };
  }
  const now = runtime.now ?? Date.now;
  const started = now();
  const base = {
    userId: caller.userId,
    plan: caller.plan,
    profile: caller.profile,
    feature,
    tier,
    provider: target.provider,
    model: target.model,
    operation: op,
    correlationId: caller.correlationId,
    jobId: caller.jobId ?? null,
  } as const;
  try {
    const { result, usage } = await call(provider, target);
    const cost = costMicros(price, usage);
    const requestId = await recordAttempt(runtime.telemetry, {
      ...base,
      status: 'ok',
      usage,
      costUsdMicros: cost,
      latencyMs: now() - started,
    });
    await settle(runtime, reservation.reservationId, requestId, cost, usage);
    return { kind: 'ok', result, requestId, provider: target.provider };
  } catch (error) {
    const code = error instanceof AiError ? error.code : 'NETWORK';
    await recordAttempt(runtime.telemetry, {
      ...base,
      status: 'error',
      errorCode: code,
      latencyMs: now() - started,
    });
    await settle(runtime, reservation.reservationId, null, 0, emptyUsage());
    return {
      kind: 'unavailable',
      reason: code.toLowerCase(),
      retryable: error instanceof AiError ? error.retryable : true,
    };
  }
}

/** Server STT (API-AST-03). The audio stays in memory. */
export async function transcribeAudio(
  runtime: AiRuntime,
  caller: SpeechCaller,
  input: {
    readonly audio: Uint8Array;
    readonly mime: string;
    readonly language: 'tr' | 'en';
    readonly keyterms?: readonly string[];
    readonly expectedSeconds: number;
  },
): Promise<TranscribeOutcome> {
  const out = await run(
    runtime,
    caller,
    'stt',
    'transcribe',
    input.expectedSeconds,
    async (p, t) => {
      const result = await p.transcribe!(
        {
          audio: input.audio,
          mime: input.mime,
          language: input.language,
          ...(input.keyterms === undefined ? {} : { keyterms: input.keyterms }),
          ...(caller.signal === undefined ? {} : { signal: caller.signal }),
        },
        t,
      );
      return { result, usage: { ...emptyUsage(), audioSeconds: result.usage.audioSeconds } };
    },
  );
  if (out.kind !== 'ok') return out;
  return {
    kind: 'ok',
    text: out.result.text,
    confidence: out.result.confidence,
    seconds:
      out.result.usage.audioSeconds > 0 ? out.result.usage.audioSeconds : input.expectedSeconds,
    provider: out.provider,
  };
}

/** Premium TTS (JOB-30). */
export async function synthesizeSpeech(
  runtime: AiRuntime,
  caller: SpeechCaller,
  input: { readonly text: string; readonly language: 'tr-TR' | 'en-US' },
): Promise<SynthesizeOutcome> {
  const out = await run(runtime, caller, 'tts', 'synthesize', input.text.length, async (p, t) => {
    const result = await p.synthesize!(
      {
        text: input.text,
        language: input.language,
        format: 'mp3',
        ...(caller.signal === undefined ? {} : { signal: caller.signal }),
      },
      t,
    );
    return { result, usage: { ...emptyUsage(), characters: result.usage.characters } };
  });
  if (out.kind !== 'ok') return out;
  return {
    kind: 'ok',
    bytes: out.result.bytes,
    mime: out.result.mime,
    characters: out.result.usage.characters,
    aiRequestId: out.requestId,
  };
}
