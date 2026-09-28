# Backoffice RBAC

Documented at `ec14e92`. Role-based access control of the backoffice (`admin.<domain>`) as built. The module and session side is in [BACKOFFICE.md](BACKOFFICE.md); the plan it implements is [BACKOFFICE_PLAN §4](BACKOFFICE_PLAN.md#4-rbac-m47-adr-06-plan-10).

## Source of truth

| What | Where |
| --- | --- |
| Permission catalogue, role × permission matrix, argument rules | [`packages/domain/src/rbac.ts`](../packages/domain/src/rbac.ts) (`PERMISSIONS`, `ROLE_PERMISSIONS`, `canGrantEntitlement`, `canWriteFlag`, `checkAdminChange`) |
| Roles | `ADMIN_ROLE_VALUES` in [`packages/domain/src/enums.ts`](../packages/domain/src/enums.ts) (Postgres enum `admin_role`) |
| Route → permission of every admin-api route | `adminRoutes` in [`packages/validation/src/admin/routes.ts`](../packages/validation/src/admin/routes.ts) |
| SQL mirror of the matrix | `private.admin_role_permissions`, seeded in [`20260924001200_admin_audit.sql`](../supabase/migrations/20260924001200_admin_audit.sql) from `renderAdminRolePermissionSeed()` |
| Function → permission of every `admin_api` SQL function | view `private.admin_function_permissions` in [`20260924001320_functions_admin_api.sql`](../supabase/migrations/20260924001320_functions_admin_api.sql) |

The tables in "Generated reference" below are rendered from the first three rows by [`scripts/docs/gen-rbac.ts`](../scripts/docs/gen-rbac.ts). `node scripts/docs/gen-rbac.ts` rewrites them, `node scripts/docs/gen-rbac.ts --check` fails on drift, and the drift test in [`scripts/docs/__tests__/gen-rbac.test.ts`](../scripts/docs/__tests__/gen-rbac.test.ts) runs in `pnpm test:scripts` (CI `unit` job).

## Enforcement layers

| Layer | Where | What it checks |
| --- | --- | --- |
| 1. UI (cosmetic only) | [`apps/backoffice/src/lib/navigation.ts`](../apps/backoffice/src/lib/navigation.ts) and per-page gating | Sidebar entries and actions are hidden unless `/me.permissions` holds one of their permissions. A page without its read permission renders the forbidden state. Never treated as authorisation. |
| 2. admin-api route guard | [`supabase/functions/admin-api/middleware/permission.ts`](../supabase/functions/admin-api/middleware/permission.ts) | The route's registry `access` (`require`, plus `or` / `also`) against the permissions `admin_api.admin_me` returned for this session. A denial is `403 FORBIDDEN` and is audited through `admin_api.audit_denied`. Step-up routes need a TOTP re-check within 10 min. |
| 3. SQL | `private.admin_guard` / `require_admin` / `require_admin_any` / `require_admin_all` ([`20260924001300_functions_private.sql`](../supabase/migrations/20260924001300_functions_private.sql)) | First statement of every `admin_api` function: admin-api gateway header, `aal2`, a dedicated admin identity (`app_metadata.da_kind='admin'`), an active and unlocked `admin_users` row, the permission from `private.admin_role_permissions`, and a live `admin_sessions` row (idle and absolute limits). The `admin_role` JWT claim is never used for authorisation, so a role change applies on the next call. |
| 4. Tests | pgTAP [`120_admin_rbac.test.sql`](../supabase/tests/database/120_admin_rbac.test.sql) (table-driven from `private.admin_function_permissions`), [`300_threats_privilege.test.sql`](../supabase/tests/database/300_threats_privilege.test.sql); Vitest [`packages/domain/test/rbac/`](../packages/domain/test/rbac) (matrix = BACKOFFICE_PLAN §4.2, SQL seed = `rbac.ts`); Deno [`admin-api/tests/routes.test.ts`](../supabase/functions/admin-api/tests/routes.test.ts) (every route with the wrong permission); Playwright [`rbac-matrix.spec.ts`](../apps/backoffice/e2e/rbac-matrix.spec.ts) | Every role × function outcome; aal1, non-admin, missing gateway header, disabled admin and expired session are refused. |

## Rules that depend on arguments or on the target

| Rule | Implementation |
| --- | --- |
| Entitlement grants | `entitlements.grant`: 1, 7, 14 or 30 days with source `admin`, `support` or `compensation`. `entitlements.grant_limited` alone: 1 or 7 days, source `support` only (`canGrantEntitlement`, re-checked in `admin_api.entitlement_grant`). |
| Feature flags | `flags.write` changes any flag; `flags.write_ai` only keys starting with `ai.` or `voice.` (`canWriteFlag`). The registry marks flag routes `flags.write` or `flags.write_ai`; SQL applies the key rule. |
| Support Access | Only roles with `support.access` (`super_admin`, `support`) can request a grant; the request needs step-up. See [BACKOFFICE.md](BACKOFFICE.md#support-access). |
| Last super admin | Trigger `private.guard_last_super_admin` on `admin_users`: the last active `super_admin` cannot be demoted or disabled (`LAST_SUPER_ADMIN`), and admin rows are never deleted (`ADMINS_NEVER_DELETED`). |
| Self-protection | An admin cannot change their own role, status or MFA from the admin screens (`admin_update_role`, `admin_disable`, `admin_enable`, `admin_mfa_reset`; mirrored by `checkAdminChange` so the UI can disable the control first). |
| Recovery codes | `POST /me/recovery-codes` is own-account; the first set needs no step-up, regenerating an existing set does (the route overrides the registry flag in [`admin-api/routes/me.ts`](../supabase/functions/admin-api/routes/me.ts)). |

Every admin, whatever the role, can use the own-account routes (`/me*`, `/session/*`, `/preferences`).

## Changing a permission

1. Edit `ROLE_PERMISSIONS` (or `PERMISSIONS`) in `packages/domain/src/rbac.ts`. BACKOFFICE_PLAN §4.2 is the authority (R-20), and `packages/domain/test/rbac/sql-parity.test.ts` compares the two.
2. Add a new migration that updates `private.admin_role_permissions` (applied migrations are never edited). The parity test compares the seed in the admin migration with `renderAdminRolePermissionSeed()`.
3. If a route or SQL function changes permission, update `adminRoutes` and `private.admin_function_permissions` in the same change.
4. Run `node scripts/docs/gen-rbac.ts` and commit the regenerated tables.

## Differences from the plan

| Plan text | As built | Reason |
| --- | --- | --- |
| DATABASE_AND_RLS_PLAN §4.9 ticks `push.test` for `support` | `push.test` is `super_admin` and `operations` only | BACKOFFICE_PLAN §4.2 and §6.8 and API_CONTRACTS ADM-07 own admin permissions (R-20); the parity test records the §4.9 row as known drift. |
| BACKOFFICE_PLAN §4.2 shows `flags.write_ai` for `operations` "via `flags.write`" | `operations` holds `flags.write` and `flags.write_ai` explicitly | The matrix is a plain set; holding `flags.write` already allows every key, so the extra entry changes nothing. |

## Generated reference

<!-- BEGIN GENERATED: node scripts/docs/gen-rbac.ts (edit the sources, then regenerate) -->

### Roles

| Code | Role | Permissions held |
| --- | --- | --- |
| SA | `super_admin` | 54 of 54 |
| OP | `operations` | 37 of 54 |
| SU | `support` | 23 of 54 |
| FI | `finance` | 13 of 54 |
| AI | `ai_ops` | 17 of 54 |
| AN | `analyst` | 5 of 54 |
| RO | `readonly` | 24 of 54 |

### Role × permission matrix

54 permissions × 7 roles. Kind: `read` views data (aggregates or masked rows), `reveal` unmasks content, `mutation` changes state or triggers a side effect.

| Permission | Kind | SA | OP | SU | FI | AI | AN | RO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard.read` | read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `metrics.ops.read` | read | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| `metrics.ai.read` | read | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| `metrics.revenue.read` | read | ✓ | — | — | ✓ | — | ✓ | — |
| `metrics.product.read` | read | ✓ | ✓ | — | ✓ | — | ✓ | ✓ |
| `users.read` | read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `users.pii.reveal` | reveal | ✓ | — | ✓ | — | — | — | — |
| `users.force_sync` | mutation | ✓ | ✓ | ✓ | — | — | — | — |
| `users.disable` | mutation | ✓ | ✓ | — | — | — | — | — |
| `users.mark_internal` | mutation | ✓ | ✓ | — | — | — | — | — |
| `integrations.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `integrations.disconnect` | mutation | ✓ | ✓ | — | — | — | — | — |
| `integrations.renew_watch` | mutation | ✓ | ✓ | — | — | — | — | — |
| `jobs.read` | read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `jobs.retry` | mutation | ✓ | ✓ | — | — | — | — | — |
| `jobs.cancel` | mutation | ✓ | ✓ | — | — | — | — | — |
| `briefings.read` | read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `briefings.regenerate` | mutation | ✓ | ✓ | — | — | — | — | — |
| `notifications.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `push.test` | mutation | ✓ | ✓ | — | — | — | — | — |
| `ai.read` | read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `ai.models.write` | mutation | ✓ | — | — | — | ✓ | — | — |
| `prompts.read` | read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `prompts.write` | mutation | ✓ | — | — | — | ✓ | — | — |
| `prompts.activate` | mutation | ✓ | — | — | — | ✓ | — | — |
| `ai_feedback.read` | read | ✓ | — | — | — | ✓ | — | ✓ |
| `ai_feedback.reveal` | reveal | ✓ | — | — | — | ✓ | — | — |
| `subscriptions.read` | read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `billing_events.read` | read | ✓ | — | — | ✓ | — | — | ✓ |
| `subscriptions.resync` | mutation | ✓ | — | ✓ | ✓ | — | — | — |
| `entitlements.grant` | mutation | ✓ | — | — | ✓ | — | — | — |
| `entitlements.grant_limited` | mutation | ✓ | — | ✓ | — | — | — | — |
| `entitlements.revoke` | mutation | ✓ | — | — | ✓ | — | — | — |
| `referrals.read` | read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `referrals.review` | mutation | ✓ | — | — | ✓ | — | — | — |
| `support.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `support.write` | mutation | ✓ | — | ✓ | — | — | — | — |
| `support.access` | mutation | ✓ | — | ✓ | — | — | — | — |
| `feedback.read` | read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `feedback.write` | mutation | ✓ | ✓ | ✓ | — | — | — | — |
| `flags.read` | read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `flags.write` | mutation | ✓ | ✓ | — | — | — | — | — |
| `flags.write_ai` | mutation | ✓ | ✓ | — | — | ✓ | — | — |
| `announcements.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `announcements.write` | mutation | ✓ | ✓ | — | — | — | — | — |
| `data_requests.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `data_requests.manage` | mutation | ✓ | ✓ | ✓ | — | — | — | — |
| `audit.read` | read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `health.read` | read | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `health.run` | mutation | ✓ | ✓ | — | — | — | — | — |
| `admins.read` | read | ✓ | ✓ | — | — | — | — | ✓ |
| `admins.manage` | mutation | ✓ | — | — | — | — | — | — |
| `settings.system.write` | mutation | ✓ | — | — | — | — | — | — |
| `search.global` | read | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |

### admin-api route guards

145 routes, in registry order. "Guard" is the permission the route requires (`or`: any one of the listed permissions is enough; `and`: every listed permission is needed as well). "Step-up" means a TOTP re-check within the last 10 minutes.

| Route | Contract | Guard | Step-up | Audit action |
| --- | --- | --- | --- | --- |
| `POST /session/start` | ADM-00 | any active admin | — | `admin.login` |
| `POST /session/heartbeat` | ADM-00 | any active admin | — | — |
| `GET /me` | ADM-00 | any active admin, own account | — | — |
| `GET /me/sessions` | ADM-00 | any active admin, own account | — | — |
| `POST /session/logout` | ADM-00 | any active admin, own account | — | `admin.logout` |
| `POST /session/logout-all` | ADM-00 | any active admin, own account | — | `admin.logout_all` |
| `GET /preferences` | ADM-00 | any active admin, own account | — | — |
| `PATCH /preferences` | ADM-00 | any active admin, own account | — | — |
| `POST /auth/preflight` | ADM-00 | BFF key only (pre-sign-in) | — | — |
| `POST /auth/attempt` | ADM-00 | BFF key only (pre-sign-in) | — | `admin.login_failed` |
| `GET /auth/status` | ADM-00 | admin JWT at `aal1` (MFA not done yet) | — | — |
| `POST /auth/invite/redeem` | ADM-00 | BFF key only (pre-sign-in) | — | `admin.invite_redeemed` |
| `POST /auth/recovery-code/redeem` | ADM-00 | admin JWT at `aal1` (MFA not done yet) | — | `admin.mfa_recovery_used` |
| `POST /me/recovery-codes` | ADM-00 | any active admin, own account | ✓ | `admin.recovery_codes_regenerated` |
| `POST /me/mfa-factors` | ADM-00 | any active admin, own account | — | `admin.mfa_factor_added` |
| `DELETE /me/mfa-factors/:factorId` | ADM-00 | any active admin, own account | ✓ | `admin.mfa_factor_removed` |
| `POST /session/step-up` | ADM-00 | any active admin, own account | — | `admin.step_up` |
| `GET /dashboard/metrics` | ADM-01 | `dashboard.read` | — | — |
| `GET /dashboard/charts` | ADM-01 | `dashboard.read` | — | — |
| `GET /metrics/ops` | ADM-01 | `metrics.ops.read` | — | — |
| `GET /metrics/product` | ADM-01 | `metrics.product.read` | — | — |
| `GET /security-events` | ADM-01 | `admins.manage` | — | — |
| `GET /users` | ADM-02 | `users.read` | — | — |
| `POST /users/lookup` | ADM-02 | `users.read` | — | — |
| `GET /users/:id` | ADM-02 | `users.read` | — | — |
| `GET /users/:id/integrations` | ADM-02 | `users.read` and `integrations.read` | — | — |
| `GET /users/:id/briefings` | ADM-02 | `users.read` and `briefings.read` | — | — |
| `GET /users/:id/usage` | ADM-02 | `users.read` | — | — |
| `GET /users/:id/subscription` | ADM-02 | `users.read` and `subscriptions.read` | — | — |
| `GET /users/:id/referrals` | ADM-02 | `users.read` and `referrals.read` | — | — |
| `GET /users/:id/support` | ADM-02 | `users.read` and `support.read` | — | — |
| `GET /users/:id/audit` | ADM-02 | `users.read` and `audit.read` | — | — |
| `GET /users/:id/devices` | ADM-02 | `users.read` and `notifications.read` | — | — |
| `POST /users/:id/reveal` | ADM-02 | `users.pii.reveal` | — | `user.pii_revealed` |
| `POST /users/:id/force-sync` | ADM-02 | `users.force_sync` | — | `user.force_sync` |
| `POST /users/:id/disable` | ADM-02 | `users.disable` | ✓ | `user.disabled` |
| `POST /users/:id/restore` | ADM-02 | `users.disable` | ✓ | `user.restored` |
| `POST /users/:id/entitlement-grants` | ADM-02 | `entitlements.grant` or `entitlements.grant_limited` | — | `entitlement.granted` |
| `POST /users/:id/entitlement-grants/:grantId/revoke` | ADM-02 | `entitlements.revoke` | — | `entitlement.revoked` |
| `POST /users/:id/integrations/:accountId/disconnect` | ADM-02 | `integrations.disconnect` | ✓ | `integration.disconnected` |
| `POST /users/:id/internal` | ADM-02 | `users.mark_internal` | — | `user.marked_internal` |
| `GET /support/tickets` | ADM-03 | `support.read` | — | — |
| `GET /support/tickets/:id` | ADM-03 | `support.read` | — | — |
| `PATCH /support/tickets/:id` | ADM-03 | `support.write` | — | `ticket.updated` |
| `POST /support/tickets/:id/notes` | ADM-03 | `support.write` | — | `ticket.note_added` |
| `POST /support/tickets/:id/reply` | ADM-03 | `support.write` | — | `ticket.reply_sent` |
| `POST /support-access/grants` | ADM-03 | `support.access` | ✓ | `support_access.granted` |
| `POST /support-access/grants/:id/revoke` | ADM-03 | `support.access` | — | `support_access.revoked` |
| `GET /support-access/grants/:id/content/:scope` | ADM-03 | `support.access` | — | — |
| `GET /integrations` | ADM-04 | `integrations.read` | — | — |
| `GET /integrations/summary` | ADM-04 | `integrations.read` or `metrics.ops.read` | — | — |
| `GET /integrations/:accountId` | ADM-04 | `integrations.read` | — | — |
| `POST /integrations/:accountId/force-sync` | ADM-04 | `users.force_sync` | — | `user.force_sync` |
| `POST /integrations/:accountId/renew-watch` | ADM-04 | `integrations.renew_watch` | — | `integration.watch_renew_requested` |
| `GET /jobs` | ADM-05 | `jobs.read` | — | — |
| `GET /jobs/stats` | ADM-05 | `jobs.read` | — | — |
| `POST /jobs/retry-bulk` | ADM-05 | `jobs.retry` | — | `job.bulk_retried` |
| `GET /jobs/:id` | ADM-05 | `jobs.read` | — | — |
| `GET /correlation/:id` | ADM-05 | `jobs.read` | — | — |
| `POST /jobs/:id/retry` | ADM-05 | `jobs.retry` | — | `job.retried` |
| `POST /jobs/:id/cancel` | ADM-05 | `jobs.cancel` | — | `job.cancelled` |
| `GET /briefings/metrics` | ADM-06 | `briefings.read` | — | — |
| `GET /briefings` | ADM-06 | `briefings.read` | — | — |
| `POST /briefings/:id/regenerate` | ADM-06 | `briefings.regenerate` | — | `briefing.regenerated` |
| `GET /notifications/metrics` | ADM-07 | `notifications.read` | — | — |
| `GET /notifications` | ADM-07 | `notifications.read` | — | — |
| `POST /notifications/test-push` | ADM-07 | `push.test` | — | `push.test_sent` |
| `GET /notifications/test-push/preview` | ADM-07 | `push.test` | — | — |
| `GET /ai/metrics` | ADM-08 | `ai.read` or `metrics.ai.read` | — | — |
| `GET /ai/metrics/series` | ADM-08 | `ai.read` or `metrics.ai.read` | — | — |
| `GET /ai/requests` | ADM-08 | `ai.read` | — | — |
| `GET /ai/models` | ADM-08 | `ai.read` | — | — |
| `PATCH /ai/models/:profile/:feature` | ADM-08 | `ai.models.write` | — | `ai_model_config.updated` |
| `POST /ai/models/:profile/:feature/test` | ADM-08 | `ai.models.write` | — | `ai_model_config.tested` |
| `PATCH /ai/routing-profile` | ADM-08 | `ai.models.write` | — | `ai_routing_profile.changed` |
| `GET /ai/prompts` | ADM-09 | `prompts.read` | — | — |
| `GET /ai/prompts/:key` | ADM-09 | `prompts.read` | — | — |
| `GET /ai/prompts/:key/diff` | ADM-09 | `prompts.read` | — | — |
| `GET /ai/prompts/:key/versions/:v` | ADM-09 | `prompts.read` | — | — |
| `POST /ai/prompts/:key/versions` | ADM-09 | `prompts.write` | — | `prompt.draft_created` |
| `PATCH /ai/prompts/:key/versions/:v` | ADM-09 | `prompts.write` | — | `prompt.draft_updated` |
| `POST /ai/prompts/:key/versions/:v/test` | ADM-09 | `prompts.write` | — | — |
| `POST /ai/prompts/:key/versions/:v/activate` | ADM-09 | `prompts.activate` | — | `prompt.activated` |
| `POST /ai/prompts/:key/rollback` | ADM-09 | `prompts.activate` | — | `prompt.rolled_back` |
| `POST /ai/prompts/:key/versions/:v/archive` | ADM-09 | `prompts.activate` | — | `prompt.archived` |
| `GET /ai/feedback/aggregates` | ADM-10 | `ai_feedback.read` | — | — |
| `GET /ai/feedback` | ADM-10 | `ai_feedback.read` | — | — |
| `POST /ai/feedback/:id/reveal` | ADM-10 | `ai_feedback.reveal` | — | `ai_feedback.comment_revealed` |
| `GET /subscriptions/metrics` | ADM-11 | `subscriptions.read` | — | — |
| `GET /subscriptions` | ADM-11 | `subscriptions.read` | — | — |
| `GET /subscriptions/events` | ADM-11 | `billing_events.read` | — | — |
| `GET /subscriptions/trial-stream` | ADM-11 | `subscriptions.read` | — | — |
| `GET /subscriptions/events/:id` | ADM-11 | `billing_events.read` | — | — |
| `GET /entitlement-grants` | ADM-11 | `subscriptions.read` | — | — |
| `POST /subscriptions/:userId/sync` | ADM-11 | `subscriptions.resync` | — | `subscription.resync_requested` |
| `GET /referrals/metrics` | ADM-12 | `referrals.read` | — | — |
| `GET /referrals` | ADM-12 | `referrals.read` | — | — |
| `POST /referrals/:id/approve` | ADM-12 | `referrals.review` | — | `referral.approved` |
| `POST /referrals/:id/reject` | ADM-12 | `referrals.review` | — | `referral.rejected` |
| `GET /feedback` | ADM-13 | `feedback.read` | — | — |
| `GET /feedback/summary` | ADM-13 | `feedback.read` | — | — |
| `PATCH /feedback/:id` | ADM-13 | `feedback.write` | — | `feedback.updated` |
| `POST /feedback/:id/reveal` | ADM-13 | `users.pii.reveal` | — | `feedback.revealed` |
| `GET /flags` | ADM-14 | `flags.read` | — | — |
| `GET /flags/:key` | ADM-14 | `flags.read` | — | — |
| `GET /flags/:key/evaluate` | ADM-14 | `flags.read` | — | — |
| `POST /flags` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.created` |
| `PATCH /flags/:key` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.updated` |
| `POST /flags/:key/kill` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.kill_switch_on` |
| `POST /flags/:key/archive` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.archived` |
| `POST /flags/:key/overrides` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.override_added` |
| `DELETE /flags/:key/overrides/:userId` | ADM-14 | `flags.write` or `flags.write_ai` | — | `flag.override_removed` |
| `GET /announcements` | ADM-15 | `announcements.read` | — | — |
| `POST /announcements/audience-estimate` | ADM-15 | `announcements.read` | — | — |
| `GET /announcements/:id` | ADM-15 | `announcements.read` | — | — |
| `POST /announcements` | ADM-15 | `announcements.write` | — | `announcement.created` |
| `PATCH /announcements/:id` | ADM-15 | `announcements.write` | — | `announcement.updated` |
| `POST /announcements/:id/preview` | ADM-15 | `announcements.read` | — | — |
| `POST /announcements/:id/schedule` | ADM-15 | `announcements.write` | — | `announcement.scheduled` |
| `POST /announcements/:id/cancel` | ADM-15 | `announcements.write` | — | `announcement.cancelled` |
| `GET /data-requests` | ADM-16 | `data_requests.read` | — | — |
| `POST /data-requests/export/:id/regenerate` | ADM-16 | `data_requests.manage` | — | `data_request.export_regenerated` |
| `GET /data-requests/:kind/:id` | ADM-16 | `data_requests.read` | — | — |
| `POST /data-requests/:kind/:id/retry` | ADM-16 | `data_requests.manage` | — | `data_request.retried` |
| `GET /audit` | ADM-17 | `audit.read` | — | — |
| `GET /audit/verify-chain` | ADM-17 | `audit.read` | — | — |
| `GET /audit/:id` | ADM-17 | `audit.read` | — | — |
| `GET /health/summary` | ADM-18 | `health.read` | — | — |
| `GET /health/history` | ADM-18 | `health.read` | — | — |
| `POST /health/run` | ADM-18 | `health.run` | — | `health.run_requested` |
| `GET /health/app-versions` | ADM-18 | `health.read` | — | — |
| `GET /health/cron` | ADM-18 | `health.read` | — | — |
| `GET /admins` | ADM-19 | `admins.read` | — | — |
| `POST /admins/invite` | ADM-19 | `admins.manage` | ✓ | `admin.invited` |
| `PATCH /admins/:id` | ADM-19 | `admins.manage` | ✓ | `admin.role_changed` |
| `POST /admins/:id/disable` | ADM-19 | `admins.manage` | ✓ | `admin.disabled` |
| `POST /admins/:id/enable` | ADM-19 | `admins.manage` | ✓ | `admin.enabled` |
| `POST /admins/:id/revoke-sessions` | ADM-19 | `admins.manage` | ✓ | `admin.sessions_revoked` |
| `POST /admins/:id/resend-invite` | ADM-19 | `admins.manage` | ✓ | `admin.invite_resent` |
| `POST /admins/:id/reset-mfa` | ADM-19 | `admins.manage` | ✓ | `admin.mfa_reset` |
| `POST /admins/:id/unlock` | ADM-19 | `admins.manage` | ✓ | `admin.unlocked` |
| `GET /settings` | ADM-20 | any active admin | — | — |
| `PATCH /settings/plan-limits` | ADM-20 | `settings.system.write` | ✓ | `plan_limits.updated` |
| `PATCH /settings/config/:key` | ADM-20 | `settings.system.write` | ✓ | `settings.system_updated` |
| `GET /search` | ADM-21 | `search.global` | — | — |

<!-- END GENERATED: gen-rbac -->
