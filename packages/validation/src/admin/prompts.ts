import { z } from 'zod';
import { PROMPT_STATUS_VALUES } from '@da/domain';
import { AiOutputSchemaName, PromptKey } from '../ai/index.ts';
import { hasDefinedValue, IsoDateTime, JobRef } from '../api/common.ts';
import { Reason, ReasonBody, SensitiveBody, Success } from './common.ts';

/* ADM-09 · Prompt management (§12.3). Dry runs use synthetic fixtures only, never user data. */

export const PromptKeyParams = z.strictObject({ key: PromptKey });
export const PromptVersionParams = z.strictObject({
  key: PromptKey,
  v: z.coerce.number().int().min(1),
});
export const PromptsListResponse = Success(
  z.array(z.object({ key: PromptKey, active_version: z.int().min(1).nullable() })),
);
export const PromptVersionSummary = z.object({
  version: z.int().min(1),
  status: z.enum(PROMPT_STATUS_VALUES),
  created_by: z.string().nullable(),
  created_at: IsoDateTime,
  activated_at: IsoDateTime.nullable(),
  telemetry: z.object({
    requests: z.int().min(0),
    error_rate: z.number().min(0).max(1),
    feedback_positive_rate: z.number().min(0).max(1).nullable(),
  }),
});
export const PromptVersionsResponse = Success(
  z.object({ key: PromptKey, versions: z.array(PromptVersionSummary) }),
);
/**
 * The last eval gate run of a version (`prompt_versions.eval_report`, AI_PIPELINE_PLAN §5.4):
 * whether it passed, when, on which dataset version, and per target. Metrics and gates only.
 */
export const PromptEvalSummary = z.object({
  passed: z.boolean(),
  mode: z.enum(['live', 'fixture', 'fixture_baseline']).nullable(),
  dataset_version: z.string().max(80).nullable(),
  finished_at: IsoDateTime.nullable(),
  targets: z.array(z.object({ provider: z.string(), model: z.string(), passed: z.boolean() })),
});
export const PromptVersionDetailResponse = Success(
  PromptVersionSummary.extend({
    key: PromptKey,
    template_system: z.string(),
    template_user: z.string(),
    output_schema: AiOutputSchemaName,
    schema_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    notes: z.string().nullable(),
    /** Absent from older servers; null when the version was never evaluated. */
    eval: PromptEvalSummary.nullable().optional(),
    /** Whether the key has a golden eval set, i.e. whether "Değerlendirme çalıştır" can run. */
    eval_available: z.boolean().optional(),
  }),
);
export const PromptDiffQuery = z
  .strictObject({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) })
  .refine((q) => q.from !== q.to, 'same_version');
export const PromptDiffResponse = Success(
  z.object({ from: z.int(), to: z.int(), diff: z.string() }),
);
export const PromptDraftBody = z.strictObject({
  template_system: z.string().min(1).max(60000),
  template_user: z.string().min(1).max(60000),
  output_schema: AiOutputSchemaName,
  notes: z.string().max(2000).optional(),
});
export const PromptDraftPatch = PromptDraftBody.partial().refine(hasDefinedValue, 'no_changes');
export const PromptVersionResponse = Success(
  z.object({ key: PromptKey, version: z.int().min(1), status: z.enum(PROMPT_STATUS_VALUES) }),
);
export const PromptTestBody = z.strictObject({
  fixture_set: z.string().regex(/^[a-z0-9_]{2,40}$/),
});
export const PromptTestResponse = Success(
  z.object({
    cases: z.int().min(0),
    schema_pass_rate: z.number().min(0).max(1),
    grounding_pass_rate: z.number().min(0).max(1),
  }),
);
/** `POST /ai/prompts/:key/versions/:v/eval`: queue an `ai_eval` gate run (a cost-bearing action). */
export const PromptEvalBody = ReasonBody;
export const PromptEvalResponse = Success(
  z.object({ key: PromptKey, version: z.int().min(1), job: JobRef }),
);
export const PromptActivateBody = SensitiveBody;
export const PromptRollbackBody = z.strictObject({
  to_version: z.int().min(1),
  reason: Reason,
  confirm: z.literal(true),
});
export const PromptArchiveBody = ReasonBody;
