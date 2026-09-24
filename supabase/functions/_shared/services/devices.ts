/**
 * Device registration (API-DEV-01/02, ADR-10, M§35, M§87; IMPLEMENTATION_PLAN T-3.11).
 *
 * Register: upsert `app_installations` (by `installation_id`), re-bind an installation that moved
 * between users, upsert the Expo token in `push_tokens` (a token owned by another user is moved to
 * the caller, so the previous owner no longer receives pushes), disable older tokens of the
 * installation, and apply the device timezone when `timezone_mode='auto'`. The device fingerprint
 * is re-hashed with `HASH_PEPPER` before storage (referral anti-abuse only).
 *
 * Unregister: disables the installation's tokens and sets `signed_out_at`; a foreign installation is
 * `NOT_FOUND`; a repeat returns `disabled_tokens: 0`.
 */
import type { DeviceRegisterBody, DeviceUnregisterBody } from '@da/validation';
import type { z } from 'zod';
import { AppError, mapDbError } from '../errors.ts';
import { hashIdBytea, type Pepper } from '../crypto/hash.ts';
import type { DbClient } from '../db/clients.ts';

export type RegisterInput = z.infer<typeof DeviceRegisterBody>;
export type UnregisterInput = z.infer<typeof DeviceUnregisterBody>;

export interface InstallationRow {
  readonly id: string;
  readonly user_id: string;
  readonly installation_id: string;
  readonly signed_out_at: string | null;
}

export interface PushTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly installation_id: string;
  readonly status: 'active' | 'disabled';
}

/** `push_tokens.disabled_reason` vocabulary (DB §4.1). */
export type TokenDisableReason =
  'logout' | 'device_not_registered' | 'user_disabled' | 'replaced' | 'account_deleted';

export interface InstallationUpsert {
  readonly user_id: string;
  readonly installation_id: string;
  readonly platform: 'ios' | 'android';
  readonly os_version: string;
  readonly app_version: string;
  readonly build_number: string;
  readonly locale: string;
  readonly timezone: string;
  readonly push_enabled: boolean;
  readonly device_hash: string;
  readonly last_seen_at: string;
  readonly signed_out_at: null;
  readonly ni_listener_granted?: boolean | null;
  readonly ni_mode?: 'all' | 'selected' | null;
  readonly ni_allowed_packages?: string[];
}

export interface DevicesRepo {
  findInstallation(installationId: string): Promise<InstallationRow | null>;
  /** Upsert on `installation_id`; returns the row id. */
  upsertInstallation(row: InstallationUpsert): Promise<string>;
  findToken(token: string): Promise<PushTokenRow | null>;
  /** Moves an existing token row to this user/installation and re-activates it. */
  reassignToken(
    tokenRowId: string,
    userId: string,
    installationRowId: string,
    at: string,
  ): Promise<void>;
  insertToken(row: {
    user_id: string;
    installation_id: string;
    expo_push_token: string;
    last_registered_at: string;
  }): Promise<void>;
  /** Disables active tokens of an installation row (optionally except one token row and/or only for other users). */
  disableInstallationTokens(
    installationRowId: string,
    reason: TokenDisableReason,
    filter?: { exceptTokenRowId?: string; notUserId?: string },
  ): Promise<number>;
  markSignedOut(installationRowId: string, at: string): Promise<void>;
  /** `user_preferences.timezone` / `timezone_mode` of the caller. */
  timezonePreference(
    userId: string,
  ): Promise<{ timezone: string; timezone_mode: 'auto' | 'manual' } | null>;
  updateTimezone(userId: string, timezone: string): Promise<void>;
}

export interface RegisterResult {
  readonly installation_id: string;
  readonly push_enabled: boolean;
  readonly rebound_from_other_user: boolean;
  readonly timezone_applied: boolean;
}

export async function registerDevice(
  repo: DevicesRepo,
  pepper: Pepper,
  userId: string,
  input: RegisterInput,
  now: Date = new Date(),
): Promise<RegisterResult> {
  const at = now.toISOString();
  const pushAllowed =
    input.push.permission === 'granted' || input.push.permission === 'provisional';
  const token = pushAllowed ? input.push.expo_push_token : null;
  const deviceHash = await hashIdBytea(
    pepper,
    input.device_fingerprint_hash === null
      ? `installation:${input.installation_id}`
      : `device:${input.device_fingerprint_hash}`,
  );

  const existing = await repo.findInstallation(input.installation_id);
  let rebound = existing !== null && existing.user_id !== userId;

  const android = input.platform === 'android' ? input.android_ni : undefined;
  const installationRowId = await repo.upsertInstallation({
    user_id: userId,
    installation_id: input.installation_id,
    platform: input.platform,
    os_version: input.os_version,
    app_version: input.app_version,
    build_number: input.build_number,
    locale: input.locale,
    timezone: input.timezone,
    push_enabled: token !== null,
    device_hash: deviceHash,
    last_seen_at: at,
    signed_out_at: null,
    ...(android === undefined
      ? {}
      : {
          ni_listener_granted: android.listener_granted,
          ni_mode: android.enabled ? android.mode : null,
          ni_allowed_packages: android.allowed_packages,
        }),
  });

  if (rebound) {
    // Tokens registered on this installation by the previous user stop receiving pushes.
    await repo.disableInstallationTokens(installationRowId, 'replaced', { notUserId: userId });
  }

  if (token !== null) {
    const owner = await repo.findToken(token);
    if (owner === null) {
      await repo.insertToken({
        user_id: userId,
        installation_id: installationRowId,
        expo_push_token: token,
        last_registered_at: at,
      });
    } else {
      if (owner.user_id !== userId) rebound = true;
      await repo.reassignToken(owner.id, userId, installationRowId, at);
    }
    const current = await repo.findToken(token);
    await repo.disableInstallationTokens(
      installationRowId,
      'replaced',
      current === null ? {} : { exceptTokenRowId: current.id },
    );
  } else {
    await repo.disableInstallationTokens(installationRowId, 'user_disabled');
  }

  let timezoneApplied = false;
  const preference = await repo.timezonePreference(userId);
  if (
    preference !== null &&
    preference.timezone_mode === 'auto' &&
    preference.timezone !== input.timezone
  ) {
    await repo.updateTimezone(userId, input.timezone);
    timezoneApplied = true;
  }

  return {
    installation_id: input.installation_id,
    push_enabled: token !== null,
    rebound_from_other_user: rebound,
    timezone_applied: timezoneApplied,
  };
}

export async function unregisterDevice(
  repo: DevicesRepo,
  userId: string,
  input: UnregisterInput,
  now: Date = new Date(),
): Promise<{ disabled_tokens: number }> {
  const installation = await repo.findInstallation(input.installation_id);
  if (installation === null || installation.user_id !== userId) throw new AppError('NOT_FOUND');
  // DB vocabulary has no `account_switch`; both reasons end the session on this device.
  const disabled = await repo.disableInstallationTokens(installation.id, 'logout');
  if (installation.signed_out_at === null)
    await repo.markSignedOut(installation.id, now.toISOString());
  return { disabled_tokens: disabled };
}

// ── supabase-backed repository ───────────────────────────────────────────────

/**
 * `app_installations` / `push_tokens` rows are written with the service client (re-binding touches
 * other users' rows) and always filtered by ids derived from the verified caller; the timezone
 * preference is read and written with the caller's RLS client.
 */
export function supabaseDevicesRepo(clients: { system: DbClient; user: DbClient }): DevicesRepo {
  const { system, user } = clients;
  return {
    async findInstallation(installationId) {
      const { data, error } = await system
        .from('app_installations')
        .select('id,user_id,installation_id,signed_out_at')
        .eq('installation_id', installationId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as InstallationRow | null) ?? null;
    },
    async upsertInstallation(row) {
      const { data, error } = await system
        .from('app_installations')
        .upsert(row, { onConflict: 'installation_id' })
        .select('id')
        .single();
      if (error !== null) throw mapDbError(error);
      return (data as { id: string }).id;
    },
    async findToken(token) {
      const { data, error } = await system
        .from('push_tokens')
        .select('id,user_id,installation_id,status')
        .eq('expo_push_token', token)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as PushTokenRow | null) ?? null;
    },
    async reassignToken(tokenRowId, userId, installationRowId, at) {
      const { error } = await system
        .from('push_tokens')
        .update({
          user_id: userId,
          installation_id: installationRowId,
          status: 'active',
          disabled_reason: null,
          last_registered_at: at,
        })
        .eq('id', tokenRowId);
      if (error !== null) throw mapDbError(error);
    },
    async insertToken(row) {
      const { error } = await system.from('push_tokens').insert({ ...row, status: 'active' });
      if (error !== null) throw mapDbError(error);
    },
    async disableInstallationTokens(installationRowId, reason, filter = {}) {
      let query = system
        .from('push_tokens')
        .update({ status: 'disabled', disabled_reason: reason })
        .eq('installation_id', installationRowId)
        .eq('status', 'active');
      if (filter.exceptTokenRowId !== undefined) query = query.neq('id', filter.exceptTokenRowId);
      if (filter.notUserId !== undefined) query = query.neq('user_id', filter.notUserId);
      const { data, error } = await query.select('id');
      if (error !== null) throw mapDbError(error);
      return Array.isArray(data) ? data.length : 0;
    },
    async markSignedOut(installationRowId, at) {
      const { error } = await system
        .from('app_installations')
        .update({ signed_out_at: at })
        .eq('id', installationRowId);
      if (error !== null) throw mapDbError(error);
    },
    async timezonePreference(userId) {
      const { data, error } = await user
        .from('user_preferences')
        .select('timezone,timezone_mode')
        .eq('user_id', userId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as { timezone: string; timezone_mode: 'auto' | 'manual' } | null) ?? null;
    },
    async updateTimezone(userId, timezone) {
      const { error } = await user
        .from('user_preferences')
        .update({ timezone })
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
  };
}
