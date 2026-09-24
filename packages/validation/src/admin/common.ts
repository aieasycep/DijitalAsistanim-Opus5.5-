import { z } from 'zod';
import { ADMIN_ROLE_VALUES } from '@da/domain';
import { Uuid } from '../api/common.ts';
import { PagedSuccess, Success } from '../api/envelope.ts';
import type { RouteContract } from '../route.ts';

/*
 * admin-api conventions (docs/API_CONTRACTS.md §12.1–12.2): aal2 admin identities, per-route permission
 * (re-checked in SQL), masked PII by default, page pagination, `Idempotency-Key` on every mutation and
 * `{reason, confirm}` on sensitive ones.
 */

/** Permission catalogue (§12.2, copied from BACKOFFICE_PLAN §4.1). */
export const ADMIN_PERMISSION_VALUES = [
  'dashboard.read',
  'metrics.ops.read',
  'metrics.ai.read',
  'metrics.revenue.read',
  'metrics.product.read',
  'users.read',
  'users.pii.reveal',
  'users.force_sync',
  'users.disable',
  'users.mark_internal',
  'integrations.read',
  'integrations.disconnect',
  'integrations.renew_watch',
  'jobs.read',
  'jobs.retry',
  'jobs.cancel',
  'briefings.read',
  'briefings.regenerate',
  'notifications.read',
  'push.test',
  'ai.read',
  'ai.models.write',
  'prompts.read',
  'prompts.write',
  'prompts.activate',
  'ai_feedback.read',
  'ai_feedback.reveal',
  'subscriptions.read',
  'billing_events.read',
  'subscriptions.resync',
  'entitlements.grant',
  'entitlements.grant_limited',
  'entitlements.revoke',
  'referrals.read',
  'referrals.review',
  'support.read',
  'support.write',
  'support.access',
  'feedback.read',
  'feedback.write',
  'flags.read',
  'flags.write',
  'flags.write_ai',
  'announcements.read',
  'announcements.write',
  'data_requests.read',
  'data_requests.manage',
  'audit.read',
  'health.read',
  'health.run',
  'admins.read',
  'admins.manage',
  'settings.system.write',
  'search.global',
] as const;
export const AdminPermission = z.enum(ADMIN_PERMISSION_VALUES);
export type AdminPermission = z.infer<typeof AdminPermission>;
export const AdminRole = z.enum(ADMIN_ROLE_VALUES);

/**
 * Route access rule. `require` is the one primary permission (UT-RBAC-03) or an own-account class:
 * `own` (any active aal2 admin on their own data), `any_admin` (any active aal2 admin), `aal1` (an admin
 * JWT before MFA) or `bff` (server-to-server with `ADMIN_BFF_SECRET`). `also` lists extra module
 * permissions that must all be held; `or` lists alternatives that satisfy `require`.
 */
export interface AdminAccess {
  readonly require: AdminPermission | 'own' | 'any_admin' | 'aal1' | 'bff';
  readonly also?: readonly AdminPermission[];
  readonly or?: readonly AdminPermission[];
  /** TOTP re-check within 10 min (§12.2 "Step-up"). */
  readonly step_up?: boolean;
}

export interface AdminRouteContract extends RouteContract {
  readonly access: AdminAccess;
  /** `audit_logs.action` written by the mutation (§17), when any. */
  readonly audit?: string;
}

export function defineAdminRoute<const R extends AdminRouteContract>(route: R): R {
  return route;
}

// ── Shared field shapes ──────────────────────────────────────────────────────
/** Masked email: first two chars of the local part, `***`, then the domain (`yu***@gmail.com`). */
export const EmailMasked = z.string().regex(/^[^@\s]{0,2}\*\*\*@[^@\s]+\.[^@\s]+$/);
export const Reason = z.string().trim().min(10).max(500);
export const Confirm = z.literal(true);
/** Body of a sensitive mutation (§12.1). */
export const SensitiveBody = z.strictObject({ reason: Reason, confirm: Confirm });
/** Body of a mutation that requires only a reason. */
export const ReasonBody = z.strictObject({ reason: Reason });
export const EmptyAdminBody = z.strictObject({});
export const MetricsRange = z.enum(['24h', '7d', '30d', '90d']);
export const RangeQuery = z.strictObject({ range: MetricsRange.default('7d') });
export const IdParams = z.strictObject({ id: Uuid });
export const UserIdParams = z.strictObject({ id: Uuid });

/** A time-limited reveal of one sensitive value (audited). */
export const RevealData = z.object({ value: z.string(), expires_in_s: z.literal(60) });
export const RevealResponse = Success(RevealData);
/** Mutations that return nothing but a confirmation. */
export const AckResponse = Success(z.object({ ok: z.literal(true) }));

const PageSize = z.coerce
  .number()
  .int()
  .refine((n) => n === 10 || n === 25 || n === 50 || n === 100, 'page_size_not_allowed');

/**
 * Backoffice list query (§2.8): `?page=&page_size=&sort=&order=&q=&filter[<key>]=`. Sort columns and
 * filter keys are allow-listed per route; unknown keys are rejected.
 */
export function adminListQuery<const S extends readonly [string, ...string[]]>(options: {
  sort: S;
  filters?: Record<string, z.ZodType>;
  q?: boolean;
}) {
  const filterShape: Record<string, z.ZodType> = {};
  for (const [key, schema] of Object.entries(options.filters ?? {})) {
    filterShape[`filter[${key}]`] = schema.optional();
  }
  return z.strictObject({
    page: z.coerce.number().int().min(1).default(1),
    page_size: PageSize.default(25),
    sort: z.enum(options.sort).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    ...(options.q === false ? {} : { q: z.string().trim().min(1).max(200).optional() }),
    ...filterShape,
  });
}

export { PagedSuccess, Success };

/** Accepts `true`/`false` query flags. */
export const QueryFlag = z.enum(['true', 'false']).transform((v) => v === 'true');
