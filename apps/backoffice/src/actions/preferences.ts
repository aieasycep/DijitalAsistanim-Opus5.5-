'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { currentOriginCheck, failure, toActionFailure, type ActionResult } from '@/server/action';
import { adminApi } from '@/server/admin-api';
import { PREFERENCE_COOKIE_OPTIONS, THEME_COOKIE } from '@/server/preference-cookies';

/*
 * Level-1 preferences (BACKOFFICE_PLAN §5.4 L1, §6.24): no dialog, not audited. Each change is
 * persisted to `admin_preferences` through admin-api `PATCH /preferences`, so it follows the admin to
 * new browsers and devices; the theme is also mirrored into its cookie for flash-free SSR.
 */

const Theme = z.enum(['light', 'dark']);
const Range = z.enum(['24h', '7d', '30d', '90d']);
const TableId = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const TablePrefs = z.strictObject({
  hidden: z.array(z.string().max(64)).max(50).optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
});
export type TablePrefs = z.infer<typeof TablePrefs>;

async function patchPreferences(
  body: Record<string, unknown>,
): Promise<ActionResult<{ saved: true }>> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  const result = await adminApi('PATCH /preferences', { body });
  if (!result.ok) return { ok: false, error: toActionFailure(result.error) };
  return { ok: true, data: { saved: true } };
}

/** Theme toggle "Açık / Koyu": cookie first (the next render is already right), then the server. */
export async function setThemeAction(theme: unknown): Promise<ActionResult<{ saved: true }>> {
  const parsed = Theme.safeParse(theme);
  if (!parsed.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  (await cookies()).set(THEME_COOKIE, parsed.data, PREFERENCE_COOKIE_OPTIONS);
  return patchPreferences({ theme: parsed.data });
}

/** Sidebar 248 px ↔ 64 px, remembered in `admin_preferences.sidebar_collapsed` (§5.1 Layout). */
export async function setSidebarCollapsedAction(
  collapsed: unknown,
): Promise<ActionResult<{ saved: true }>> {
  if (typeof collapsed !== 'boolean') return failure('VALIDATION_FAILED', 'errors.validation', 422);
  return patchPreferences({ sidebar_collapsed: collapsed });
}

/** Dashboard range control persists `dashboard_range` (§6.1, not audited). */
export async function setDashboardRangeAction(
  range: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const parsed = Range.safeParse(range);
  if (!parsed.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);
  return patchPreferences({ dashboard_range: parsed.data });
}

/**
 * DataTable column visibility, page size and density per table (`table_prefs[tableId]`, §5.3). The
 * current map is read first so other tables' preferences are kept.
 */
export async function saveTablePrefsAction(
  tableId: unknown,
  prefs: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const id = TableId.safeParse(tableId);
  const value = TablePrefs.safeParse(prefs);
  if (!id.success || !value.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  const current = await adminApi('GET /preferences');
  if (!current.ok) return { ok: false, error: toActionFailure(current.error) };
  const existing = current.data.table_prefs;
  const previous = existing[id.data];
  const merged = {
    ...(typeof previous === 'object' && previous !== null
      ? (previous as Record<string, unknown>)
      : {}),
    ...value.data,
  };
  return patchPreferences({ table_prefs: { ...existing, [id.data]: merged } });
}
