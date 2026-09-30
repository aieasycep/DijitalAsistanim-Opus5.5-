/**
 * Route resolution (AI_PIPELINE_PLAN §3.6 `router.resolveRoute`, IMPLEMENTATION_PLAN T-3.09):
 *
 * 1. Kill switches (R-10): `ai.global.enabled` and `ai.feature.<feature>` off → T0.
 * 2. Profile: `plan_limits.ai_routing_profile` of the user's effective plan (`balanced` / `lean`).
 * 3. `ai_model_config[(profile, role, feature)]`; missing or disabled → T0.
 * 4. Chain = primary + `fallback_targets` (A8 order). `ai.model.large.enabled` off rewrites a T2
 *    primary to its first fallback; escalation only with `ai.model.opus_escalation`.
 * 5. Targets whose provider switch (`ai.provider.<p>.enabled`) is off, whose adapter has no
 *    credential, or whose circuit breaker is open are dropped. Nothing left → T0 `no_target`.
 * Config rows and profiles are cached per isolate for 60 s.
 */
import type { AiFeature, RoutingProfile } from '@da/domain';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import { mapDbError } from '../errors.ts';
import { type FlagMap, isOn } from '../services/flags.ts';
import type { ModelConfigRow, ModelRole, ModelTarget, ProviderId, RouteDecision } from './types.ts';

export interface ModelConfigSource {
  get(
    profile: RoutingProfile,
    feature: AiFeature,
    role?: ModelRole,
  ): Promise<ModelConfigRow | null>;
}

export interface BreakerSource {
  isOpen(provider: ProviderId, model: string): Promise<boolean>;
}

export interface RouterDeps {
  readonly configs: ModelConfigSource;
  readonly breakers?: BreakerSource;
  /** Whether an adapter with credentials exists for this provider (or the fixture serves it). */
  readonly providerAvailable: (provider: ProviderId) => boolean;
}

export interface ResolveInput {
  readonly feature: AiFeature;
  readonly profile: RoutingProfile;
  readonly flags: FlagMap;
  /** Pick a role when a feature has several rows (e.g. `capture_extract` classifier vs reasoning). */
  readonly role?: ModelRole;
}

/** Providers with an `ai.provider.<p>.enabled` switch (R-10). */
const SWITCHED_PROVIDERS: ReadonlySet<ProviderId> = new Set(['anthropic', 'openai', 'voyage']);

export async function resolveRoute(deps: RouterDeps, input: ResolveInput): Promise<RouteDecision> {
  const { feature, flags } = input;
  if (!isOn(flags, 'ai.global.enabled')) return { kind: 't0', reason: 'kill_switch' };
  if (!isOn(flags, `ai.feature.${feature}`)) return { kind: 't0', reason: 'feature_disabled' };

  const row = await deps.configs.get(input.profile, feature, input.role);
  if (row === null) return { kind: 't0', reason: 'not_configured' };
  if (!row.enabled) return { kind: 't0', reason: 'feature_disabled' };

  const primary: ModelTarget = { provider: row.provider, model: row.model, params: row.params };
  const fallbacks: ModelTarget[] = row.fallback_targets.map((t) => ({
    provider: t.provider,
    model: t.model,
    params: t.params ?? {},
  }));
  const largeEnabled = isOn(flags, 'ai.model.large.enabled');
  let candidates: ModelTarget[] = [primary, ...fallbacks];
  const skipped: { provider: ProviderId; model: string; reason: string }[] = [];
  if (row.tier === 't2' && !largeEnabled && fallbacks.length > 0) {
    skipped.push({
      provider: primary.provider,
      model: primary.model,
      reason: 'large_model_disabled',
    });
    candidates = fallbacks;
  }

  const usable: ModelTarget[] = [];
  for (const target of candidates) {
    if (
      SWITCHED_PROVIDERS.has(target.provider) &&
      !isOn(flags, `ai.provider.${target.provider}.enabled`)
    ) {
      skipped.push({ provider: target.provider, model: target.model, reason: 'provider_disabled' });
      continue;
    }
    if (!deps.providerAvailable(target.provider)) {
      skipped.push({
        provider: target.provider,
        model: target.model,
        reason: 'credential_missing',
      });
      continue;
    }
    if (
      deps.breakers !== undefined &&
      (await deps.breakers.isOpen(target.provider, target.model))
    ) {
      skipped.push({ provider: target.provider, model: target.model, reason: 'breaker_open' });
      continue;
    }
    usable.push(target);
  }
  if (usable.length === 0) return { kind: 't0', reason: 'no_target' };

  let escalation: ModelTarget | null = null;
  if (row.escalation_target !== null && largeEnabled && isOn(flags, 'ai.model.opus_escalation')) {
    const e = row.escalation_target;
    const target: ModelTarget = { provider: e.provider, model: e.model, params: e.params ?? {} };
    const providerOn =
      !SWITCHED_PROVIDERS.has(target.provider) ||
      isOn(flags, `ai.provider.${target.provider}.enabled`);
    if (providerOn && deps.providerAvailable(target.provider)) escalation = target;
  }

  return {
    kind: 'route',
    route: {
      feature,
      profile: input.profile,
      role: row.role,
      tier: row.tier,
      chain: usable,
      escalation,
      batchPolicy: row.batch_policy,
      cacheTtl: row.cache_ttl,
      maxInputTokens: row.max_input_tokens,
      configId: row.id,
      configVersion: row.version,
      skipped,
    },
  };
}

// ── Sources ──────────────────────────────────────────────────────────────────

/** Every `ai_model_config` row, cached per isolate. */
export function supabaseModelConfigSource(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): ModelConfigSource & { invalidate(): void } {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; rows: ModelConfigRow[] } | null = null;
  return {
    async get(profile, feature, role) {
      if (cache === null || now() - cache.at >= ttl) {
        const { data, error } = await client
          .from('ai_model_config')
          .select(
            'id,profile,role,feature,tier,provider,model,params,fallback_targets,escalation_target,batch_policy,cache_ttl,max_input_tokens,enabled,version',
          );
        if (error !== null) throw mapDbError(error);
        cache = { at: now(), rows: (data ?? []) as ModelConfigRow[] };
      }
      const matches = cache.rows.filter((r) => r.profile === profile && r.feature === feature);
      if (role !== undefined) return matches.find((r) => r.role === role) ?? null;
      return matches[0] ?? null;
    },
    invalidate() {
      cache = null;
    },
  };
}

export function staticModelConfigSource(rows: readonly ModelConfigRow[]): ModelConfigSource {
  return {
    get(profile, feature, role) {
      const matches = rows.filter((r) => r.profile === profile && r.feature === feature);
      return Promise.resolve(
        (role === undefined ? matches[0] : matches.find((r) => r.role === role)) ?? null,
      );
    },
  };
}

/** `private.ai_breaker_state(provider, model)` with a 5 s isolate cache. */
export function supabaseBreakerSource(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): BreakerSource {
  const ttl = options.ttlMs ?? 5_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; open: boolean }>();
  return {
    async isOpen(provider, model) {
      const key = `${provider}|${model}`;
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < ttl) return hit.open;
      const state = await rpc<{ open?: boolean } | null>(client, DB_FN.aiBreakerState, {
        p_provider: provider,
        p_model: model,
      });
      const open = state?.open === true;
      cache.set(key, { at: now(), open });
      return open;
    },
  };
}

export interface ProfileSource {
  profile(userId: string | null): Promise<RoutingProfile>;
}

/**
 * `plan_limits.ai_routing_profile` for the user's effective plan (`pro` when the entitlement is
 * active, else `free`); system calls without a user use `balanced`.
 */
export function supabaseProfileSource(
  client: DbClient,
  isPro: (userId: string) => Promise<boolean>,
  options: { ttlMs?: number; now?: () => number } = {},
): ProfileSource {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; byPlan: Record<string, RoutingProfile> } | null = null;
  return {
    async profile(userId) {
      if (userId === null) return 'balanced';
      if (cache === null || now() - cache.at >= ttl) {
        const { data, error } = await client
          .from('plan_limits')
          .select('plan,value')
          .eq('key', 'ai_routing_profile');
        if (error !== null) throw mapDbError(error);
        const byPlan: Record<string, RoutingProfile> = {};
        for (const row of (data ?? []) as { plan: string; value: unknown }[]) {
          if (row.value === 'balanced' || row.value === 'lean') byPlan[row.plan] = row.value;
        }
        cache = { at: now(), byPlan };
      }
      const plan = (await isPro(userId)) ? 'pro' : 'free';
      return cache.byPlan[plan] ?? (plan === 'pro' ? 'balanced' : 'lean');
    },
  };
}
