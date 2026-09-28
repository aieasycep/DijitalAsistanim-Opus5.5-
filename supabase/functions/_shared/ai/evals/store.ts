/**
 * Persistence of the eval gate runs (DATABASE_AND_RLS_PLAN §4.4): the prompt version under test and
 * the model-config rows of its route are read with the service client; a finished run is recorded
 * through `public.ai_eval_record` (migration 20260924003510), which writes `eval_report`,
 * `eval_passed`, `eval_dataset_version` and, for the active version, `ai_model_config.eval_status`.
 */
import type { AiFeature, PromptStatus } from '@da/domain';
import type { PromptKey } from '@da/validation';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { mapDbError } from '../../errors.ts';
import type { Json } from '../../jobs/types.ts';
import type { PromptVersion } from '../prompts/registry.ts';
import type { ModelConfigRow } from '../types.ts';
import type { EvalReport } from './runner.ts';

export interface EvalVersion extends PromptVersion {
  readonly status: PromptStatus;
}

export interface EvalRecordInput {
  readonly versionId: string;
  readonly report: EvalReport;
  readonly passed: boolean;
  readonly datasetVersion: string;
}

export interface EvalStore {
  /** The version by id, or the active version of the key when `id` is null. */
  version(key: PromptKey, id: string | null): Promise<EvalVersion | null>;
  modelConfigs(feature: AiFeature): Promise<ModelConfigRow[]>;
  record(input: EvalRecordInput): Promise<Record<string, Json>>;
}

const VERSION_COLUMNS =
  'id,prompt_key,version,status,system_prompt,user_template,output_schema_ref,schema_hash,model_role,model_constraints';
const CONFIG_COLUMNS =
  'id,profile,role,feature,tier,provider,model,params,fallback_targets,escalation_target,batch_policy,cache_ttl,max_input_tokens,enabled,version';

export function supabaseEvalStore(client: DbClient): EvalStore {
  return {
    async version(key, id) {
      const query = client.from('prompt_versions').select(VERSION_COLUMNS).eq('prompt_key', key);
      const { data, error } = await (
        id === null ? query.eq('status', 'active') : query.eq('id', id)
      ).maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as EvalVersion | null) ?? null;
    },
    async modelConfigs(feature) {
      const { data, error } = await client
        .from('ai_model_config')
        .select(CONFIG_COLUMNS)
        .eq('feature', feature);
      if (error !== null) throw mapDbError(error);
      return (data ?? []) as ModelConfigRow[];
    },
    async record(input) {
      return await rpc<Record<string, Json>>(client, DB_FN.aiEvalRecord, {
        p_version: input.versionId,
        p_features: null,
        p_report: input.report as unknown as Json,
        p_passed: input.passed,
        p_dataset_version: input.datasetVersion,
      });
    },
  };
}
