/**
 * Wiring of the Edge AI core for the pipeline (T-5.01…T-5.08): the `AiRuntime` of one isolate
 * (router, prompts, prices, telemetry, budget with the org-ceiling guard, result cache, providers)
 * and the per-user AI context (`AiUser`: plan, routing profile, flags, timezone, locale, Data
 * Source Controls, learning switch).
 *
 * Clients are injected: the worker passes its service client, the api its system repositories.
 */
import type { RoutingProfile } from '@da/domain';
import { isValidTimeZone } from '@da/domain';
import { providerUserRef } from '../../ai/cache.ts';
import { supabaseResultCache } from '../../ai/cache.ts';
import type { AiRuntime } from '../../ai/call.ts';
import {
  supabaseBudgetGate,
  supabaseOrgBudgetEvaluator,
  withOrgBudgetGuard,
} from '../../ai/budget.ts';
import { supabasePriceSource } from '../../ai/pricing.ts';
import { deployCanary } from '../../ai/prompts/assemble.ts';
import { supabasePromptSource } from '../../ai/prompts/registry.ts';
import { type AiProviderSet, createAiProviders } from '../../ai/providers/index.ts';
import {
  type ProfileSource,
  supabaseBreakerSource,
  supabaseModelConfigSource,
  supabaseProfileSource,
} from '../../ai/router.ts';
import { supabaseTelemetrySink } from '../../ai/telemetry.ts';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import type { RawEnv } from '../../env.ts';
import { mapDbError } from '../../errors.ts';
import type { Logger } from '../../logging/logger.ts';
import { type FlagMap, type FlagSource, supabaseFlagSource } from '../flags.ts';
import { type CopyLocale, copyLocale } from '../copy.ts';

/** `user_preferences.ai_data_access` (enforced before every model call, API_CONTRACTS §4.5). */
export interface AiDataAccess {
  readonly mailBody: boolean;
  readonly attachments: boolean;
  readonly calendar: boolean;
  readonly contacts: boolean;
}

export interface AiUser {
  readonly userId: string;
  readonly plan: 'free' | 'pro';
  readonly isPro: boolean;
  readonly profile: RoutingProfile;
  readonly flags: FlagMap;
  readonly timeZone: string;
  readonly locale: CopyLocale;
  readonly displayName: string | null;
  readonly dataAccess: AiDataAccess;
  readonly learnFromInteractions: boolean;
  readonly followUpAfterDays: number;
  readonly workingHours: { readonly start: string; readonly end: string; readonly days: number[] };
  /** HMAC pseudonym for provider abuse monitoring; null without `AI_HASH_PEPPER`. */
  readonly userRef: string | null;
}

export interface AiUserSource {
  load(userId: string): Promise<AiUser>;
}

interface PrefsRow {
  timezone: string | null;
  ai_data_access: Record<string, boolean> | null;
  learn_from_interactions: boolean | null;
  follow_up_after_days: number | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  work_days: number[] | null;
}

function hhmm(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;
}

/** Builds the `AiUser` from raw rows (shared by the supabase source and tests). */
export function buildAiUser(input: {
  userId: string;
  isPro: boolean;
  profile: RoutingProfile;
  flags: FlagMap;
  prefs: PrefsRow | null;
  profileRow: { display_name: string | null; locale: string | null } | null;
  userRef: string | null;
}): AiUser {
  const access = input.prefs?.ai_data_access ?? {};
  const zone = input.prefs?.timezone ?? 'Europe/Istanbul';
  return {
    userId: input.userId,
    plan: input.isPro ? 'pro' : 'free',
    isPro: input.isPro,
    profile: input.profile,
    flags: input.flags,
    timeZone: isValidTimeZone(zone) ? zone : 'Europe/Istanbul',
    locale: copyLocale(input.profileRow?.locale),
    displayName: input.profileRow?.display_name ?? null,
    dataAccess: {
      mailBody: access.mail_body !== false,
      attachments: access.attachments !== false,
      calendar: access.calendar !== false,
      contacts: access.contacts !== false,
    },
    learnFromInteractions: input.prefs?.learn_from_interactions !== false,
    followUpAfterDays: input.prefs?.follow_up_after_days ?? 2,
    workingHours: {
      start: hhmm(input.prefs?.working_hours_start, '09:00'),
      end: hhmm(input.prefs?.working_hours_end, '18:00'),
      days: input.prefs?.work_days ?? [1, 2, 3, 4, 5],
    },
    userRef: input.userRef,
  };
}

export async function isProUser(client: DbClient, userId: string): Promise<boolean> {
  const rows = await rpc<{ is_active?: boolean }[] | { is_active?: boolean } | null>(
    client,
    DB_FN.effectiveEntitlement,
    { p_user_id: userId },
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row?.is_active === true;
}

export function supabaseAiUserSource(
  client: DbClient,
  deps: { flags: FlagSource; profiles: ProfileSource; pepper: string | null },
): AiUserSource {
  return {
    async load(userId) {
      const [isPro, flags, prefs, profile] = await Promise.all([
        isProUser(client, userId),
        deps.flags.forUser(userId, null, null),
        client
          .from('user_preferences')
          .select(
            'timezone,ai_data_access,learn_from_interactions,follow_up_after_days,working_hours_start,working_hours_end,work_days',
          )
          .eq('user_id', userId)
          .maybeSingle(),
        client.from('profiles').select('display_name,locale').eq('user_id', userId).maybeSingle(),
      ]);
      if (prefs.error !== null) throw mapDbError(prefs.error);
      if (profile.error !== null) throw mapDbError(profile.error);
      return buildAiUser({
        userId,
        isPro,
        profile: await deps.profiles.profile(userId),
        flags,
        prefs: prefs.data as PrefsRow | null,
        profileRow: profile.data as { display_name: string | null; locale: string | null } | null,
        userRef: deps.pepper === null ? null : await providerUserRef(deps.pepper, userId),
      });
    },
  };
}

export interface AiServices {
  readonly runtime: AiRuntime;
  readonly users: AiUserSource;
  readonly providers: AiProviderSet;
  /** Per-deploy S7 canary (from `DEPLOY_ID`). */
  readonly canary: string | undefined;
}

/** The production AI services of one isolate over a service client. */
export function createAiServices(client: DbClient, raw: RawEnv, log: Logger): AiServices {
  const providers = createAiProviders(raw);
  const pepper = raw.AI_HASH_PEPPER?.trim() ? raw.AI_HASH_PEPPER.trim() : null;
  const flags = supabaseFlagSource(client);
  const profiles = supabaseProfileSource(client, (userId) => isProUser(client, userId));
  const runtime: AiRuntime = {
    router: {
      configs: supabaseModelConfigSource(client),
      breakers: supabaseBreakerSource(client),
      providerAvailable: (provider) => providers.available(provider),
    },
    prompts: supabasePromptSource(client),
    prices: supabasePriceSource(client),
    telemetry: supabaseTelemetrySink(client),
    budget: withOrgBudgetGuard(supabaseBudgetGate(client), supabaseOrgBudgetEvaluator(client), {
      onTrip: (state) => log.warn('ai_org_budget_tripped', { pct: state.pct }),
    }),
    cache: supabaseResultCache(client),
    provider: (id) => providers.get(id),
    aiHashPepper: pepper,
    log,
  };
  return {
    runtime,
    users: supabaseAiUserSource(client, { flags, profiles, pepper }),
    providers,
    canary: deployCanary(raw.DEPLOY_ID),
  };
}
