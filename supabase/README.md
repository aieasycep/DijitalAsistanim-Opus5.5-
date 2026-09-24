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

Every table has row level security enabled **and forced** in the migration that creates it. Owner
policies and grants arrive in the RLS migration (0014); until then only superusers and BYPASSRLS
roles can read or write. Supabase Realtime is not used (R-19).

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
| `pnpm db:start`       | Starts the local Supabase stack                                                    |

Hosted settings that `config push` cannot apply (custom SMTP credentials, the Apple client secret
rotation, Vault secrets) are Manual external steps of the deploy job.
