# Dijital Asistan: Database (as built)

Documented at `ec14e92`.

PostgreSQL on Supabase: hosted and CI run PostgreSQL 17; the migrations stay compatible with
PostgreSQL 16 and pgvector 0.6 so the container tier (tier C) can run them. The design intent is
[DATABASE_AND_RLS_PLAN.md](DATABASE_AND_RLS_PLAN.md); this page records what the migrations
create. The [reference](#reference-generated) at the end is **generated** from the migrations and
the generated PostgREST types. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md); privacy and
retention: [PRIVACY.md](PRIVACY.md); admin permissions: [BACKOFFICE_RBAC.md](BACKOFFICE_RBAC.md).

## Schemas

| Schema | Exposed through PostgREST | Contents |
|---|---|---|
| `public` | Yes (`config.toml` `api.schemas`) | The 81 product tables, one view, the 26 user RPCs and the service-role wrappers the Edge Functions call |
| `admin_api` | Yes, but every function fails closed without the admin gateway header | The backoffice functions; each runs `private.require_admin(permission)` (gateway hash, `aal2`, admin identity, active session, role permission) |
| `private` | No | Helpers, security-definer logic (entitlements, approvals state machine, jobs, budgets, retention, scheduler, audit chain), internal tables and views |
| `extensions` | No | `pgcrypto`, `pg_trgm`, `unaccent`, `citext`, `vector` |
| Supabase-managed | No | `auth`, `storage`, `vault`, `cron` (pg_cron, when available), `net` (pg_net, when available) |

Supabase Realtime is off (`[realtime] enabled = false`) and its publication stays empty (R-19).

## Migrations

Forward-only files in [`supabase/migrations`](../supabase/migrations), applied in file-name
order, one transaction each (`lock_timeout = 10s`). The generated
[migration order](#migration-order) lists every file.

| Range | Contents |
|---|---|
| `20260924000100`–`001200` | Extensions and schemas, enums and check helpers, then the tables by domain: identity and settings, integrations, content, intelligence (AI config, prompts, prices, telemetry), approvals, assistant and memory (`vector(1024)`, HNSW), notifications, business (subscriptions, grants, plan limits, referrals), ops and product (jobs, flags, analytics, health, settings, rollups), privacy, admin and audit. Every table enables and forces RLS where it is created |
| `20260924001300`–`001330` | `private` helpers, the user RPCs, every `admin_api` function with `private.admin_function_permissions`, the job queue API, rate limits, service wrappers, `scheduler_tick` and metric rollups |
| `20260924001400` | The access layer: baseline revokes, owner policies, column grants, restrictive `aal2` policies on admin-only tables, append-only revokes |
| `20260924001500`–`001700` | The eight `da_*` pg_cron jobs (skipped when pg_cron is absent), the three private buckets and their read policies, the first service wrapper for the audit-chain probe |
| `20260924002000`–`003000` | Feature runtimes added by later tasks: integrations runtime (R-07 binding, device snapshots), approvals and reminders runtime, billing sync, referrals, public-api data layer, admin contract bridge, AI pipeline parts 1 and 2 (with the generated prompt seeds `002410` and `002610`), privacy engine, retention triggers, the referral loop fix, the admin contract gaps |
| `20260924003400`–`003440` | Calendar intelligence: the `calendar_freebusy` capability (attendee free/busy, KPL-46); the cross-source event merge (KPL-15): `calendar_events.merged_into_id` / `merge_sources`, `private.merge_calendar_events` run by statement triggers on `calendar_events` and by a change of `calendars.selected`, the restrictive `calendar_events_hide_merged` policy, the user RPC `calendar_event_canonical_id`, `plan_range` event `sources`, the Microsoft `calendar_freebusy` backfill; then the validation of the new constraints |

Conventions that hold across the files:

- **Constraints on existing tables** are added `NOT VALID` and validated in a separate later file
  (`…_validate.sql`), so `pnpm db:lint` (squawk 2.65.0) reports nothing.
- **Seeds inside migrations:** `supabase/seed/ai_model_config.sql` and `ai_model_prices.sql` are
  embedded verbatim (`pnpm db:seed-blocks`, checked by tier C); the prompt seeds are rendered from
  `supabase/prompts/*.md` ([AI_PROMPTS.md](AI_PROMPTS.md)). Seeded rows are inserted only when
  absent, so backoffice edits survive re-runs.
- **Functions:** `security definer` functions pin `set search_path = ''` and qualify every name.
  PostgREST reaches only `public` and `admin_api`, so each `private` helper the Edge Functions need
  has a `public` wrapper that only `service_role` may execute.
- **Errors raised in SQL** and their API mapping
  ([`mapDbError`](../supabase/functions/_shared/errors.ts)): `P0002` → `NOT_FOUND`;
  `P0001 ENTITLEMENT_REQUIRED:<feature>` or `PLAN_LIMIT:<key>` → `ENTITLEMENT_REQUIRED`;
  `22023 VALIDATION_FAILED:<field>` (also `23514`, `22P02`) → `VALIDATION_FAILED`; `23505` →
  `STATE_CONFLICT`; `42501` → `FORBIDDEN` (the admin guard's `42501` messages map to `AAL2_REQUIRED`,
  `AUTH_REQUIRED` or `FORBIDDEN`); `55000 ILLEGAL_TRANSITION` / `STATE_CONFLICT` / `LEASE_LOST` are
  handled by the calling service. The SQL message never reaches a client.
- **Retention:** tables marked for expiry get `expires_at` from the owner's `retention_policy`
  through BEFORE INSERT triggers; deleting a source row deletes the memory chunks derived from it in
  the same statement ([PRIVACY.md](PRIVACY.md#retention)).

## Access model

- **RLS everywhere:** every `public` table has row level security enabled **and forced**; `anon`
  has no grant on any table; future objects get no client privileges by default.
- **Owner policies** use `(select auth.uid()) = user_id` (evaluated once per statement) and are
  granted `to authenticated` only.
- **Column grants** decide what a client may read or write: hashes, cursors, embeddings and
  secrets are never client-readable; state machines, provenance and AI output are never
  client-writable. A policy without a grant (or a grant without a policy) gives nothing.
- **SYS tables** (credentials, OAuth states, jobs, webhooks, AI telemetry, admin tables, …) have
  no client grant; only `service_role` and security-definer functions reach them. Admin-only
  tables also carry a restrictive `aal2` policy as defence in depth.
- **Append-only:** `audit_logs` and `approval_events` refuse UPDATE and DELETE for every role
  including `service_role`; `support_notes` refuses UPDATE.
- **Admin identities** (`app_metadata.da_kind = 'admin'`) get `admin_role` in their access token
  only through `private.custom_access_token_hook`, which reads `admin_users`; a forged claim or
  `user_metadata` is dropped.

## Scheduler

`private.scheduler_tick(p_now)` runs every minute from `da_scheduler_tick` under an advisory lock
(a concurrent tick returns `skipped`). In order it: reaps expired job leases; creates due
briefings per user in the user's time zone (morning, midday, evening, weekly; DST-safe) and
enqueues their jobs; enqueues meeting-prep precompute 45–60 minutes ahead for Pro users with
external or VIP attendees and the meeting-prep notification at the user's lead time; enqueues the
post-meeting prompt; watch renewals and Graph calendar re-baselines; task polls every 15 minutes;
reminders due within a minute; expires pending approvals; wakes snoozed insights, commitments and
life events; sends deadline and follow-up nudges in the user's local 09:00–09:15 window; sweeps
referral qualification every 15 minutes; fails stale device approvals; releases expired AI budget
holds (and evaluates the organisation AI ceiling every 5 minutes and enqueues the nightly AI cost
reconciliation from 03:30 UTC); enqueues `integration_purge` for OAuth bindings that expired
(R-07); audits expired Support Access grants; rolls up `metrics_daily` every 15 minutes; and
pokes the worker when it enqueued anything. Time travel in tests goes through `p_now`.

## Running the database tiers

| Tier | Command | What runs |
|---|---|---|
| C (container) | `bash scripts/db/tier-c.sh` (`pnpm db:test:c`) | Recreates `da_test` on a local PostgreSQL 16 cluster (pgvector, pgTAP, pg_cron preloaded with `cron.database_name = 'da_test'`), loads the compatibility shim [`supabase/tests/shim/000_supabase_compat.sql`](../supabase/tests/shim/000_supabase_compat.sql) (roles, `auth`, `storage`, `vault`, `net` stand-ins, Supabase default privileges), applies every migration, checks the embedded seed blocks, runs `pg_prove` over `supabase/tests/database/**/*.test.sql`, then `plpgsql_check` ([`scripts/db/plpgsql-lint.sh`](../scripts/db/plpgsql-lint.sh), errors fail). `DA_TEST_DB` and `PGPORT` select another database or cluster; `--no-tests` stops after the migrations |
| A (full stack) | `bash scripts/db/tier-a.sh` (`pnpm db:test`) | `supabase start`, `db reset` from zero, the pgTAP helpers, `supabase test db`, `supabase db lint` (needs Docker; the CI `db` job, followed by `pnpm db:types:check --no-migrate` against the real stack) |
| Recreate twice | `pnpm db:reset-twice` | A tier twice from zero (idempotent recreation) |
| Migration lint | `pnpm db:lint` | squawk 2.65.0 over every migration |
| Types | `pnpm db:types` / `pnpm db:types:check` | Regenerates or checks `packages/api-client/src/database.types.ts` (postgres-meta 0.99.0, schemas `public` and `admin_api`) |
| Enum parity | `pnpm db:enum-parity` | Database enums equal `DB_ENUMS` of `@da/domain` |
| Demo data | `pnpm db:seed:demo` | Loads `supabase/seed/demo/*.sql`; refuses without `DEMO_MODE=true` |

At `ec14e92` tier C runs 32 pgTAP files with 1,104 assertions. The suites:

| File | Covers |
|---|---|
| `001_structure`, `002_global_invariants` | Tables, RLS enabled and forced, empty Realtime publication, canonical enums; global privilege invariants |
| `010_identity_devices`, `020_integrations_content` | New-user trigger, owner isolation, column privileges, anon denial; integrations and content CRUD, plan limits, hidden columns, provider quota |
| `050_approvals` | The approval state machine (R-03, R-06, R-18) |
| `060_search_memory`, `061_ai_budget`, `240_ai_pipeline`, `20260924002600_ai_pipeline_part2` | Hybrid search (FTS + vector, RRF), memory privacy, AI budget reservations and caps, AI pipeline SQL (contacts, briefings, cost control), part-2 client ids and prompt seeds |
| `070_notifications_business`, `220_business_billing`, `221_referrals` | Notifications, entitlements, flags; RevenueCat ledger and mirror; referral codes, evaluation and capped rewards |
| `090_jobs_scheduler` | Job queue (claim, lease, back-off, dead letter), rate limits, the DST-safe scheduler tick |
| `110_privacy_retention`, `250_privacy_engine`, `20260924002800_android_ni` | Retention cleanup and recompute, history purge, account-deletion cascade and verification, Android signal storage and expiry |
| `120_admin_rbac`, `121_audit_admin_guard`, `124_admin_api_smoke`, `230_admin_api_bridge`, `231_admin_metrics`, `20260924003000_admin_contract_gaps` | Every `admin_api` function against every role, the audit hash chain and last-super-admin guard, admin behaviour on fixtures, dashboard metrics, the audit catalogue |
| `130_storage_cron`, `150_column_grants`, `160_user_rpcs`, `222_public_api` | Buckets and folder policies, pg_cron schedules and the worker poke; client column privileges; the user RPCs; the public-api data layer |
| `20260924002000_integrations_runtime`, `20260924002100_approvals_reminders_runtime` | R-07 binding and completion, content upserts without bodies; approvals, device execution and reminders runtime |
| `300_threats_admin`, `300_threats_privilege`, `300_threats_tenant`, `300_threats_writes` | The SQL side of the threat tests ([SECURITY.md](SECURITY.md)) |
| `20260924003410_calendar_merge` | Cross-source calendar merge: iCalUID, title + organiser and device matches, same-calendar and cancelled exclusions, the canonical choice, regrouping on change, deselection and deletion, `updated_at` untouched by bookkeeping, the restrictive policy, `calendar_event_canonical_id`, `plan_range` sources, the `calendar_freebusy` label |

The Edge integration suites (`supabase/tests/integration/*.test.ts`, `pnpm test:integration`)
run against tier A in CI and tier C+ locally; see [TESTING.md](TESTING.md).

## Reference (generated)

Generated by [`scripts/docs/gen-db-reference.ts`](../scripts/docs/gen-db-reference.ts) from the
migrations and `packages/api-client/src/database.types.ts`; no database is needed.

| Command | Effect |
|---|---|
| `node scripts/docs/gen-db-reference.ts` | Rewrites the section below |
| `node scripts/docs/gen-db-reference.ts --check` | Fails when the section is out of date (runs in `pnpm test:scripts`) |
| `pnpm docs:generate` / `pnpm docs:check` | All three doc generators ([AI_PROMPTS.md](AI_PROMPTS.md), [AI_PIPELINE.md](AI_PIPELINE.md) model tables, this page) |
| `node scripts/docs/gen-db-reference.ts --verify-db` | Compares the static model with the catalog of a migrated database (RLS switches, policies, column and DELETE privileges of `authenticated`, function EXECUTE): `DA_DOCS_DB_URL`, otherwise tier C through `scripts/db/psql.sh` (`PGPORT`, `DA_TEST_DB`). At `ec14e92` it matched on a fresh tier-C run: 81 tables, 90 policies, 1,049 client column privileges, 489 functions |

The generator also fails when the column set of a table in the migrations differs from
`database.types.ts`, and when a `do $$ … $$` block contains an access statement in a loop shape it
does not understand.

<!-- generated:db:start -->

### Migration order

43 migrations, applied in file-name order:

1. [`20260924000100_extensions_schemas_enums.sql`](../supabase/migrations/20260924000100_extensions_schemas_enums.sql)
1. [`20260924000200_identity_settings.sql`](../supabase/migrations/20260924000200_identity_settings.sql)
1. [`20260924000300_integrations.sql`](../supabase/migrations/20260924000300_integrations.sql)
1. [`20260924000400_content.sql`](../supabase/migrations/20260924000400_content.sql)
1. [`20260924000500_intelligence.sql`](../supabase/migrations/20260924000500_intelligence.sql)
1. [`20260924000600_approvals.sql`](../supabase/migrations/20260924000600_approvals.sql)
1. [`20260924000700_assistant_memory.sql`](../supabase/migrations/20260924000700_assistant_memory.sql)
1. [`20260924000800_notifications.sql`](../supabase/migrations/20260924000800_notifications.sql)
1. [`20260924000900_business.sql`](../supabase/migrations/20260924000900_business.sql)
1. [`20260924001000_ops_product.sql`](../supabase/migrations/20260924001000_ops_product.sql)
1. [`20260924001100_privacy.sql`](../supabase/migrations/20260924001100_privacy.sql)
1. [`20260924001200_admin_audit.sql`](../supabase/migrations/20260924001200_admin_audit.sql)
1. [`20260924001300_functions_private.sql`](../supabase/migrations/20260924001300_functions_private.sql)
1. [`20260924001310_functions_public_rpcs.sql`](../supabase/migrations/20260924001310_functions_public_rpcs.sql)
1. [`20260924001320_functions_admin_api.sql`](../supabase/migrations/20260924001320_functions_admin_api.sql)
1. [`20260924001330_scheduler_jobs.sql`](../supabase/migrations/20260924001330_scheduler_jobs.sql)
1. [`20260924001400_rls_policies_grants.sql`](../supabase/migrations/20260924001400_rls_policies_grants.sql)
1. [`20260924001500_cron_schedules.sql`](../supabase/migrations/20260924001500_cron_schedules.sql)
1. [`20260924001600_storage.sql`](../supabase/migrations/20260924001600_storage.sql)
1. [`20260924001700_service_wrappers.sql`](../supabase/migrations/20260924001700_service_wrappers.sql)
1. [`20260924002000_integrations_runtime.sql`](../supabase/migrations/20260924002000_integrations_runtime.sql)
1. [`20260924002001_integrations_runtime_validate.sql`](../supabase/migrations/20260924002001_integrations_runtime_validate.sql)
1. [`20260924002100_approvals_reminders_runtime.sql`](../supabase/migrations/20260924002100_approvals_reminders_runtime.sql)
1. [`20260924002101_approvals_origin_validate.sql`](../supabase/migrations/20260924002101_approvals_origin_validate.sql)
1. [`20260924002200_billing_sync.sql`](../supabase/migrations/20260924002200_billing_sync.sql)
1. [`20260924002210_referrals.sql`](../supabase/migrations/20260924002210_referrals.sql)
1. [`20260924002220_public_api.sql`](../supabase/migrations/20260924002220_public_api.sql)
1. [`20260924002290_validate_business_constraints.sql`](../supabase/migrations/20260924002290_validate_business_constraints.sql)
1. [`20260924002300_admin_api_contract_bridge.sql`](../supabase/migrations/20260924002300_admin_api_contract_bridge.sql)
1. [`20260924002400_ai_pipeline_functions.sql`](../supabase/migrations/20260924002400_ai_pipeline_functions.sql)
1. [`20260924002410_prompt_versions_seed.sql`](../supabase/migrations/20260924002410_prompt_versions_seed.sql)
1. [`20260924002500_privacy_engine.sql`](../supabase/migrations/20260924002500_privacy_engine.sql)
1. [`20260924002510_retention_triggers.sql`](../supabase/migrations/20260924002510_retention_triggers.sql)
1. [`20260924002590_validate_privacy_constraints.sql`](../supabase/migrations/20260924002590_validate_privacy_constraints.sql)
1. [`20260924002600_ai_pipeline_part2.sql`](../supabase/migrations/20260924002600_ai_pipeline_part2.sql)
1. [`20260924002610_prompt_versions_seed_part2.sql`](../supabase/migrations/20260924002610_prompt_versions_seed_part2.sql)
1. [`20260924002690_ai_pipeline_part2_validate.sql`](../supabase/migrations/20260924002690_ai_pipeline_part2_validate.sql)
1. [`20260924002700_referral_loop_edges.sql`](../supabase/migrations/20260924002700_referral_loop_edges.sql)
1. [`20260924003000_admin_contract_gaps.sql`](../supabase/migrations/20260924003000_admin_contract_gaps.sql)
1. [`20260924003300_gap_closure.sql`](../supabase/migrations/20260924003300_gap_closure.sql)
1. [`20260924003400_capability_calendar_freebusy.sql`](../supabase/migrations/20260924003400_capability_calendar_freebusy.sql)
1. [`20260924003410_calendar_event_merge.sql`](../supabase/migrations/20260924003410_calendar_event_merge.sql)
1. [`20260924003440_calendar_event_merge_validate.sql`](../supabase/migrations/20260924003440_calendar_event_merge_validate.sql)

### Tables (`public`)

81 tables, grouped by the migration that creates them. **Client access** is what a signed-in user (`authenticated`) can do through PostgREST: the column grant **and** a permissive policy are both required. "own rows" is `(select auth.uid()) = user_id`; "none (SYS)" means no client grant: only `service_role` (Edge Functions) and security-definer functions reach the table. Every table has RLS enabled and forced; `anon` has no grant anywhere.

#### identity settings (20260924000200)

Created in [`20260924000200_identity_settings.sql`](../supabase/migrations/20260924000200_identity_settings.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `profiles` | App profile and account state; created by private.handle_new_user() on auth.users insert (M§88, M§130). | 18 | **read** own rows · `user_id`, `display_name`, `avatar_path`, `locale`, `state`, `onboarding_step`, `onboarding_completed_at`, `terms_accepted_at`, `terms_version`, `created_at`, `updated_at`<br>**update** own rows · `display_name`, `avatar_path`, `locale`, `onboarding_step`, `onboarding_completed_at`, `terms_accepted_at`, `terms_version` |  |
| `user_preferences` | Timezone (the only source of the user timezone), briefing schedule, appearance, retention, AI access and personalization (M§9–12, §32, §38–41). | 37 | **read** own rows · all columns<br>**update** own rows · all columns except `user_id`, `first_analysis_job_id`, `created_at`, `updated_at` |  |
| `notification_preferences` | Categories, quiet hours (22:30–07:30, VIP bypass on; R-13), lock-screen privacy, detail level and the non-critical daily cap (5; R-14) for the decision engine. | 27 | **read** own rows · all columns<br>**update** own rows · all columns except `user_id`, `snooze_until`, `created_at`, `updated_at` |  |
| `app_installations` | One row per app install: platform/version for observability (M§110), device hash for referral anti-abuse (M§45), Android NI grant state. | 21 | **read** own rows · `id`, `user_id`, `installation_id`, `platform`, `app_version`, `push_enabled`, `ni_listener_granted`, `ni_mode`, `ni_allowed_packages`, `ni_last_signal_at`, `platform_capabilities`, `last_seen_at`, `created_at` |  |
| `push_tokens` | Expo push tokens per installation (ADR-10); the token itself is never returned to clients or admins. | 9 | **read** own rows · all columns except `expo_push_token`, `updated_at` |  |

<details><summary>Columns</summary>

- `profiles`: user_id, display_name, avatar_path, locale, state, disabled_at, disabled_reason, disabled_by, onboarding_step, onboarding_completed_at, terms_accepted_at, terms_version, last_active_at, apple_sub_hash, is_demo, is_internal, created_at, updated_at
- `user_preferences`: user_id, timezone, theme, reduce_motion, haptics_enabled, retention_policy, learn_from_interactions, ai_data_access, interest_categories, morning_enabled, morning_time, midday_enabled, midday_time, evening_enabled, evening_time, weekly_enabled, weekly_dow, weekly_time, briefing_weekdays, weekend_morning_time, weekend_morning_only, working_hours_start, working_hours_end, dismissed_gates, timezone_mode, weekend_personal_first, work_days, default_write_calendar_id, default_reply_tone, default_task_destination, default_reminder_destination, follow_up_after_days, analytics_opt_out, screen_protection, first_analysis_job_id, created_at, updated_at
- `notification_preferences`: user_id, smart_filter, morning, midday, evening, critical_email, meeting, deadline, follow_up, life_intel, approval, account, quiet_hours_enabled, quiet_start, quiet_end, quiet_days, vip_bypass_quiet, detail_level, lock_screen_private, daily_cap, snooze_until, meeting_prep_lead_min, os_permission, os_permission_updated_at, prompt_deferred_count, created_at, updated_at
- `app_installations`: id, user_id, installation_id, platform, os_version, app_version, build_number, device_model, locale, timezone, push_enabled, ni_listener_granted, ni_mode, ni_allowed_packages, ni_last_signal_at, platform_capabilities, device_hash, last_seen_at, signed_out_at, created_at, updated_at
- `push_tokens`: id, user_id, installation_id, expo_push_token, status, disabled_reason, last_registered_at, created_at, updated_at

</details>

#### integrations (20260924000300)

Created in [`20260924000300_integrations.sql`](../supabase/migrations/20260924000300_integrations.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `connected_accounts` | Provider accounts connected for integration (separate from login): granted capabilities, per-account data-source toggles and sync health (M§75–76, §88; ADR-07). | 27 | **read** own rows · all columns |  |
| `oauth_credentials` | AES-256-GCM encrypted provider tokens and the Apple SIWA refresh token (ADR-05). System table: invisible to clients, decrypted only in Edge Functions. | 17 | none (SYS) |  |
| `oauth_states` | Single-use PKCE state (10 min) plus the R-07 completion binding (device nonce + one-time completion code). System table. | 24 | none (SYS) |  |
| `calendars` | Provider and device calendars; the user selects which are analysed (Free: 1 selected calendar via plan_limits.max_calendars). | 14 | **read** own rows · all columns<br>**update** own rows · `selected` |  |
| `sync_states` | Per (account, resource) cursor, health, backfill window and watch/subscription state (M§117, ADR-07). Owners read it only through connected_account_sync_health. | 36 | **read** own rows · `id`, `user_id`, `connected_account_id`, `calendar_id`, `resource`, `status`, `last_incremental_sync_at`, `last_success_at`, `last_error_code`, `last_error_at`, `created_at`, `updated_at` |  |
| `provider_quota_usage` | Token buckets per account and project for provider quotas (Gmail units, Graph requests); consumed via private.consume_provider_quota. System table. | 12 | none (SYS) |  |
| `webhook_events` | Replay dedupe and ingest ledger for provider and RevenueCat webhooks; content-free payload. System table. | 11 | none (SYS) |  |

<details><summary>Columns</summary>

- `connected_accounts`: id, user_id, provider, provider_account_id, account_email, display_label, tenant_type, tenant_id, status, status_reason, granted_scopes, capabilities_granted, data_source_toggles, analysis_window_days, connected_at, last_sync_at, last_successful_sync_at, last_error_at, last_error_code, reauth_required_at, disconnected_at, revocation_mode, credential_expires_at, pending_binding_until, demo_flavor, created_at, updated_at
- `oauth_credentials`: id, user_id, connected_account_id, provider, token_kind, key_version, iv, ciphertext, aad_hash, access_expires_at, scope_snapshot, refresh_lock_until, refresh_lock_owner, client_id_hint, rotated_at, created_at, updated_at
- `oauth_states`: id, user_id, state_hash, provider, purpose, connected_account_id, requested_capabilities, requested_scopes, code_verifier_iv, code_verifier_ciphertext, key_version, nonce_hash, return_to, expires_at, used_at, device_nonce_hash, completion_code_hash, approval_id, token_ciphertext, token_iv, result, error_code, completed_at, created_at
- `calendars`: id, user_id, connected_account_id, provider, provider_calendar_id, name, color, time_zone, access_role, is_primary, selected, can_write, created_at, updated_at
- `sync_states`: id, user_id, connected_account_id, calendar_id, resource, resource_key, cursor, status, cursor_invalidated_at, last_full_sync_at, last_incremental_sync_at, last_success_at, last_error_code, last_error_at, consecutive_failures, backfill_until, backfill_cursor, window_start, window_end, rebaseline_due_at, watch_kind, watch_id, watch_resource_id, watch_token_hash, watch_history_id, watch_expires_at, watch_renew_after, lifecycle_last_event, lifecycle_last_at, page_token, next_poll_at, lease_owner, lease_expires_at, stats, created_at, updated_at
- `provider_quota_usage`: id, bucket, connected_account_id, user_id, provider, window_start, window_seconds, units_used, units_limit, request_count, throttled_count, updated_at
- `webhook_events`: id, source, external_id, user_id, connected_account_id, signature_valid, status, job_id, payload_digest, payload, received_at

</details>

#### content (20260924000400)

Created in [`20260924000400_content.sql`](../supabase/migrations/20260924000400_content.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `contacts` | People resolved from mail, calendar and manual entry (M§30); pruned by retention unless VIP, manual or tied to an open commitment. | 20 | **read** own rows · all columns<br>**insert** own rows where `origin = 'manual'` · `user_id`, `display_name`, `primary_email`, `emails`, `avatar_seed`, `origin`<br>**update** own rows · `display_name`, `organization` |  |
| `vip_people` | User-marked important people with a relationship group (M§30); rows may exist on Free, effects apply only for Pro (M§44). | 10 | **read** own rows · all columns<br>**insert** own rows · all columns except `id`, `created_at`, `updated_at`<br>**update** own rows · `relationship`, `always_notify`, `bypass_quiet_hours`, `note`<br>**delete** own rows |  |
| `email_threads` | Thread-level mail intelligence: category, reply state, summary, deadline (M§14–17). No body columns. | 40 | **read** own rows · all columns except `analysis_hash` |  |
| `email_messages` | Message metadata, triage and classification. There is no body column: "Orijinal Mail" is fetched on demand and never stored (ADR-05). | 48 | **read** own rows · all columns except `references_ids`, `content_hash` |  |
| `calendar_events` | Normalized events from Google, Graph, EventKit and CalendarContract snapshots (M§19–22); writes happen only through approvals. | 37 | **read** own rows · all columns | restrictive `calendar_events_hide_merged` (`merged_into_id is null`) |
| `tasks` | Google Tasks, Microsoft To Do, Apple Reminders snapshots and in-app tasks (M§19, §75); provider tasks change only through approvals. | 25 | **read** own rows · all columns<br>**insert** own rows where `connected_account_id is null and origin = 'user' and approval_action_id is null` · `user_id`, `title`, `notes_excerpt`, `due_date`, `due_at`, `status`, `origin`<br>**update** own rows where `connected_account_id is null` · `title`, `notes_excerpt`, `due_date`, `due_at`, `status`, `completed_at`<br>**delete** own rows where `connected_account_id is null` |  |
| `commitments` | Detected or user-confirmed promises ("Cuma gönderirim.") with verified evidence (M§18, §22, §83). | 27 | **read** own rows · all columns<br>**update** own rows · `due_at`, `due_is_date_only`, `status`, `snoozed_until`, `completed_at`, `cancelled_at` |  |
| `reminders` | Smart reminders created through the reminder sheet (M§29); external destinations go through approvals. | 27 | **read** own rows · all columns |  |
| `meeting_notes` | "Not Al" prep notes and post-meeting text or voice transcripts (SREQ-22, M§22); audio is never stored. | 11 | **read** own rows · all columns<br>**update** own rows · `body`<br>**delete** own rows |  |
| `meeting_preps` | Meeting Prep artifact and "2 Dakikalık Özet" (M§21); precomputed at T-60 only for external/VIP meetings (R-23). | 31 | **read** own rows · all columns except `input_hash` |  |
| `life_events` | Shipment, flight, reservation, payment, subscription and security cards (M§23); amounts and dates only with evidence. | 27 | **read** own rows · all columns<br>**update** own rows · `status`, `snoozed_until`, `resolved_at`, `suppressed` |  |
| `captures` | Universal Capture (photo, screenshot, pdf, file, link, text, share; M§27–28, §85); files live in the private captures bucket. | 28 | **read** own rows · all columns<br>**update** own rows where `status = 'discarded'` · `status` |  |
| `android_notification_signals` | Structured, on-device-extracted Android notification signals only; raw notification text is never uploaded (ADR-12, M§36). | 18 | **read** own rows · all columns<br>**delete** own rows |  |

<details><summary>Columns</summary>

- `contacts`: id, user_id, display_name, primary_email, emails, organization, title, title_evidence, avatar_seed, first_seen_at, last_contact_at, last_inbound_at, last_outbound_at, message_count_30d, meeting_count_30d, origin, merged_into_id, search_tsv, created_at, updated_at
- `vip_people`: id, user_id, contact_id, relationship, always_notify, bypass_quiet_hours, note, origin, created_at, updated_at
- `email_threads`: id, user_id, connected_account_id, provider, provider_thread_id, subject, participants, message_count, last_message_at, last_inbound_at, last_outbound_at, has_unread, category, category_tier, category_reason, category_rule_id, category_learned_preference_id, category_confidence, urgency, reply_state, ai_summary, key_points, deadline_at, deadline_evidence, labels, web_link, is_muted, analysis_hash, analyzed_at, prompt_version_id, rolling_summary, last_processed_message_id, follow_up_state, awaiting_since, expects_reply_message_id, topic_label, search_tsv, expires_at, created_at, updated_at
- `email_messages`: id, user_id, connected_account_id, thread_id, provider, provider_message_id, internet_message_id, in_reply_to, references_ids, direction, from_email, from_name, to_emails, cc_emails, subject, snippet, sent_at, received_at, is_read, importance, labels, has_attachments, attachment_meta, list_unsubscribe, auto_submitted, precedence_bulk, dkim_pass, spf_pass, content_hash, ai_status, injection_suspected, dropped_fields, life_signal, classification, classification_tier, classification_reason, classification_rule_id, classification_confidence, ai_summary, key_points, analyzed_at, prompt_version_id, provider_deleted_at, web_link, search_tsv, expires_at, created_at, updated_at
- `calendar_events`: id, user_id, connected_account_id, calendar_id, provider, provider_event_id, ical_uid, recurring_event_id, etag, title, description_excerpt, location, is_online, conference_url, start_at, end_at, all_day, start_date, end_date, time_zone, status, organizer_email, organizer_self, can_modify, attendees, attendee_count, origin, device_last_synced_at, da_approval_id, provider_updated_at, provider_deleted_at, search_tsv, expires_at, created_at, updated_at, merged_into_id, merge_sources
- `tasks`: id, user_id, connected_account_id, provider, provider_task_id, provider_list_id, title, notes_excerpt, due_date, due_at, status, completed_at, origin, approval_action_id, idempotency_key, source_type, source_id, source_provider, source_timestamp, confidence, evidence, search_tsv, expires_at, created_at, updated_at
- `commitments`: id, user_id, contact_id, counterparty_name, direction, text, due_at, due_is_date_only, status, snoozed_until, completed_at, cancelled_at, dedupe_key, origin, approval_action_id, calendar_event_id, source_type, source_id, source_provider, source_timestamp, confidence, evidence, user_overrides, search_tsv, expires_at, created_at, updated_at
- `reminders`: id, user_id, title, note, remind_at, preset, anchor_at, destination, origin, resolution_reason, channel, status, target_type, target_id, idempotency_key, approval_action_id, notification_id, delivered_at, cancelled_at, source_type, source_id, source_provider, source_timestamp, confidence, expires_at, created_at, updated_at
- `meeting_notes`: id, user_id, calendar_event_id, kind, body, input, processed_at, expires_at, created_at, updated_at, client_note_id
- `meeting_preps`: id, user_id, calendar_event_id, status, purpose, purpose_evidence, primary_contact_id, last_interaction, recent_email_ids, open_loops, user_commitment_ids, their_commitment_ids, relevant_files, talking_points, summary_2min, reading_time_sec, sources, input_hash, generated_at, model, prompt_version_id, ai_request_id, source_type, source_id, source_provider, source_timestamp, confidence, evidence, expires_at, created_at, updated_at
- `life_events`: id, user_id, type, title, status, snoozed_until, resolved_at, event_at, due_at, payload, amount, currency, amount_evidence, tracking_url, dedupe_key, suppressed, user_overrides, source_type, source_id, source_provider, source_timestamp, confidence, evidence, search_tsv, expires_at, created_at, updated_at
- `captures`: id, user_id, kind, status, storage_path, mime_type, size_bytes, sha256, original_filename, source_url, final_url, text_content, page_count, extracted, extracted_types, primary_type, share_origin, progress, file_deleted_at, idempotency_key, error_code, analyzed_at, ai_request_id, search_tsv, expires_at, created_at, updated_at, link_preview
- `android_notification_signals`: id, user_id, installation_id, package_name, app_label, category, amount, currency, due_date, tracking_status, flight_no, gate, posted_at, signal_hash, extractor_version, life_event_id, expires_at, created_at

</details>

#### intelligence (20260924000500)

Created in [`20260924000500_intelligence.sql`](../supabase/migrations/20260924000500_intelligence.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `prompt_versions` | Versioned prompts with activate/rollback (M§58); one active version per key; content immutable once not draft. System table. | 20 | none (SYS) | restrictive `prompt_versions_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `priority_rules` | Explicit rules, the first tier of the priority engine (M§31); soft-deleted for the 10 s "Geri al" window. | 15 | **read** own rows · all columns<br>**insert** own rows · `user_id`, `condition_type`, `condition_value`, `outcome`, `search_body`, `exceptions`, `applies_to`, `enabled`, `sort_order`<br>**update** own rows · `condition_value`, `outcome`, `search_body`, `exceptions`, `applies_to`, `enabled`, `sort_order`, `deleted_at` |  |
| `learned_preferences` | AI-learned personalization, separate from explicit rules (M§32); written only while learn_from_interactions is on. | 20 | **read** own rows · all columns<br>**update** own rows · `priority_override`, `enabled`, `deleted_at` |  |
| `insights` | Every user-facing AI or deterministic finding for Today, Flow, follow-ups, conflicts and schedule suggestions, with provenance (M§8, §13, §131). | 35 | **read** own rows · all columns<br>**update** own rows · `status`, `snoozed_until`, `done_at`, `dismissed_at` |  |
| `briefings` | Morning, midday, evening and weekly briefings incl. audio and weekly stats (M§9–12, §54); one per (user, kind, local_date). | 37 | **read** own rows · all columns<br>**update** own rows · `opened_at` |  |
| `briefing_items` | Source-linked lines of a briefing (M§9, §97). | 21 | **read** own rows · all columns |  |
| `reply_drafts` | AI reply and follow-up drafts kept in our DB (no provider drafts, no gmail.compose; ADR-07, M§16–17). | 30 | **read** own rows · all columns |  |
| `ai_feedback` | Thumbs, "Önemli değil" and correction signals (M§32, §59); learned preferences derive from these rows. | 15 | **read** own rows · all columns<br>**insert** own rows · `user_id`, `feature`, `target_type`, `target_id`, `rating`, `reason_code`, `comment`, `detail`, `client_mutation_id`<br>**update** own rows · `rating`, `reason_code`, `comment`<br>**delete** own rows |  |
| `ai_requests` | Per-call AI telemetry without any content (ADR-08, M§56, §82, §126). System table. | 46 | none (SYS) |  |
| `ai_usage_daily` | Per-user AI budget accounting on the local day (Free "AI analiz limiti 50/gün"; Pro "Adil kullanım"). | 13 | **read** own rows · all columns |  |
| `ai_model_config` | Backoffice-editable routing per (profile, role, feature) (R-02, R-18); model IDs are config, never code. System table. | 20 | none (SYS) | restrictive `ai_model_config_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `ai_result_cache` | Per-user dedupe of validated, grounded AI results keyed by a per-user HMAC content hash (R-02, M§82). System table. | 11 | none (SYS) |  |
| `ai_budget_reservations` | Open budget holds between ai_budget_reserve and ai_budget_settle so concurrent calls cannot overshoot caps. System table. | 11 | none (SYS) |  |
| `ai_model_prices` | Provider price book feeding ai_requests.cost_usd_micros and budget estimates (AI_PIPELINE_PLAN §8.13). System table. | 14 | none (SYS) | restrictive `ai_model_prices_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `ai_calibration_versions` | Confidence-calibration models per feature and field (AI_PIPELINE_PLAN §6.7), refit weekly by ai_eval. System table. | 11 | none (SYS) | restrictive `ai_calibration_versions_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `ai_batches` | Message Batch lifecycle for non-urgent AI work (submit, collect, purge; AI_PIPELINE_PLAN §8.8). System table. | 12 | none (SYS) |  |

<details><summary>Columns</summary>

- `prompt_versions`: id, prompt_key, version, status, system_prompt, user_template, output_schema_ref, schema_hash, model_role, model_constraints, eval_dataset_version, eval_report, eval_passed, notes, changelog, created_by, activated_by, activated_at, archived_at, created_at
- `priority_rules`: id, user_id, condition_type, condition_value, outcome, search_body, exceptions, applies_to, enabled, sort_order, match_count_30d, last_matched_at, deleted_at, created_at, updated_at
- `learned_preferences`: id, user_id, group_key, statement, target_type, target_ref, effect, priority_override, evidence_count, evidence_summary, origin, enabled, deleted_at, source_type, source_id, source_provider, source_timestamp, confidence, created_at, updated_at
- `insights`: id, user_id, kind, urgency, status, title, body, why_important, decision_tier, reason_code, rule_id, learned_preference_id, entity_type, entity_id, flow_card_type, actions, due_at, event_at, rank_score, snoozed_until, done_at, dismissed_at, suppression_key, user_overrides, dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence, evidence, expires_at, created_at, updated_at, payload
- `briefings`: id, user_id, kind, local_date, time_zone, scheduled_for, status, skipped_reason, generated_at, delivered_at, opened_at, failed_at, error_code, headline, hero_line, narrative, sections, counts, provenance, audio_status, audio_engine, audio_storage_path, audio_duration_s, audio_chapters, evening_ready_at, origin, version, source_freshness, weekly_stats, idempotency_key, job_id, prompt_version_id, ai_cost_usd_micros, latency_ms, expires_at, created_at, updated_at
- `briefing_items`: id, user_id, briefing_id, section, position, insight_id, entity_type, entity_id, title, meta, badge, carried_over_to, done_at, source_type, source_id, source_provider, source_timestamp, confidence, evidence, expires_at, created_at
- `reply_drafts`: id, user_id, thread_id, message_id, connected_account_id, kind, tone, to_emails, cc_emails, subject, body, version, status, generated_by, approval_action_id, ai_request_id, prompt_version_id, attachments, source_type, source_id, source_provider, source_timestamp, confidence, expires_at, created_at, updated_at, language, warnings, facts_used, content_key
- `ai_feedback`: id, user_id, feature, target_type, target_id, rating, reason_code, comment, detail, client_mutation_id, model, prompt_version_id, ai_request_id, created_at, updated_at
- `ai_requests`: id, user_id, plan, profile, feature, tier, provider, model, prompt_version_id, schema_name, schema_hash, feature_variant, operation, batch, batch_id, status, error_code, http_status, provider_request_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_write_1h_tokens, reasoning_tokens, audio_seconds, characters, units_charged, latency_ms, ttft_ms, retry_count, fallback_used, fallback_from_model, inference_geo, cost_usd_micros, source_type, source_count, content_hash, grounding_proposed, grounding_verified, grounding_dropped, citation_coverage, injection_suspected, correlation_id, job_id, created_at
- `ai_usage_daily`: user_id, local_date, feature, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros, units_used, reserved_usd_micros, reserved_units, updated_at
- `ai_model_config`: id, profile, role, feature, tier, provider, model, params, fallback_targets, escalation_target, batch_policy, cache_ttl, max_input_tokens, eval_status, retires_not_before, enabled, version, updated_by, created_at, updated_at
- `ai_result_cache`: id, user_id, feature, content_hash, prompt_version_id, model, result, hit_count, last_hit_at, created_at, expires_at
- `ai_budget_reservations`: id, user_id, local_date, feature, est_cost_usd_micros, units, level, hold_until, settled_at, ai_request_id, created_at
- `ai_model_prices`: id, provider, model, input_per_mtok_usd, output_per_mtok_usd, cache_write_5m_per_mtok_usd, cache_write_1h_per_mtok_usd, cache_read_per_mtok_usd, batch_discount, audio_per_min_usd, chars_per_million_usd, effective_from, updated_by, created_at
- `ai_calibration_versions`: id, feature, field, version, method, params, ece, status, activated_by, activated_at, created_at
- `ai_batches`: id, provider, batch_id, feature, status, request_count, submitted_at, ended_at, collected_at, purged_at, correlation_id, created_at

</details>

#### approvals (20260924000600)

Created in [`20260924000600_approvals.sql`](../supabase/migrations/20260924000600_approvals.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `approval_actions` | Every side-effecting action proposed by AI or the user; clients never insert (they propose through api) and only private.transition_approval / edit_approval_payload change guarded columns (M§33, §115; ADR-09). | 44 | **read** own rows · all columns except `device_token_hash` |  |
| `approval_events` | Immutable transition history of approvals (M§33); removed only together with its approval or its user. | 12 | **read** own rows · all columns | append-only: no UPDATE or DELETE, not even for `service_role` |

<details><summary>Columns</summary>

- `approval_actions`: id, user_id, action_type, status, payload, payload_version, payload_hash, what, why, change_summary, side_effects, destination_account_id, destination_label, idempotency_key, provider_idempotency_ref, origin, origin_ref_id, requires_scope, approved_via, exact_change, batch_id, executor, device_installation_id, device_token_hash, approval_expires_at, approved_at, rejected_at, rejection_reason, executing_at, executed_at, failed_at, attempt_count, last_error_code, last_error_message, result, source_type, source_id, source_provider, source_timestamp, confidence, evidence, expires_at, created_at, updated_at
- `approval_events`: id, user_id, approval_action_id, from_status, to_status, actor, actor_id, payload_version, idempotency_key, reason, correlation_id, created_at

</details>

#### assistant memory (20260924000700)

Created in [`20260924000700_assistant_memory.sql`](../supabase/migrations/20260924000700_assistant_memory.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `assistant_threads` | Assistant conversations, global or person/meeting scoped ("Mehmet hakkında sor…"). | 12 | **read** own rows · all columns<br>**update** own rows · `title`, `archived_at`<br>**delete** own rows |  |
| `assistant_messages` | Assistant messages with citations and proposed approvals (M§24–25); conversation content, never sent to analytics. | 19 | **read** own rows · all columns |  |
| `memory_chunks` | Derived retrieval index for AI memory and hybrid search (M§26, §95): facts and summaries only, never full bodies; embeddings are deleted with the row. | 21 | **read** own rows · all columns except `embedding`, `embedding_dr` |  |

<details><summary>Columns</summary>

- `assistant_threads`: id, user_id, title, scope, scope_ref_id, last_message_at, message_count, archived_at, expires_at, created_at, updated_at, client_thread_id
- `assistant_messages`: id, user_id, thread_id, role, content, cards, citations, proposed_approval_ids, followup_suggestions, status, grounded, input_channel, client_message_id, finish_reason, model, prompt_version_id, ai_request_id, expires_at, created_at
- `memory_chunks`: id, user_id, source_type, source_id, source_provider, source_timestamp, confidence, chunk_kind, content, content_hash, embedding, embedding_model, embedded_at, embedding_dr, tsv, page_no, contact_ids, occurred_at, expires_at, created_at, updated_at

</details>

#### notifications (20260924000800)

Created in [`20260924000800_notifications.sql`](../supabase/migrations/20260924000800_notifications.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `notifications` | Notification decision ledger: every candidate push with its decision and suppression reason (M§86, §132; ADR-10). | 25 | **read** own rows · all columns<br>**update** own rows · `opened_at` |  |
| `push_tickets` | Expo push ticket and receipt tracking (ADR-10). System table. | 10 | none (SYS) |  |

<details><summary>Columns</summary>

- `notifications`: id, user_id, category, decision, suppression_reason, dedupe_key, priority, detail_mode, title_rendered, body_rendered, data, entity_type, entity_id, interruption_level, android_channel, scheduled_for, sent_at, opened_at, failed_at, error_code, job_id, correlation_id, is_test, expires_at, created_at
- `push_tickets`: id, user_id, notification_id, push_token_id, expo_ticket_id, status, error_code, sent_at, receipt_checked_at, created_at

</details>

#### business (20260924000900)

Created in [`20260924000900_business.sql`](../supabase/migrations/20260924000900_business.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `subscriptions` | RevenueCat mirror: every webhook triggers a REST v2 refetch and the row is overwritten (ADR-11). | 26 | **read** own rows · `user_id`, `entitlement`, `is_active`, `status`, `store`, `product_id`, `period_type`, `expires_at`, `will_renew`, `billing_issue_at`, `synced_at` |  |
| `billing_events` | Raw RevenueCat webhook ledger deduplicated on event_id (M§60); kept 3 years. System table. | 16 | none (SYS) | restrictive `billing_events_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `referral_codes` | One shareable referral code per user (M§45): 6 payload characters + 1 check character, 31-symbol alphabet. | 4 | **read** own rows · all columns |  |
| `referrals` | Referral lifecycle and anti-abuse record with hashed signals only (M§45; plan §16). System table. | 20 | none (SYS) |  |
| `entitlement_grants` | Referral, admin, support and compensation Pro grants, stacked and kept separate from store state (M§43, §61; ADR-11). | 15 | **read** own rows · all columns |  |
| `referral_credits` | Idempotent referral reward records, one per (referral, side) (M§45, §116). | 8 | **read** own rows · all columns |  |
| `plan_limits` | Free/Pro limits, AI budgets, routing profile and feature switches used by server gates (M§44, §82; R-22). Editable in backoffice Settings, never hard-coded. | 5 | **read** all rows · all columns |  |

<details><summary>Columns</summary>

- `subscriptions`: user_id, entitlement, rc_app_user_id, is_active, status, store, environment, product_id, period_type, purchased_at, original_purchased_at, expires_at, will_renew, unsubscribe_detected_at, billing_issue_at, grace_expires_at, refunded_at, cancel_reason, expiration_reason, is_family_share, last_event_id, last_event_type, trial_reminder_at, synced_at, created_at, updated_at
- `billing_events`: id, event_id, user_id, rc_app_user_id, event_type, environment, store, product_id, event_timestamp, transferred_from, transferred_to, payload, process_status, processed_at, job_id, received_at
- `referral_codes`: user_id, code, disabled_at, created_at
- `referrals`: id, referrer_id, referee_id, code, status, applied_at, qualified_at, rewarded_at, rejected_at, reject_reason, risk_score, risk_signals, referee_device_hash, referee_email_hash, qualification, reviewed_by_admin_id, reviewed_at, review_reason, created_at, updated_at
- `entitlement_grants`: id, user_id, entitlement, source, starts_at, ends_at, duration_days, reason, granted_by_admin_id, referral_credit_id, idempotency_key, revoked_at, revoked_by_admin_id, revoke_reason, created_at
- `referral_credits`: id, referral_id, user_id, side, days, entitlement_grant_id, idempotency_key, created_at
- `plan_limits`: plan, key, value, updated_by, updated_at

</details>

#### ops product (20260924001000)

Created in [`20260924001000_ops_product.sql`](../supabase/migrations/20260924001000_ops_product.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `jobs` | First-party job queue: idempotent keys, leases, backoff with jitter, dead letter (ADR-04, M§53, §127). System table. | 24 | none (SYS) | restrictive `jobs_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `job_attempts` | Per-attempt job history with sanitized errors (M§53). System table. | 11 | none (SYS) |  |
| `analytics_events` | First-party, allow-listed, content-free product analytics (M§42, §119; ADR-13). System table. | 10 | none (SYS) |  |
| `feature_flags` | Flags and kill switches with targeting (M§63); evaluated by private.evaluate_flags and returned by /me/bootstrap. System table. | 14 | none (SYS) |  |
| `feature_flag_overrides` | Per-user flag overrides for support and QA (reason required). System table. | 8 | none (SYS) |  |
| `announcements` | In-app announcements (M§64, R-25), delivered through /me/bootstrap with server-side targeting. System table. | 19 | none (SYS) |  |
| `announcement_dismissals` | Per-user dismissals of announcement banner cards. | 3 | **read** own rows · all columns<br>**insert** own rows · all columns except `dismissed_at` |  |
| `user_feedback` | In-app product feedback (M§62). System table. | 14 | none (SYS) |  |
| `system_health_checks` | Real probe results; never a fake green status (M§67). System table. | 7 | none (SYS) | restrictive `system_health_checks_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `rate_limits` | Fixed-window counters for api, public-api and admin-api (public.rate_limit_hit). System table. | 3 | none (SYS) |  |
| `api_idempotency_keys` | HTTP Idempotency-Key store for api routes incl. offline-queue replays (API_CONTRACTS §2.11); no bodies. System table. | 9 | none (SYS) |  |
| `app_settings` | System configuration edited in backoffice Settings (session policy, metrics, referral, Support Access bounds, caps, pricing display). System table. | 5 | none (SYS) | restrictive `app_settings_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `metrics_daily` | Anonymous daily rollups for backoffice 30d/90d views that survive retention purges (M§50, §119). System table. | 9 | none (SYS) | restrictive `metrics_daily_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `ai_metrics_daily` | Daily AI aggregates for /ai views and AI COGS review (AI_PIPELINE_PLAN §8.14). System table. | 20 | none (SYS) | restrictive `ai_metrics_daily_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `web_analytics_daily` | Counter-only analytics of the marketing site: no row per visit, no user id, no IP. System table. | 5 | none (SYS) |  |

<details><summary>Columns</summary>

- `jobs`: id, type, status, priority, user_id, connected_account_id, payload, idempotency_key, run_after, attempts, max_attempts, lease_owner, lease_expires_at, last_error_code, last_error_message, correlation_id, parent_job_id, progress, result, started_at, completed_at, dead_lettered_at, created_at, updated_at
- `job_attempts`: id, job_id, attempt, user_id, worker_id, started_at, finished_at, outcome, error_code, error_message, duration_ms
- `analytics_events`: id, user_id, installation_id, session_id, event_name, props, platform, app_version, occurred_at, received_at
- `feature_flags`: key, description, enabled, is_kill_switch, rollout_percentage, platforms, plans, min_app_version, max_app_version, payload, updated_by, created_at, updated_at, archived_at
- `feature_flag_overrides`: id, flag_key, user_id, value, reason, expires_at, created_by_admin_id, created_at
- `announcements`: id, title_tr, title_en, body_tr, body_en, audience, platforms, min_app_version, max_app_version, starts_at, ends_at, severity, cta_deeplink, published_at, cancelled_at, created_by, updated_by, created_at, updated_at
- `announcement_dismissals`: user_id, announcement_id, dismissed_at
- `user_feedback`: id, user_id, type, rating, message, contact_email, diagnostics_consent, diagnostics, platform, app_version, status, assigned_admin_id, created_at, updated_at
- `system_health_checks`: id, component, status, latency_ms, detail, checked_by, checked_at
- `rate_limits`: key, window_start, count
- `api_idempotency_keys`: user_id, key, route, fingerprint, state, response_status, resource_ref, created_at, expires_at
- `app_settings`: key, value, description, updated_by, updated_at
- `metrics_daily`: day, metric_key, dim1, dim2, dim3, value, value_sum, latency_hist, computed_at
- `ai_metrics_daily`: id, day, feature, provider, model, prompt_version_id, plan, profile, status, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, units_charged, cost_usd_micros, grounding_proposed, grounding_dropped, latency_hist, computed_at
- `web_analytics_daily`: day, event, dims_hash, dims, count

</details>

#### privacy (20260924001100)

Created in [`20260924001100_privacy.sql`](../supabase/migrations/20260924001100_privacy.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `data_export_requests` | Async user export (M§128): JSON per entity in a private bucket, 24 h availability; never tokens, hashes or embeddings. | 15 | **read** own rows · all columns |  |
| `data_deletion_requests` | History and account deletion lifecycle with honest status (M§129); the row survives account deletion via subject_hash (kept 3 years). | 21 | **read** own rows · all columns except `subject_hash`, `subject_email_hash`, `status_token_hash`, `notify_email_ciphertext`, `notify_locale` |  |
| `privacy_tombstones` | Hashed anti-abuse signals kept 12 months after account deletion, never linked to a user id (plan §16). System table. | 6 | none (SYS) |  |

<details><summary>Columns</summary>

- `data_export_requests`: id, user_id, status, job_id, requested_via, storage_path, file_size_bytes, sha256, ready_at, expires_at, downloaded_at, error_code, created_at, updated_at, include
- `data_deletion_requests`: id, user_id, subject_hash, subject_email_hash, kind, status, origin, confirmation_method, scope, connected_account_id, status_token_hash, reason, steps, job_id, completed_at, failed_at, error_code, created_at, updated_at, notify_email_ciphertext, notify_locale
- `privacy_tombstones`: id, kind, signal_hash, reason, created_at, expires_at

</details>

#### admin audit (20260924001200)

Created in [`20260924001200_admin_audit.sql`](../supabase/migrations/20260924001200_admin_audit.sql).

| Table | Purpose (table comment) | Cols | Client access | Notes |
|---|---|---|---|---|
| `admin_users` | Dedicated admin identities (auth app_metadata.da_kind = admin; R-08) with role and status; disabled, never deleted. System table. | 19 | none (SYS) | restrictive `admin_users_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `admin_sessions` | Admin sessions with 30 min idle and 12 h absolute limits, validated and touched by private.require_admin (ADR-06). System table. | 13 | none (SYS) | restrictive `admin_sessions_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `admin_preferences` | Backoffice theme, locale, table and dashboard preferences per admin (M§72). System table. | 10 | none (SYS) |  |
| `admin_mfa_recovery_codes` | One-time MFA recovery codes for admins, stored as HMAC hashes only (BACKOFFICE_PLAN §3.4). System table. | 6 | none (SYS) | restrictive `admin_mfa_recovery_codes_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |
| `audit_logs` | Immutable, hash-chained record of sensitive actions (M§66); rows are appended only through private.audit_log_append and never deleted. | 17 | none (SYS) | restrictive `audit_logs_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`)<br>append-only: no UPDATE or DELETE, not even for `service_role` |
| `support_tickets` | Support tickets from app, web and email with display id DA-YYYY-###### (M§62, §69). | 19 | **read** own rows · `id`, `public_ref`, `user_id`, `category`, `status`, `subject`, `created_at`, `updated_at` |  |
| `support_notes` | Internal support notes, append-only (no update grant). System table. | 7 | none (SYS) | restrictive `support_notes_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`)<br>append-only: no UPDATE, not even for `service_role` |
| `support_access_grants` | Time-boxed, reasoned access to sensitive user content (M§49, §71; R-09); every reveal is audited. No impersonation. System table. | 13 | none (SYS) | restrictive `support_access_grants_admin_aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`) |

<details><summary>Columns</summary>

- `admin_users`: user_id, role, status, display_name, email, mfa_required, invited_by, invited_at, invite_token_hash, invite_expires_at, invite_redeemed_at, activated_at, disabled_at, disabled_by, disabled_reason, last_login_at, locked_until, created_at, updated_at
- `admin_sessions`: id, admin_user_id, auth_session_id, aal, created_at, last_activity_at, idle_expires_at, absolute_expires_at, step_up_at, ended_at, end_reason, ip_hash, user_agent
- `admin_preferences`: admin_user_id, theme, locale, table_prefs, dashboard_range, updated_at, timezone, density, recent_items, sidebar_collapsed
- `admin_mfa_recovery_codes`: id, admin_user_id, code_hash, created_at, used_at, replaced_at
- `audit_logs`: id, chain_seq, occurred_at, actor_type, actor_id, actor_role, action, target_type, target_id, target_user_id, reason, result, details, correlation_id, ip_hash, prev_hash, row_hash
- `support_tickets`: id, public_ref, user_id, category, status, priority, subject, message, contact_email, platform, app_version, origin, assigned_admin_id, first_response_at, resolved_at, closed_at, created_at, updated_at, contact_name
- `support_notes`: id, ticket_id, user_id, author_admin_id, body, created_at, kind
- `support_access_grants`: id, admin_user_id, user_id, ticket_id, scope, reason, starts_at, expires_at, revoked_at, revoked_by, expired_audited_at, reveal_count, created_at

</details>

### Views (`public`)

| View | Created in | Client access |
|---|---|---|
| `connected_account_sync_health` | `20260924000300_integrations.sql` | **read** rows the caller may see in the underlying tables (`security_invoker`) · all columns |

### `private` schema relations

Never exposed through PostgREST (only `public` and `admin_api` are). Reached by security-definer functions and, where granted, by `service_role`.

| Relation | Kind | Created in | Purpose | `service_role` |
|---|---|---|---|---|
| `demo_fixture_state` | table | `20260924000300_integrations.sql` | Real state changes of the demo adapter (DEMO_MODE only): sent replies, created events and tasks, without provider calls or fake success. | delete, insert, select, update |
| `admin_role_permissions` | table | `20260924001200_admin_audit.sql` | Role × permission matrix (BACKOFFICE_PLAN §4.1 strings, §4.2 matrix); private.require_admin looks permissions up here. | select |
| `admin_function_permissions` | view | `20260924001320_functions_admin_api.sql` | Static map of every admin_api function to its BACKOFFICE_PLAN §4.1 permission(s) and guard; pgTAP 120 is table-driven from it. | – |
| `device_snapshot_uploads` | table | `20260924002000_integrations_runtime.sql` | Accepted device calendar snapshots awaiting their device_calendar_ingest job (hashed native ids only; deleted once applied). | – |
| `audit_action_catalogue` | view | `20260924003000_admin_contract_gaps.sql` | BACKOFFICE_PLAN §10 audit action catalogue. App, worker and system rows outside the admin areas use the user.*, system.*, security.*, approval.* and privacy.* namespaces (private.audit_action_known). | – |

### Functions

EXECUTE as granted by the migrations (PostgreSQL grants EXECUTE to PUBLIC on a new function; the migrations revoke it). "Neither" functions are reached only from other definer functions, triggers or the database owner.

| Schema | Functions | `authenticated` (and `service_role`) | `service_role` only | Neither |
|---|---|---|---|---|
| `public` | 125 | 26 | 99 | 0 |
| `admin_api` | 145 | 141 | 4 | 0 |
| `private` | 230 | 14 | 83 | 133 |

**User RPCs** (`public`, called with the user's JWT; RLS and `auth.uid()` scope them): `apply_insight_feedback`, `calendar_event_canonical_id`, `check_plan_limit`, `dismiss_announcement`, `effective_entitlement`, `flow_feed`, `flow_meta`, `get_explanation`, `get_usage_summary`, `history_deletion_preview`, `list_approvals`, `mail_intelligence`, `mark_briefing_opened`, `memory_vector_candidates`, `person_intelligence`, `plan_range`, `plan_week_density`, `preview_priority_rule`, `revert_insight_feedback`, `search_user_content`, `set_commitment_status`, `set_insight_status`, `submit_ai_correction`, `today_overview`, `upsert_manual_contact`, `vip_suggestions`.

**Service-role wrappers and server helpers** (`public`; the Edge Functions call `private` logic through these): `account_can`, `account_deletion_begin`, `account_deletion_context`, `account_deletion_system_purge`, `account_paused_by_plan`, `acquire_sync_lease`, `ai_breaker_state`, `ai_budget_reserve`, `ai_budget_settle`, `ai_cost_by_model`, `ai_org_budget_evaluate`, `apply_device_snapshot`, `apply_mail_changes`, `apply_referral`, `apply_staged_device_snapshot`, `audit_log_append`, `audit_verify_chain`, `billing_apply_mirror`, `billing_mark_event`, `billing_sync_context`, `briefing_evening_ready`, `briefing_retry`, `cancel_reminder`, `claim_jobs`, `complete_job`, `consume_provider_quota`, `create_approval`, `create_deletion_request`, `create_export_request`, `deletion_request_update`, `demo_state_get`, `demo_state_record_write`, `demo_state_set_clock`, `discard_capture`, `disconnect_integration`, `edit_approval_payload`, `enqueue_job`, `ensure_referral_code`, `evaluate_flag`, `evaluate_flags`, `extend_job_lease`, `fail_job`, `first_analysis_counts`, `grant_entitlement`, `hash_subject`, `history_deletion_counts`, `integration_purge_batch`, `link_contact_refs`, `mark_calendar_events_deleted`, `memory_stats`, `next_morning_briefing_at`, `oauth_callback_store`, `oauth_close_flow`, `oauth_complete_binding`, `plan_limit`, `privacy_tombstones_upsert`, `prune_calendar_events`, `pseudonymize_audit_subject`, `public_deletion_status`, `public_deletion_subject`, `public_otp_lock_seconds`, `public_otp_record_failure`, `public_plans`, `public_referral_resolve`, `public_subscription_active`, `public_support_ticket`, `purge_history`, `purge_user_history`, `rate_limit_hit`, `recompute_expires_at`, `record_billing_event`, `referral_apply_context`, `referral_decide`, `referral_evaluation_context`, `referral_overview`, `referral_tombstone_match`, `refresh_contact_stats`, `release_sync_lease`, `retention_cleanup`, `retention_orphan_objects`, `retention_system_sweep`, `reward_referral`, `schedule_reminder`, `stage_device_snapshot`, `start_device_execution`, `support_inbound_note`, `transition_approval`, `try_lock_credential_refresh`, `update_job_progress`, `upsert_calendar_events`, `upsert_calendars`, `upsert_contacts_from_people`, `upsert_device_account`, `upsert_learned_preference`, `upsert_mail_messages`, `upsert_tasks`, `user_apple_sub`, `user_rows_remaining`, `web_analytics_increment`.

**`admin_api` functions** (callable by `authenticated`, but each checks the gateway header, `aal2`, the admin identity, the session and its permission in SQL; see [BACKOFFICE_RBAC.md](BACKOFFICE_RBAC.md)): `admin_disable`, `admin_enable`, `admin_invite_record`, `admin_invite_rotate`, `admin_me`, `admin_mfa_reset`, `admin_preferences_get`, `admin_preferences_set`, `admin_session_end`, `admin_session_start`, `admin_session_step_up`, `admin_sessions_revoke_all`, `admin_unlock`, `admin_update_role`, `admins_list`, `ai_calibration_activate`, `ai_cost_series`, `ai_feedback_aggregate`, `ai_feedback_list`, `ai_feedback_reveal_comment`, `ai_metrics`, `ai_model_config_list`, `ai_model_config_update`, `ai_model_prices_list`, `ai_model_prices_upsert`, `ai_requests_list`, `announcement_audience_estimate`, `announcement_cancel`, `announcement_get`, `announcement_publish`, `announcement_upsert`, `announcements_list`, `app_versions_breakdown`, `audit_denied`, `audit_get`, `audit_list`, `audit_verify`, `audit_write`, `auth_status`, `authorize`, `billing_event_get`, `billing_events_list`, `briefing_regenerate`, `briefings_list`, `briefings_metrics`, `command_search`, `correlation_trace`, `cron_status`, `dashboard_metrics`, `dashboard_series`, `data_request_cancel`, `data_request_get`, `data_request_retry`, `data_requests_list`, `entitlement_grant`, `entitlement_grants_list`, `entitlement_revoke`, `export_regenerate`, `feedback_list`, `feedback_reveal`, `feedback_summary`, `feedback_update`, `flag_archive`, `flag_evaluate_preview`, `flag_get`, `flag_kill`, `flag_override_delete`, `flag_override_set`, `flag_upsert`, `flags_list`, `health_history`, `health_latest`, `integration_detail`, `integration_disconnect`, `integration_renew_watch`, `integrations_overview`, `integrations_summary`, `job_cancel`, `job_detail`, `job_retry`, `job_retry_bulk`, `job_retry_selected`, `jobs_list`, `jobs_summary`, `metrics_ops`, `metrics_product`, `notification_send_test`, `notification_test_preview`, `notifications_metrics`, `notifications_user_debug`, `plan_limits_list`, `plan_limits_update`, `plan_routing_profile_set`, `prompt_activate`, `prompt_archive`, `prompt_create_draft`, `prompt_diff`, `prompt_rollback`, `prompt_update_draft`, `prompt_version_get`, `prompt_versions_list`, `prompts_list`, `recovery_code_consume`, `recovery_codes_store`, `referral_review`, `referrals_list`, `referrals_metrics`, `security_events`, `session_expire`, `sessions_list_own`, `settings_get`, `settings_update`, `subscription_resync`, `subscriptions_list`, `subscriptions_metrics`, `support_access_authorize`, `support_access_grant`, `support_access_revoke`, `ticket_add_note`, `ticket_detail`, `ticket_patch`, `ticket_reply`, `ticket_update`, `tickets_list`, `trial_stream`, `user_audit`, `user_briefings`, `user_devices`, `user_disable`, `user_force_sync`, `user_integrations`, `user_lookup_email`, `user_mark_internal`, `user_overview`, `user_referrals`, `user_restore`, `user_reveal_email`, `user_subscription`, `user_support`, `user_usage`, `users_list`.

**`admin_api` functions for `service_role` only** (the sign-in and invite steps that `admin-api` runs with the secret key before an admin JWT exists, and the health-row writer): `health_record`, `invite_redeem`, `login_attempt_record`, `login_preflight`.

**`private` functions executable by `authenticated`** (pure helpers used by CHECK constraints on client-writable columns and by RLS-evaluated expressions): `ai_feature_is_briefing`, `compare_semver`, `immutable_array_to_text`, `immutable_unaccent`, `jsonb_array_len`, `jsonb_has_exact_keys`, `jsonb_numeric`, `referral_code_valid`, `valid_ai_data_access`, `valid_app_setting`, `valid_data_source_toggles`, `valid_evidence`, `valid_plan_limit`, `valid_rule_condition`.

### Enums (`public`)

50 enums (`Constants.public.Enums` of the generated types; `pnpm db:enum-parity` keeps them equal to `DB_ENUMS` in `@da/domain`).

| Enum | Values |
|---|---|
| `account_status` | `connecting` `healthy` `syncing` `partial` `needs_reauth` `admin_consent_required` `error` `disconnected` |
| `admin_role` | `super_admin` `operations` `support` `finance` `ai_ops` `analyst` `readonly` |
| `admin_status` | `invited` `active` `disabled` |
| `ai_feature` | `email_triage` `thread_summary` `email_deep_extract` `commitment_extract` `life_intel_extract` `briefing_morning` `briefing_midday` `briefing_evening` `weekly_review` `meeting_prep` `post_meeting_parse` `capture_extract` `assistant_intent` `assistant_qa` `reply_draft` `follow_up_draft` `embedding_doc` `embedding_query` `stt` `tts` `admin_probe` |
| `ai_tier` | `t0` `t1` `t2` `t3` |
| `approval_action_type` | `email_send` `calendar_create` `calendar_update` `task_create` `reminder_create` `commitment_create` |
| `approval_status` | `pending` `approved` `rejected` `executing` `executed` `failed` `expired` |
| `approval_via` | `approval_center` `inline_sheet` `voice_card` `capture_batch` `in_place` |
| `briefing_kind` | `morning` `midday` `evening` `weekly` |
| `briefing_status` | `scheduled` `generating` `ready` `delivered` `skipped` `failed` |
| `capability` | `mail_read` `mail_send` `calendar_read` `calendar_write` `tasks_read` `tasks_write` `calendar_freebusy` |
| `capture_kind` | `photo` `screenshot` `pdf` `file` `link` `text` `share` |
| `capture_status` | `pending_upload` `uploaded` `analyzing` `extracted` `actioned` `discarded` `failed` |
| `commitment_direction` | `user_owes` `they_owe` |
| `commitment_status` | `open` `done` `snoozed` `cancelled` |
| `decision_tier` | `explicit_rule` `learned_preference` `deterministic_signal` `ai_classification` |
| `deletion_kind` | `history` `account` |
| `deletion_status` | `requested` `verified` `queued` `processing` `completed` `failed` `cancelled` |
| `export_status` | `requested` `processing` `ready` `expired` `failed` `cancelled` |
| `extracted_entity_type` | `event` `task` `deadline` `person` `payment` `reservation` `flight` `shipment` `product` `note` |
| `feedback_type` | `bug` `feature` `general` `ai_quality` |
| `flow_card_type` | `email` `meeting` `deadline` `shipment` `flight` `reservation` `payment` `subscription` `security` `follow_up` `commitment` |
| `grant_source` | `referral_referrer` `referral_referee` `admin` `support` `compensation` |
| `insight_kind` | `reply_needed` `meeting` `deadline` `follow_up` `commitment` `life_event` `security` `conflict` `schedule_suggestion` `approval_pending` `digest` |
| `item_status` | `open` `done` `dismissed` `snoozed` `expired` |
| `job_status` | `queued` `running` `completed` `retrying` `failed` `dead_letter` |
| `job_type` | `initial_sync` `gmail_sync` `outlook_sync` `calendar_sync` `tasks_sync` `device_calendar_ingest` `watch_renewal` `reconciliation` `provider_webhook` `email_triage` `email_analysis` `insight_refresh` `first_analysis` `briefing` `meeting_prep` `embedding` `approval_execute` `notification` `push_receipts` `retention` `export` `history_deletion` `account_deletion` `billing_sync` `referral_evaluate` `health_check` `capture_analysis` `credential_reencrypt` `integration_purge` `ai_batch` `ai_eval` `briefing_audio` `transactional_email` |
| `life_event_type` | `shipment` `flight` `reservation` `payment` `subscription` `security` |
| `mail_category` | `important` `awaiting_my_reply` `awaiting_their_reply` `has_deadline` `informational` `low_priority` |
| `notification_category` | `morning` `midday` `evening` `critical_email` `meeting` `deadline` `follow_up` `life_intel` `approval` `account` |
| `notification_decision` | `scheduled` `sent` `suppressed` `deduplicated` `failed` |
| `notification_detail` | `full` `title_only` `generic` |
| `platform` | `ios` `android` |
| `prompt_status` | `draft` `active` `archived` |
| `provider` | `google` `microsoft` `apple_device` `android_device` `demo` |
| `referral_side` | `referrer` `referee` |
| `referral_status` | `pending` `qualified` `rewarded` `rejected` `flagged` |
| `reminder_status` | `scheduled` `delivered` `done` `cancelled` `failed` |
| `retention_policy` | `d30` `d90` `d365` `until_deleted` |
| `routing_profile` | `balanced` `lean` |
| `rule_condition` | `person` `domain` `keyword` `category` `sender` `android_app` |
| `rule_outcome` | `always_important` `high` `low` `always_notify` `mute` |
| `source_type` | `email_message` `email_thread` `calendar_event` `device_calendar_event` `task` `capture` `meeting_note` `post_meeting_note` `android_notification` `assistant_message` `user_input` `commitment` `life_event` `contact` `briefing` `ai_feedback` |
| `subscription_status` | `none` `trial` `active` `grace_period` `billing_issue` `cancelled` `paused` `expired` `refunded` |
| `support_access_scope` | `pii` `email_metadata` `insights` `notifications` `captures` `assistant_transcript` `ai_feedback` |
| `ticket_category` | `account` `integration` `sync` `billing` `ai_quality` `notification` `privacy` `other` |
| `ticket_status` | `open` `in_progress` `waiting_user` `resolved` `closed` |
| `urgency` | `urgent` `today` `normal` `low` |
| `user_state` | `active` `disabled` `deletion_pending` |
| `vip_relationship` | `spouse` `family` `manager` `key_client` `friend` `other` |

### Cron jobs (pg_cron, UTC)

| Job | Schedule | Runs |
|---|---|---|
| `da_scheduler_tick` | `* * * * *` | `private.scheduler_tick()` |
| `da_worker_poke` | `15 seconds` | `private.poke_worker('cron')` |
| `da_push_receipts` | `*/5 * * * *` | enqueues a `push_receipts` job (key per time bucket) |
| `da_health_check` | `*/5 * * * *` | enqueues a `health_check` job (key per time bucket) |
| `da_reconciliation` | `7 */6 * * *` | `private.enqueue_reconciliation()` |
| `da_retention` | `30 2 * * *` | enqueues a `retention` job (key per time bucket) |
| `da_billing_reconcile` | `45 3 * * *` | `private.enqueue_billing_reconcile()` |
| `da_cron_housekeeping` | `15 3 * * *` | deletes old rows from `cron.job_run_details` and `net._http_response` |

### Storage buckets

| Bucket | Public | Size limit | Allowed MIME types | Client policy on `storage.objects` |
|---|---|---|---|---|
| `captures` | no | 20 MiB | `image/jpeg` `image/png` `image/heic` `image/heif` `image/webp` `application/pdf` `text/plain` `audio/mp4` `audio/aac` `audio/mpeg` `application/json` | `captures_select_own`: select own folder `{user_id}/…` |
| `exports` | no | 512 MiB | `application/zip` | `exports_select_own`: select own folder `{user_id}/…` |
| `briefing-audio` | no | 20 MiB | `audio/mpeg` `audio/mp4` `audio/aac` | `briefing_audio_select_own`: select own folder `{user_id}/…` |

Clients have no INSERT, UPDATE or DELETE policy on `storage.objects`: uploads use signed upload URLs minted by `api`, and the worker writes and deletes with the secret key.

<!-- generated:db:end -->

## Differences from the plan

| Plan | As built | Reason (source) |
|---|---|---|
| Migration names of DATABASE_AND_RLS_PLAN §10 | WBS names `20260924000100…001700` and task ranges for later work | IMPLEMENTATION_PLAN names won; the plan table was corrected (integration notes) |
| `plan_limits` as listed in API_CONTRACTS §4: `ai_briefing_reserve_pct` (25 / 15 %), feature boolean `vip_effects`, Pro `ai_daily_budget_units = null` | Database names and values win: `ai_briefing_reserve_ratio` (0.25 / 0.15), feature boolean `vip`, Pro `ai_daily_budget_units` seeded 600 (the USD caps still bound Pro) | Integration notes (plan_limits: "DB names win") |
| Support notes `kind` `internal \| reply \| inbound_email` (API_CONTRACTS PUB-08) | `internal \| outbound_reply \| inbound_reply \| system` | Migration `20260924002220`; recorded as a contract doc fix in the integration notes |
| Referral risk threshold 0–1 | 0–100 in `app_settings.referral.risk_threshold` (default 50); the admin API converts 0–1 ↔ 0–100 | Integration notes (E, G2); a read bug was fixed in `4829722` |
| `push.test` permission for the support role (DATABASE_AND_RLS_PLAN §4.9) | Super admin and operations only | BACKOFFICE_PLAN §4.2 is authoritative (integration notes) |
| Retention batch ≤ 1000 per call (API_CONTRACTS JOB-20) | 5,000 rows per table per call, repeated until every count is 0 | DATABASE_AND_RLS_PLAN §6.4 batch size kept (integration notes F) |
| Every schedule as its own cron job | Eight `da_*` jobs only; AI cost control and metric rollups run inside `scheduler_tick` | Stays within Supabase's eight concurrent cron jobs (migration `20260924002400` header, DATABASE_AND_RLS_PLAN §9) |
