/**
 * Prompt registry (AI_PIPELINE_PLAN §5.4, M§58, IMPLEMENTATION_PLAN T-3.09): the active
 * `prompt_versions` row per prompt key, cached per isolate for 60 s. Activation and rollback happen
 * in the backoffice (`admin_api.prompt_activate` / `prompt_rollback`); a new active version reaches
 * every isolate within the cache TTL.
 */
import type { AiFeature } from '@da/domain';
import type { PromptKey } from '@da/validation';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import { AiError } from '../errors.ts';

export interface PromptVersion {
  readonly id: string;
  readonly prompt_key: PromptKey;
  readonly version: number;
  readonly system_prompt: string;
  readonly user_template: string;
  readonly output_schema_ref: string;
  readonly schema_hash: string;
  readonly model_role: string;
  readonly model_constraints: Readonly<Record<string, unknown>>;
}

/** Feature → prompt key (AI_PIPELINE_PLAN §5.2); `capture_extract` variants pick their key. */
export const FEATURE_PROMPT_KEY: Partial<Readonly<Record<AiFeature, PromptKey>>> = {
  email_triage: 'email_classification',
  thread_summary: 'thread_summary',
  email_deep_extract: 'email_deep_extract',
  commitment_extract: 'commitment',
  life_intel_extract: 'life_intel',
  briefing_morning: 'briefing_morning',
  briefing_midday: 'briefing_midday',
  briefing_evening: 'briefing_evening',
  weekly_review: 'weekly_review',
  meeting_prep: 'meeting_prep',
  post_meeting_parse: 'post_meeting',
  capture_extract: 'capture',
  assistant_intent: 'assistant_intent',
  assistant_qa: 'assistant',
  reply_draft: 'reply_draft',
  follow_up_draft: 'follow_up',
};

export interface PromptSource {
  active(key: PromptKey): Promise<PromptVersion>;
}

export interface PromptRegistryOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** Caches any loader for `ttlMs` per key. */
export function cachedPromptSource(
  load: (key: PromptKey) => Promise<PromptVersion | null>,
  options: PromptRegistryOptions = {},
): PromptSource & { invalidate(): void } {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<PromptKey, { at: number; value: PromptVersion }>();
  return {
    async active(key) {
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < ttl) return hit.value;
      const value = await load(key);
      if (value === null) throw new AiError('NOT_CONFIGURED');
      cache.set(key, { at: now(), value });
      return value;
    },
    invalidate() {
      cache.clear();
    },
  };
}

export function supabasePromptSource(
  client: DbClient,
  options: PromptRegistryOptions = {},
): PromptSource & { invalidate(): void } {
  return cachedPromptSource(async (key) => {
    const { data, error } = await client
      .from('prompt_versions')
      .select(
        'id,prompt_key,version,system_prompt,user_template,output_schema_ref,schema_hash,model_role,model_constraints',
      )
      .eq('prompt_key', key)
      .eq('status', 'active')
      .maybeSingle();
    if (error !== null) throw mapDbError(error);
    return (data as PromptVersion | null) ?? null;
  }, options);
}

/** Per-deploy canary configured on the prompt version (`model_constraints.canary`). */
export function promptCanary(version: PromptVersion): string | undefined {
  const canary = version.model_constraints.canary;
  return typeof canary === 'string' && canary.length >= 8 ? canary : undefined;
}
