import { z } from 'zod';
import { INSIGHT_KIND_VALUES } from '@da/domain';
import { JobRef, Uuid } from './common.ts';
import { Success } from './envelope.ts';

// API-ONB-01 · POST /onboarding/first-analysis
export const FirstAnalysisBody = z.strictObject({
  window_hours: z.int().min(24).max(72).default(72),
});
export const FirstAnalysisResponse = Success(
  z.object({ job: JobRef, already_running: z.boolean() }),
);

// API-ONB-02 · GET /onboarding/first-analysis/:jobId
export const FirstAnalysisParams = z.strictObject({ jobId: Uuid });
export const FirstAnalysisStepKey = z.enum(['scan_mail', 'classify', 'calendar', 'open_loops']);
export const FirstAnalysisProgressData = z.object({
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  partial: z.boolean(),
  steps: z.array(
    z.object({
      key: FirstAnalysisStepKey,
      status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
      count: z.int().nullable(),
    }),
  ),
  counts: z.object({
    mails_found: z.int(),
    potential_important: z.int(),
    upcoming_events: z.int(),
    possible_followups: z.int(),
  }),
  top_items: z
    .array(
      z.object({
        insight_id: Uuid,
        kind: z.enum(INSIGHT_KIND_VALUES),
        title: z.string().max(200),
        time_label: z.string().nullable(),
      }),
    )
    .max(5),
  total_items: z.int(),
  briefing_id: Uuid.nullable(),
});
export const FirstAnalysisProgress = Success(FirstAnalysisProgressData);
