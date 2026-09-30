import { z } from 'zod';
import type { AiFeature } from '@da/domain';
import { AssistantAnswerV1, AssistantGroundedJsonV1, AssistantIntentV1 } from './assistant.ts';
import { BriefingMorningV1 } from './briefing-morning.ts';
import { BriefingPolishV1 } from './briefing-polish.ts';
import { CaptureExtractV1 } from './capture-extract.ts';
import { CommitmentExtractV1 } from './commitment-extract.ts';
import { EmailDeepExtractV1 } from './email-deep-extract.ts';
import { EmailTriageV1 } from './email-triage.ts';
import { EveningCloseV1 } from './evening-close.ts';
import { LifeIntelV1 } from './life-intel.ts';
import { MeetingPrepV1 } from './meeting-prep.ts';
import { MiddayPulseV1 } from './midday-pulse.ts';
import { PostMeetingCommitmentV1 } from './post-meeting.ts';
import { FollowUpDraftV1, ReplyDraftsV1 } from './reply-drafts.ts';
import { ThreadSummaryV1 } from './thread-summary.ts';
import { WeeklyReviewV1, WeeklyStatsV1 } from './weekly-review.ts';

export * from './assistant.ts';
export * from './briefing-morning.ts';
export * from './briefing-polish.ts';
export * from './capture-extract.ts';
export * from './commitment-extract.ts';
export * from './email-deep-extract.ts';
export * from './email-triage.ts';
export * from './evening-close.ts';
export * from './life-intel.ts';
export * from './meeting-prep.ts';
export * from './midday-pulse.ts';
export * from './post-meeting.ts';
export * from './reply-drafts.ts';
export * from './thread-summary.ts';
export * from './weekly-review.ts';
export * from './wire.ts';
export {
  Certainty as AiCertainty,
  CommitmentClaim as AiCommitmentClaim,
  Confidence as AiConfidence,
  DeadlineClaim as AiDeadlineClaim,
  Evidence as AiEvidence,
  QUOTE_MAX_CHARS,
  QUOTE_MIN_CHARS,
  REF_PATTERN,
  ReasonCode as AiReasonCode,
  Ref as AiRef,
  Refiner,
  ScheduleRequestClaim as AiScheduleRequestClaim,
  TEXT_CAPS,
  cleanText,
  numericTokens,
  sameNumericTokens,
  truncateText,
  truncateWords,
  wordCount,
} from './common.ts';
export type { BaseRefineContext, DropReason, DroppedClaim, RefineResult } from './common.ts';

/** Prompt keys (AI_PIPELINE_PLAN §5.2; ADM-09). */
export const PROMPT_KEY_VALUES = [
  'email_classification',
  'thread_summary',
  'email_deep_extract',
  'commitment',
  'post_meeting',
  'follow_up',
  'life_intel',
  'briefing_morning',
  'briefing_midday',
  'briefing_evening',
  'weekly_review',
  'meeting_prep',
  'capture',
  'capture_vision',
  'capture_pdf',
  'assistant_intent',
  'assistant',
  'reply_draft',
] as const;
export const PromptKey = z.enum(PROMPT_KEY_VALUES);
export type PromptKey = z.infer<typeof PromptKey>;

export type AiSchemaKind = 'wire' | 'payload' | 'view_model';

export interface AiSchemaEntry {
  readonly schema: z.ZodType;
  /** `wire` = sent to a model; `payload` = built by code; `view_model` = server output model. */
  readonly kind: AiSchemaKind;
  readonly prompt_keys: readonly PromptKey[];
  readonly features: readonly AiFeature[];
}

/** The §4.3 catalogue: every structured-output schema with its producer and `ai_feature`. */
export const AI_SCHEMAS = {
  EmailTriageV1: {
    schema: EmailTriageV1,
    kind: 'wire',
    prompt_keys: ['email_classification'],
    features: ['email_triage'],
  },
  ThreadSummaryV1: {
    schema: ThreadSummaryV1,
    kind: 'wire',
    prompt_keys: ['thread_summary'],
    features: ['thread_summary'],
  },
  CommitmentExtractV1: {
    schema: CommitmentExtractV1,
    kind: 'wire',
    prompt_keys: ['commitment'],
    features: ['commitment_extract'],
  },
  EmailDeepExtractV1: {
    schema: EmailDeepExtractV1,
    kind: 'wire',
    prompt_keys: ['email_deep_extract'],
    features: ['email_deep_extract'],
  },
  LifeIntelV1: {
    schema: LifeIntelV1,
    kind: 'wire',
    prompt_keys: ['life_intel'],
    features: ['life_intel_extract'],
  },
  BriefingMorningV1: {
    schema: BriefingMorningV1,
    kind: 'wire',
    prompt_keys: ['briefing_morning'],
    features: ['briefing_morning'],
  },
  BriefingPolishV1: {
    schema: BriefingPolishV1,
    kind: 'wire',
    prompt_keys: ['briefing_midday', 'briefing_evening'],
    features: ['briefing_midday', 'briefing_evening'],
  },
  MiddayPulseV1: {
    schema: MiddayPulseV1,
    kind: 'payload',
    prompt_keys: [],
    features: ['briefing_midday'],
  },
  EveningCloseV1: {
    schema: EveningCloseV1,
    kind: 'payload',
    prompt_keys: [],
    features: ['briefing_evening'],
  },
  WeeklyReviewV1: {
    schema: WeeklyReviewV1,
    kind: 'wire',
    prompt_keys: ['weekly_review'],
    features: ['weekly_review'],
  },
  WeeklyStatsV1: {
    schema: WeeklyStatsV1,
    kind: 'payload',
    prompt_keys: [],
    features: ['weekly_review'],
  },
  MeetingPrepV1: {
    schema: MeetingPrepV1,
    kind: 'wire',
    prompt_keys: ['meeting_prep'],
    features: ['meeting_prep'],
  },
  PostMeetingCommitmentV1: {
    schema: PostMeetingCommitmentV1,
    kind: 'wire',
    prompt_keys: ['post_meeting'],
    features: ['post_meeting_parse'],
  },
  CaptureExtractV1: {
    schema: CaptureExtractV1,
    kind: 'wire',
    prompt_keys: ['capture', 'capture_vision', 'capture_pdf'],
    features: ['capture_extract'],
  },
  AssistantIntentV1: {
    schema: AssistantIntentV1,
    kind: 'wire',
    prompt_keys: ['assistant_intent'],
    features: ['assistant_intent'],
  },
  AssistantGroundedJsonV1: {
    schema: AssistantGroundedJsonV1,
    kind: 'wire',
    prompt_keys: ['assistant'],
    features: ['assistant_qa'],
  },
  AssistantAnswerV1: {
    schema: AssistantAnswerV1,
    kind: 'view_model',
    prompt_keys: [],
    features: ['assistant_qa'],
  },
  ReplyDraftsV1: {
    schema: ReplyDraftsV1,
    kind: 'wire',
    prompt_keys: ['reply_draft'],
    features: ['reply_draft'],
  },
  FollowUpDraftV1: {
    schema: FollowUpDraftV1,
    kind: 'wire',
    prompt_keys: ['follow_up'],
    features: ['follow_up_draft'],
  },
} as const satisfies Record<string, AiSchemaEntry>;

export type AiSchemaName = keyof typeof AI_SCHEMAS;
export const AI_SCHEMA_NAMES = Object.keys(AI_SCHEMAS) as AiSchemaName[];

/** Schemas a prompt version may declare as its `output_schema` (ADM-09): the model-facing ones. */
export const AI_OUTPUT_SCHEMA_NAMES = AI_SCHEMA_NAMES.filter(
  (name) => AI_SCHEMAS[name].kind === 'wire',
);
export const AiOutputSchemaName = z.enum(
  AI_OUTPUT_SCHEMA_NAMES as [AiSchemaName, ...AiSchemaName[]],
);
