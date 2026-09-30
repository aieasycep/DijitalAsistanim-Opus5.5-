# supabase/

Postgres schema, RLS, tests and project configuration for Dijital Asistan. The binding spec is
[`docs/DATABASE_AND_RLS_PLAN.md`](../docs/DATABASE_AND_RLS_PLAN.md) (tables, columns, enums, functions,
cron, buckets) together with the rulings in `docs/MASTER_PLAN.md` §23b.

| Path                                 | Contents                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `config.toml`                        | Local stack and hosted API/auth settings (`supabase config push`); secrets only via `env()` |
| `migrations/`                        | Forward-only migrations, applied in file-name order                                         |
| `seed/ai_model_config.sql`           | AI routing defaults; embedded verbatim in migration 0005 (`pnpm db:seed-blocks`)            |
| `seed/ai_model_prices.sql`           | AI price book; embedded verbatim in migration 0005                                          |
| `seed/demo/*.sql`                    | Demo dataset, loaded only by `pnpm db:seed:demo` with `DEMO_MODE=true` (T-2.24)             |
| `.squawk.toml`                       | Migration lint configuration (squawk 2.65.0, `pnpm db:lint`)                                |
| `tests/shim/000_supabase_compat.sql` | Tier-C stand-ins for roles, `auth`, `storage`, `net`, `vault` (never loaded on tier A)      |
| `tests/database/*.test.sql`          | pgTAP suites; run by both tiers                                                             |

## Migrations

| File                                          | Contents                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `20260924000100_extensions_schemas_enums.sql` | Extensions (pg_cron / pg_net guarded), `private` + `admin_api`, enums, check helpers        |
| `20260924000200_identity_settings.sql`        | Profiles, preferences, installations, push tokens, retention triggers, new-user trigger     |
| `20260924000300_integrations.sql`             | Connected accounts, credentials, OAuth states, calendars, sync state, quotas, webhooks      |
| `20260924000400_content.sql`                  | Contacts, VIP, mail, events, tasks, commitments, reminders, meetings, life events, captures |
| `20260924000500_intelligence.sql`             | Rules, preferences, insights, briefings, drafts, AI telemetry, routing and prices           |
| `20260924000600_approvals.sql`                | Approval actions and their append-only events                                               |
| `20260924000700_assistant_memory.sql`         | Assistant threads/messages, memory chunks (`vector(1024)`, HNSW)                            |
| `20260924000800_notifications.sql`            | Notification decision ledger, push tickets                                                  |
| `20260924000900_business.sql`                 | Subscriptions, billing events, grants, plan limits, referrals                               |
| `20260924001000_ops_product.sql`              | Jobs, analytics, feature flags, announcements, feedback, health, settings, rollups          |
| `20260924001100_privacy.sql`                  | Export and deletion requests, privacy tombstones                                            |
| `20260924001200_admin_audit.sql`              | Admin identities and sessions, permission matrix, audit chain, support                      |
| `20260924001300_functions_private.sql`        | Private helpers: entitlements, admin guard, flags, jobs, approvals, budgets, retention      |
| `20260924001310_functions_public_rpcs.sql`    | User RPCs (RPC-01…23, API_CONTRACTS §15): search, Today, Flow, mail, plan, feedback         |
| `20260924001320_functions_admin_api.sql`      | Every `admin_api` function and `private.admin_function_permissions` (BACKOFFICE_PLAN §4)    |
| `20260924001330_scheduler_jobs.sql`           | Job queue API, rate limits, service wrappers, `scheduler_tick`, metric rollups              |
| `20260924001400_rls_policies_grants.sql`      | Baseline revokes, owner policies, column grants, restrictive aal2 policies                  |
| `20260924001500_cron_schedules.sql`           | The eight `da_*` pg_cron jobs (guarded when pg_cron is absent)                              |
| `20260924001600_storage.sql`                  | Buckets `captures`, `exports`, `briefing-audio` and their folder policies                   |

Every table has row level security enabled **and forced** in the migration that creates it. Owner
policies and grants arrive in the RLS migration (0014); until then only superusers and BYPASSRLS
roles can read or write. Supabase Realtime is not used (R-19).

Edge Functions reach the database only through PostgREST (`public`, `admin_api`), so every
worker-side helper in `private` has a security-definer wrapper in `public` that only
`service_role` may execute (for example `public.claim_jobs`, `public.transition_approval`,
`public.ai_budget_reserve`, `public.rate_limit_hit`). `admin_api` functions run behind the
admin-api gateway header, the aal2 admin guard and the permission map in
`private.admin_function_permissions`.

Migrations must stay PostgreSQL 16 and pgvector 0.6 compatible (tier C) although hosted and CI run
PostgreSQL 17 (`docs/DATABASE_AND_RLS_PLAN.md` §1.7).

## Commands

| Command               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `pnpm db:test:c`      | Tier C: fresh local PostgreSQL 16 database + shim + migrations + pgTAP (container) |
| `pnpm db:test`        | Tier A: `supabase start`, `db reset`, `test db`, `db lint` (needs Docker; CI)      |
| `pnpm db:reset-twice` | Tier C twice from zero (idempotent recreation)                                     |
| `pnpm db:seed-blocks` | Rewrites the seed blocks embedded in migrations from `seed/`                       |
| `pnpm db:psql`        | psql on the tier-C test database                                                   |
| `pnpm db:lint`        | squawk 2.65.0 over every migration (baseline exemptions in the script)             |
| `pnpm db:types`       | Regenerates `packages/api-client/src/database.types.ts` (postgres-meta 0.99.0)     |
| `pnpm db:types:check` | Fails when the committed database types drift from the migrations                  |
| `pnpm db:enum-parity` | Compares the database enums with `DB_ENUMS` of `packages/domain/src/enums.ts`      |
| `pnpm db:seed:demo`   | Loads the demo dataset (`DEMO_MODE=true`; never in production by default)          |
| `pnpm db:start`       | Starts the local Supabase stack                                                    |

Hosted settings that `config push` cannot apply (custom SMTP credentials, the Apple client secret
rotation, Vault secrets) are Manual external steps of the deploy job.
