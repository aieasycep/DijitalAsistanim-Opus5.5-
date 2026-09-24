/**
 * Fixture AI provider (AI_PIPELINE_PLAN §15.5, IMPLEMENTATION_PLAN T-3.09): deterministic outputs for
 * tests, CI and the demo stack, at cost 0 (`ai_requests.provider='fixture'`).
 *
 * - Structured calls: `_shared/ai/fixtures/<Schema>.json` holds outputs keyed by the SHA-256 of the
 *   prompt input (`by_input`) plus a schema-valid `default`; every output is parsed with the
 *   requested schema, so a fixture can never bypass validation.
 * - Streaming answers cite the first sentence of the first search result.
 * - Embeddings: a deterministic, L2-normalised feature-hashing vector of the folded tokens.
 * - STT / TTS: a fixture transcript and silent MPEG audio.
 *
 * Enabled only with `AI_FIXTURE_PROVIDER_ENABLED=true` outside production, or while demo mode is
 * allowed (`DEMO_MODE`, with `ALLOW_DEMO_IN_PRODUCTION` in production).
 */
import { foldTR, normalizeTR } from '@da/domain';
import type { RawEnv } from '../../env.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import { isDemoEnabled } from '../../providers/demo/guard.ts';
import { AiError } from '../errors.ts';
import type {
  EmbedParams,
  EmbedResult,
  GenerateStructuredParams,
  GenerateStructuredResult,
  LLMProvider,
  ModelTarget,
  StreamEvent,
  StreamParams,
  SynthesizeParams,
  SynthesizeResult,
  TranscribeParams,
  TranscribeResult,
} from '../types.ts';
import { emptyUsage } from '../types.ts';
import AssistantGroundedJsonV1 from '../fixtures/AssistantGroundedJsonV1.json' with { type: 'json' };
import AssistantIntentV1 from '../fixtures/AssistantIntentV1.json' with { type: 'json' };
import BriefingMorningV1 from '../fixtures/BriefingMorningV1.json' with { type: 'json' };
import BriefingPolishV1 from '../fixtures/BriefingPolishV1.json' with { type: 'json' };
import CaptureExtractV1 from '../fixtures/CaptureExtractV1.json' with { type: 'json' };
import CommitmentExtractV1 from '../fixtures/CommitmentExtractV1.json' with { type: 'json' };
import EmailDeepExtractV1 from '../fixtures/EmailDeepExtractV1.json' with { type: 'json' };
import EmailTriageV1 from '../fixtures/EmailTriageV1.json' with { type: 'json' };
import FollowUpDraftV1 from '../fixtures/FollowUpDraftV1.json' with { type: 'json' };
import LifeIntelV1 from '../fixtures/LifeIntelV1.json' with { type: 'json' };
import MeetingPrepV1 from '../fixtures/MeetingPrepV1.json' with { type: 'json' };
import PostMeetingCommitmentV1 from '../fixtures/PostMeetingCommitmentV1.json' with { type: 'json' };
import ReplyDraftsV1 from '../fixtures/ReplyDraftsV1.json' with { type: 'json' };
import ThreadSummaryV1 from '../fixtures/ThreadSummaryV1.json' with { type: 'json' };
import WeeklyReviewV1 from '../fixtures/WeeklyReviewV1.json' with { type: 'json' };
import audioFixtures from '../fixtures/audio.json' with { type: 'json' };

interface FixtureFile {
  readonly schema: string;
  readonly default: unknown;
  readonly by_input: Readonly<Record<string, unknown>>;
}

export const STRUCTURED_FIXTURES: Readonly<Record<string, FixtureFile>> = {
  AssistantGroundedJsonV1,
  AssistantIntentV1,
  BriefingMorningV1,
  BriefingPolishV1,
  CaptureExtractV1,
  CommitmentExtractV1,
  EmailDeepExtractV1,
  EmailTriageV1,
  FollowUpDraftV1,
  LifeIntelV1,
  MeetingPrepV1,
  PostMeetingCommitmentV1,
  ReplyDraftsV1,
  ThreadSummaryV1,
  WeeklyReviewV1,
};

function flag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** T-3.09 gate: tests/CI outside production, or an allowed demo stack. */
export function fixtureProviderEnabled(raw: RawEnv): boolean {
  if (isDemoEnabled(raw)) return true;
  return flag(raw.AI_FIXTURE_PROVIDER_ENABLED) && raw.APP_ENV?.trim() !== 'production';
}

/** The fixture lookup key: SHA-256 of the prompt's user-turn input. */
export function fixtureInputKey(params: GenerateStructuredParams<unknown>): Promise<string> {
  return sha256Hex(
    [
      params.prompt.userContext ?? '',
      params.prompt.untrusted ?? '',
      params.prompt.instruction ?? '',
    ].join('\n'),
  );
}

/** Feature-hashing embedding: FNV-1a of each folded token → bucket; L2-normalised. */
export function fixtureVector(text: string, dims: number): number[] {
  const vector = new Array<number>(dims).fill(0);
  const tokens = foldTR(normalizeTR(text))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  for (const token of tokens) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const index = hash % dims;
    vector[index] = (vector[index] ?? 0) + (hash >>> 31 === 1 ? -1 : 1);
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/** Silent MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz), ~0.13 s. */
function silentMp3(frames = 5): Uint8Array {
  const frameLength = 417;
  const out = new Uint8Array(frameLength * frames);
  for (let f = 0; f < frames; f++) out.set([0xff, 0xfb, 0x90, 0x64], f * frameLength);
  return out;
}

export function createFixtureProvider(options: { now?: () => number } = {}): LLMProvider {
  const now = options.now ?? Date.now;
  return {
    id: 'fixture',
    async generateStructured<T>(
      params: GenerateStructuredParams<T>,
      _target: ModelTarget,
    ): Promise<GenerateStructuredResult<T>> {
      const started = now();
      const file = STRUCTURED_FIXTURES[params.schemaName];
      if (file === undefined) throw new AiError('NOT_CONFIGURED', 'fixture');
      const key = await fixtureInputKey(params as GenerateStructuredParams<unknown>);
      const candidate = file.by_input[key] ?? file.default;
      const parsed = params.schema.safeParse(candidate);
      if (!parsed.success) throw new AiError('SCHEMA_VALIDATION', 'fixture');
      return {
        data: parsed.data,
        usage: emptyUsage(),
        stopReason: 'end',
        latencyMs: now() - started,
      };
    },
    async *stream(params: StreamParams, _target: ModelTarget): AsyncIterable<StreamEvent> {
      const first = params.results[0];
      const sentence = first?.sentences[0];
      if (first !== undefined && sentence !== undefined) {
        yield {
          type: 'text',
          text: sentence,
          citations: [{ resultIndex: 0, source: first.source, citedText: sentence }],
        };
      }
      yield { type: 'usage', usage: emptyUsage() };
      yield { type: 'stop', stopReason: 'end' };
    },
    embed(params: EmbedParams, target: ModelTarget): Promise<EmbedResult> {
      const dims =
        typeof target.params.output_dimension === 'number' ? target.params.output_dimension : 1024;
      return Promise.resolve({
        vectors: params.inputs.map((input) => fixtureVector(input, dims)),
        usage: { tokens: 0 },
        dimensions: dims,
      });
    },
    transcribe(params: TranscribeParams, _target: ModelTarget): Promise<TranscribeResult> {
      const text =
        params.language === 'en' ? audioFixtures.transcript_en : audioFixtures.transcript_tr;
      return Promise.resolve({ text, confidence: 1, usage: { audioSeconds: 0 } });
    },
    synthesize(params: SynthesizeParams, _target: ModelTarget): Promise<SynthesizeResult> {
      return Promise.resolve({
        bytes: silentMp3(),
        mime: 'audio/mpeg',
        usage: { characters: params.text.length },
      });
    },
  };
}
