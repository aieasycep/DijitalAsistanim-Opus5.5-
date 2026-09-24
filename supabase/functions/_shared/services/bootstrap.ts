/**
 * `GET /me/bootstrap` (API-BOOT-01, R-25; IMPLEMENTATION_PLAN T-3.11): one round trip at app start.
 *
 * Profile, preferences, effective entitlement and usage, evaluated flags, counts, connected account
 * summaries, active announcements (the Today banner), `min_supported_version`, `server_now`, the
 * remaining AI units and credential-driven service availability. The account-state gate is reported
 * in `account_state` / `config.upgrade_required` instead of failing.
 *
 * Every field is mapped explicitly from an allow-list: provider identifiers, scopes, tenant ids,
 * tokens and other raw provider data never leave the server.
 */
import type {
  AccountStatus,
  ApprovalActionType,
  Capability,
  NotificationDetail,
  Provider,
  RetentionPolicy,
  UserState,
} from '@da/domain';
import type { BootstrapData, DataSourceToggles } from '@da/validation';
import { API_CONTRACT_VERSION, UNDO_WINDOW_SECONDS } from '../config.ts';
import type { DbClient } from '../db/clients.ts';
import { mapDbError, type Locale } from '../errors.ts';
import type { VerifiedClaims } from '../http/context.ts';
import { type FlagMap, isOn } from './flags.ts';
import {
  compareSemver,
  effectiveAccountState,
  type MinVersions,
  upgradeRequired,
} from './account-state.ts';
import {
  buildEntitlementState,
  buildUsageSummary,
  type EntitlementReader,
} from './entitlements.ts';

export interface ProfileRow {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly locale: Locale;
  readonly state: UserState;
  readonly disabled_at: string | null;
  readonly onboarding_step: string | null;
  readonly onboarding_completed_at: string | null;
  readonly created_at: string;
}

export type PreferencesRow = Readonly<Record<string, unknown>> & {
  readonly timezone: string;
  readonly retention_policy: RetentionPolicy;
};

export type NotificationPreferencesRow = Readonly<Record<string, unknown>> & {
  readonly detail_level: NotificationDetail;
};

export interface AccountRow {
  readonly id: string;
  readonly provider: Provider;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly tenant_type: 'personal' | 'work' | null;
  readonly status: AccountStatus;
  readonly capabilities_granted: Capability[];
  readonly data_source_toggles: Record<string, unknown>;
  readonly last_sync_at: string | null;
  readonly last_error_code: string | null;
  readonly [other: string]: unknown;
}

export interface AnnouncementRow {
  readonly id: string;
  readonly title_tr: string;
  readonly title_en: string;
  readonly body_tr: string;
  readonly body_en: string;
  readonly audience: 'all' | 'free' | 'pro';
  readonly platforms: string[] | null;
  readonly min_app_version: string | null;
  readonly max_app_version: string | null;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly cta_deeplink: string | null;
}

export interface BootstrapSources {
  profile(userId: string): Promise<ProfileRow | null>;
  preferences(userId: string): Promise<PreferencesRow | null>;
  notificationPreferences(userId: string): Promise<NotificationPreferencesRow | null>;
  readonly entitlements: EntitlementReader;
  flags(
    userId: string,
    platform: 'ios' | 'android' | null,
    appVersion: string | null,
  ): Promise<FlagMap>;
  minSupportedVersion(): Promise<MinVersions>;
  referralRewardDays(): Promise<number>;
  referralRewardsPerYear(plan: 'free' | 'pro'): Promise<number>;
  counts(userId: string): Promise<BootstrapData['counts']>;
  pendingDeviceApprovals(
    userId: string,
    installationId: string,
  ): Promise<{ approval_id: string; action_type: ApprovalActionType; approved_at: string }[]>;
  accounts(userId: string): Promise<AccountRow[]>;
  /** Published, not cancelled, currently running announcements the user has not dismissed. */
  announcements(userId: string, now: Date): Promise<AnnouncementRow[]>;
  touchInstallation(userId: string, installationId: string, now: Date): Promise<void>;
}

/** Server capabilities that decide `service_status.unavailable_features`. */
export interface ServiceCapabilities {
  readonly aiGenerate: boolean;
  readonly embeddings: boolean;
  readonly ttsPremium: boolean;
  readonly googleOauth: boolean;
  readonly microsoftOauth: boolean;
  readonly purchases: boolean;
  readonly push: boolean;
}

export interface BootstrapContext {
  readonly userId: string;
  readonly claims: VerifiedClaims;
  readonly client: { platform: 'ios' | 'android' | null; version: string | null };
  readonly installationId: string | null;
  readonly capabilities: ServiceCapabilities;
  readonly demoMode: boolean;
  readonly now: Date;
}

const AUTH_PROVIDERS = new Set(['apple', 'google', 'azure', 'email']);
const DATA_SOURCE_KEYS = [
  'mail_read',
  'attachments_analyze',
  'deadline_detect',
  'draft_replies',
  'calendar_read',
  'schedule_suggest',
  'calendar_write_with_approval',
  'tasks_read',
] as const;

/** Microsoft has no per-app revoke: the user removes consent themselves (INTEGRATION_PLAN §3.14). */
const MICROSOFT_REVOKE_URL = {
  personal: 'https://account.live.com/consent/Manage',
  work: 'https://myapps.microsoft.com',
} as const;

function iso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function time(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)
    ? value.slice(0, 5)
    : fallback;
}

function weekdays(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => Number.isInteger(v) && v >= 1 && v <= 7)
    : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

export function mapPreferences(row: PreferencesRow): BootstrapData['preferences'] {
  const access = (row.ai_data_access ?? {}) as Record<string, unknown>;
  const interests = Array.isArray(row.interest_categories) ? row.interest_categories : [];
  return {
    theme: row.theme === 'light' || row.theme === 'dark' ? row.theme : 'system',
    reduce_motion: bool(row.reduce_motion, false),
    haptics_enabled: bool(row.haptics_enabled, true),
    timezone: row.timezone,
    timezone_mode: row.timezone_mode === 'manual' ? 'manual' : 'auto',
    retention_policy: row.retention_policy,
    learn_from_interactions: bool(row.learn_from_interactions, true),
    ai_data_access: {
      mail_body: bool(access.mail_body, true),
      attachments: bool(access.attachments, true),
      calendar: bool(access.calendar, true),
      contacts: bool(access.contacts, true),
      location_coarse: bool(access.location_coarse, false),
    },
    interest_categories: interests.filter(
      (c): c is BootstrapData['preferences']['interest_categories'][number] =>
        ['work', 'family', 'finance', 'travel', 'shopping', 'appointments', 'deadlines'].includes(
          String(c),
        ),
    ),
    morning_enabled: bool(row.morning_enabled, true),
    morning_time: time(row.morning_time, '08:00'),
    midday_enabled: bool(row.midday_enabled, true),
    midday_time: time(row.midday_time, '13:00'),
    evening_enabled: bool(row.evening_enabled, true),
    evening_time: time(row.evening_time, '19:00'),
    weekly_enabled: bool(row.weekly_enabled, true),
    weekly_dow: typeof row.weekly_dow === 'number' ? row.weekly_dow : 7,
    weekly_time: time(row.weekly_time, '18:00'),
    briefing_weekdays: weekdays(row.briefing_weekdays, [1, 2, 3, 4, 5, 6, 7]),
    weekend_morning_time: time(row.weekend_morning_time, '10:00'),
    weekend_morning_only: bool(row.weekend_morning_only, true),
    weekend_personal_first: bool(row.weekend_personal_first, true),
    working_hours_start: time(row.working_hours_start, '09:00'),
    working_hours_end: time(row.working_hours_end, '18:00'),
    work_days: weekdays(row.work_days, [1, 2, 3, 4, 5]),
    default_write_calendar_id:
      typeof row.default_write_calendar_id === 'string' ? row.default_write_calendar_id : null,
    dismissed_gates: stringRecord(row.dismissed_gates),
    analytics_opt_out: bool(row.analytics_opt_out, false),
    screen_protection: bool(row.screen_protection, false),
  };
}

export function mapNotificationPreferences(
  row: NotificationPreferencesRow,
): BootstrapData['notification_preferences'] {
  return {
    smart_filter: bool(row.smart_filter, true),
    morning: bool(row.morning, true),
    midday: bool(row.midday, true),
    evening: bool(row.evening, true),
    critical_email: bool(row.critical_email, true),
    meeting: bool(row.meeting, true),
    deadline: bool(row.deadline, true),
    follow_up: bool(row.follow_up, true),
    life_intel: bool(row.life_intel, false),
    approval: bool(row.approval, true),
    account: bool(row.account, true),
    quiet_hours_enabled: bool(row.quiet_hours_enabled, true),
    quiet_start: time(row.quiet_start, '22:30'),
    quiet_end: time(row.quiet_end, '07:30'),
    quiet_days: weekdays(row.quiet_days, [1, 2, 3, 4, 5, 6, 7]),
    vip_bypass_quiet: bool(row.vip_bypass_quiet, true),
    // No DB column (DB §4.1): meetings never bypass quiet hours.
    meetings_bypass_quiet: bool(row.meetings_bypass_quiet, false),
    snooze_until: iso(row.snooze_until),
    detail_level: row.detail_level,
    lock_screen_private: bool(row.lock_screen_private, true),
    daily_cap: typeof row.daily_cap === 'number' ? row.daily_cap : 5,
  };
}

export function mapAccount(row: AccountRow): BootstrapData['accounts'][number] {
  const toggles = {} as Record<(typeof DATA_SOURCE_KEYS)[number], boolean>;
  for (const key of DATA_SOURCE_KEYS) toggles[key] = row.data_source_toggles[key] !== false;
  return {
    id: row.id,
    provider: row.provider,
    account_email: row.account_email,
    display_name: row.display_label,
    status: row.status,
    capabilities_granted: [...row.capabilities_granted],
    data_sources: toggles as DataSourceToggles,
    paused_by_plan: row.paused_by_plan === true,
    last_sync_at: iso(row.last_sync_at),
    last_error_code: row.last_error_code,
    manual_revoke_url:
      row.provider === 'microsoft'
        ? MICROSOFT_REVOKE_URL[row.tenant_type === 'work' ? 'work' : 'personal']
        : null,
  };
}

export function announcementVisible(
  row: AnnouncementRow,
  ctx: {
    plan: 'free' | 'pro';
    platform: 'ios' | 'android' | null;
    version: string | null;
    now: Date;
  },
): boolean {
  const now = ctx.now.getTime();
  if (Date.parse(row.starts_at) > now || Date.parse(row.ends_at) <= now) return false;
  if (row.audience !== 'all' && row.audience !== ctx.plan) return false;
  if (
    row.platforms !== null &&
    row.platforms.length > 0 &&
    (ctx.platform === null || !row.platforms.includes(ctx.platform))
  ) {
    return false;
  }
  if (ctx.version !== null) {
    if (row.min_app_version !== null && compareSemver(ctx.version, row.min_app_version) < 0)
      return false;
    if (row.max_app_version !== null && compareSemver(ctx.version, row.max_app_version) > 0)
      return false;
  }
  return true;
}

export function unavailableFeatures(
  caps: ServiceCapabilities,
  flags: FlagMap,
): BootstrapData['service_status']['unavailable_features'] {
  const out: BootstrapData['service_status']['unavailable_features'] = [];
  const aiOn = isOn(flags, 'ai.global.enabled');
  const ai = (feature: string, flag: string, available: boolean) => {
    if (!aiOn || !isOn(flags, flag)) out.push({ feature, reason: 'feature_disabled' });
    else if (!available) out.push({ feature, reason: 'external_credential_required' });
  };
  ai('assistant', 'ai.feature.assistant_qa', caps.aiGenerate);
  ai('reply_drafts', 'ai.feature.reply_draft', caps.aiGenerate);
  ai('semantic_search', 'ai.feature.embedding_query', caps.embeddings);
  if (isOn(flags, 'voice.tts_premium') && !caps.ttsPremium)
    out.push({ feature: 'voice_premium', reason: 'external_credential_required' });
  if (!caps.googleOauth)
    out.push({ feature: 'integrations.google', reason: 'external_credential_required' });
  if (!caps.microsoftOauth)
    out.push({ feature: 'integrations.microsoft', reason: 'external_credential_required' });
  if (!caps.purchases) out.push({ feature: 'purchases', reason: 'external_credential_required' });
  if (!caps.push) out.push({ feature: 'push', reason: 'external_credential_required' });
  return out;
}

export async function buildBootstrap(
  sources: BootstrapSources,
  ctx: BootstrapContext,
): Promise<BootstrapData> {
  const { userId, now } = ctx;
  const [
    profile,
    preferences,
    notificationPreferences,
    effective,
    subscription,
    grants,
    usageRaw,
    flags,
    minVersions,
    rewardDays,
    accounts,
    counts,
  ] = await Promise.all([
    sources.profile(userId),
    sources.preferences(userId),
    sources.notificationPreferences(userId),
    sources.entitlements.effective(userId),
    sources.entitlements.subscription(userId),
    sources.entitlements.grants(userId),
    sources.entitlements.usage(),
    sources.flags(userId, ctx.client.platform, ctx.client.version),
    sources.minSupportedVersion(),
    sources.referralRewardDays(),
    sources.accounts(userId),
    sources.counts(userId),
  ]);
  if (profile === null || preferences === null || notificationPreferences === null) {
    throw new Error('bootstrap_profile_incomplete');
  }
  const plan: 'free' | 'pro' = effective.is_active ? 'pro' : 'free';
  const locale: Locale = profile.locale === 'en-US' ? 'en-US' : 'tr-TR';
  const [rewardsPerYear, announcementRows, deviceApprovals] = await Promise.all([
    sources.referralRewardsPerYear(plan),
    sources.announcements(userId, now),
    ctx.installationId === null
      ? Promise.resolve([])
      : sources.pendingDeviceApprovals(userId, ctx.installationId),
  ]);
  if (ctx.installationId !== null) await sources.touchInstallation(userId, ctx.installationId, now);

  const claimsProviders = Array.isArray(ctx.claims.app_metadata?.providers)
    ? (ctx.claims.app_metadata.providers as unknown[])
    : [];
  const authProviders = claimsProviders
    .map(String)
    .filter((p): p is 'apple' | 'google' | 'azure' | 'email' => AUTH_PROVIDERS.has(p));
  const email =
    typeof ctx.claims.email === 'string' && ctx.claims.email.includes('@')
      ? ctx.claims.email
      : null;

  return {
    server_now: now.toISOString(),
    api_version: API_CONTRACT_VERSION,
    demo_mode: ctx.demoMode,
    account_state: effectiveAccountState({ state: profile.state, disabledAt: profile.disabled_at }),
    profile: {
      id: userId,
      display_name: profile.display_name,
      email,
      auth_providers: [...new Set(authProviders)],
      created_at: iso(profile.created_at) ?? now.toISOString(),
      onboarding: {
        step: profile.onboarding_step,
        completed_at: iso(profile.onboarding_completed_at),
      },
    },
    preferences: mapPreferences(preferences),
    locale,
    notification_preferences: mapNotificationPreferences(notificationPreferences),
    entitlement: buildEntitlementState(effective, subscription, grants, now),
    usage: buildUsageSummary(usageRaw, plan, preferences.timezone, now),
    flags: { ...flags },
    config: {
      upgrade_required: upgradeRequired(ctx.client, minVersions),
      min_supported_version: { ios: minVersions.ios, android: minVersions.android },
      referral_reward_days: rewardDays,
      referral_max_rewards_per_year: rewardsPerYear,
      undo_window_seconds: UNDO_WINDOW_SECONDS,
    },
    counts,
    pending_device_approvals: deviceApprovals.map((a) => ({
      approval_id: a.approval_id,
      action_type: a.action_type,
      approved_at: iso(a.approved_at) ?? a.approved_at,
    })),
    accounts: accounts.map(mapAccount),
    announcements: announcementRows
      .filter((row) =>
        announcementVisible(row, {
          plan,
          platform: ctx.client.platform,
          version: ctx.client.version,
          now,
        }),
      )
      .map((row) => ({
        id: row.id,
        title: locale === 'en-US' ? row.title_en : row.title_tr,
        body: locale === 'en-US' ? row.body_en : row.body_tr,
        cta_route: row.cta_deeplink,
        ends_at: iso(row.ends_at),
      })),
    service_status: { unavailable_features: unavailableFeatures(ctx.capabilities, flags) },
  };
}

// ── supabase-backed sources ──────────────────────────────────────────────────

export interface BootstrapClients {
  /** The caller's RLS client: own profile, preferences, accounts, counts, entitlement. */
  readonly user: DbClient;
  /** Service client: system tables (`app_settings`, `plan_limits`, `announcements`, flags). */
  readonly system: DbClient;
}

async function single<T>(
  query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error !== null) throw mapDbError(error);
  return (data as T | null) ?? null;
}

async function count(
  query: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>,
): Promise<number> {
  const { count: n, error } = await query;
  if (error !== null) throw mapDbError(error);
  return n ?? 0;
}

export function supabaseBootstrapSources(
  clients: BootstrapClients,
  deps: {
    readonly entitlements: EntitlementReader;
    readonly flags: (
      userId: string,
      platform: 'ios' | 'android' | null,
      version: string | null,
    ) => Promise<FlagMap>;
    readonly minSupportedVersion: () => Promise<MinVersions>;
    readonly referralRewardDays: () => Promise<number>;
  },
): BootstrapSources {
  const { user, system } = clients;
  return {
    profile: (userId) =>
      single<ProfileRow>(
        user
          .from('profiles')
          .select(
            'user_id,display_name,locale,state,disabled_at,onboarding_step,onboarding_completed_at,created_at',
          )
          .eq('user_id', userId)
          .maybeSingle(),
      ),
    preferences: (userId) =>
      single<PreferencesRow>(
        user.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
      ),
    notificationPreferences: (userId) =>
      single<NotificationPreferencesRow>(
        user.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
      ),
    entitlements: deps.entitlements,
    flags: deps.flags,
    minSupportedVersion: deps.minSupportedVersion,
    referralRewardDays: deps.referralRewardDays,
    async referralRewardsPerYear(plan) {
      const row = await single<{ value: unknown }>(
        system
          .from('plan_limits')
          .select('value')
          .eq('plan', plan)
          .eq('key', 'referral_rewards_per_year')
          .maybeSingle(),
      );
      return typeof row?.value === 'number' ? row.value : 6;
    },
    async counts(userId) {
      const [pending, followups, commitments] = await Promise.all([
        count(
          user
            .from('approval_actions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'pending'),
        ),
        count(
          user
            .from('insights')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('kind', 'follow_up')
            .eq('status', 'open'),
        ),
        count(
          user
            .from('commitments')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'open'),
        ),
      ]);
      return {
        pending_approvals: pending,
        open_followups: followups,
        open_commitments: commitments,
      };
    },
    async pendingDeviceApprovals(userId, installationId) {
      const installation = await single<{ id: string }>(
        user
          .from('app_installations')
          .select('id')
          .eq('user_id', userId)
          .eq('installation_id', installationId)
          .maybeSingle(),
      );
      if (installation === null) return [];
      const { data, error } = await user
        .from('approval_actions')
        .select('id,action_type,approved_at')
        .eq('user_id', userId)
        .eq('executor', 'device')
        .eq('status', 'approved')
        .eq('device_installation_id', installation.id)
        .order('approved_at', { ascending: true })
        .limit(20);
      if (error !== null) throw mapDbError(error);
      return (
        (data ?? []) as { id: string; action_type: ApprovalActionType; approved_at: string }[]
      ).map((r) => ({
        approval_id: r.id,
        action_type: r.action_type,
        approved_at: r.approved_at,
      }));
    },
    async accounts(userId) {
      const { data, error } = await user
        .from('connected_accounts')
        .select(
          'id,provider,account_email,display_label,tenant_type,status,capabilities_granted,data_source_toggles,last_sync_at,last_error_code',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error !== null) throw mapDbError(error);
      return (data ?? []) as AccountRow[];
    },
    async announcements(userId, now) {
      const at = now.toISOString();
      const { data, error } = await system
        .from('announcements')
        .select(
          'id,title_tr,title_en,body_tr,body_en,audience,platforms,min_app_version,max_app_version,starts_at,ends_at,cta_deeplink',
        )
        .not('published_at', 'is', null)
        .is('cancelled_at', null)
        .lte('starts_at', at)
        .gt('ends_at', at)
        .order('starts_at', { ascending: false })
        .limit(10);
      if (error !== null) throw mapDbError(error);
      const rows = (data ?? []) as AnnouncementRow[];
      if (rows.length === 0) return rows;
      const { data: dismissed, error: dismissedError } = await user
        .from('announcement_dismissals')
        .select('announcement_id')
        .eq('user_id', userId)
        .in(
          'announcement_id',
          rows.map((r) => r.id),
        );
      if (dismissedError !== null) throw mapDbError(dismissedError);
      const hidden = new Set(
        ((dismissed ?? []) as { announcement_id: string }[]).map((d) => d.announcement_id),
      );
      return rows.filter((r) => !hidden.has(r.id));
    },
    async touchInstallation(userId, installationId, now) {
      const threshold = new Date(now.getTime() - 10 * 60_000).toISOString();
      const { error } = await system
        .from('app_installations')
        .update({ last_seen_at: now.toISOString() })
        .eq('user_id', userId)
        .eq('installation_id', installationId)
        .lt('last_seen_at', threshold);
      if (error !== null) throw mapDbError(error);
    },
  };
}
