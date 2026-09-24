/**
 * The AI pipeline job definitions (T-5.01…T-5.08, T-5.17): JOB-10 `email_triage`, JOB-11
 * `email_analysis`, JOB-12 `insight_refresh`, JOB-14 `briefing`, JOB-16 `embedding`, JOB-28
 * `ai_batch` and the `reconciliation {scope:'ai_cost'}` scoped definition.
 */
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import { aiBatchJob } from './ai_batch.ts';
import { briefingJob } from './briefing.ts';
import { emailAnalysisJob } from './email_analysis.ts';
import { emailTriageJob } from './email_triage.ts';
import { embeddingJob } from './embedding.ts';
import { insightRefreshJob } from './insight_refresh.ts';
import type { IntelDeps } from './intel.ts';
import { aiCostReconciliationJob } from './reconciliation_ai_cost.ts';

export function intelJobDefinitions(deps: IntelDeps): JobDefinition<never>[] {
  return [
    emailTriageJob(deps),
    emailAnalysisJob(deps),
    insightRefreshJob(deps),
    embeddingJob(deps),
    briefingJob(deps),
    aiBatchJob(deps),
    aiCostReconciliationJob(deps),
  ] as unknown as JobDefinition<never>[];
}
