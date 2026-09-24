# scripts/db

Database test runners (docs/TEST_PLAN.md §1, §4, §15; IMPLEMENTATION_PLAN T-2.02).

| Script                | Purpose                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `tier-c.sh`           | Recreates `da_test` on the local PostgreSQL 16 cluster, loads the shim, applies every migration, runs pgTAP |
| `tier-a.sh`           | Full local Supabase stack: `start`, `db reset`, `test db`, `db lint` (Docker; CI `db` job)                  |
| `reset-twice.sh`      | Runs a tier twice from zero to prove idempotent recreation (`--tier c` default, `--tier a`)                 |
| `sync-seed-blocks.sh` | `--check` / `--write` the `supabase/seed/*.sql` copies embedded in migrations                               |
| `psql.sh`             | psql on the tier-C database as a superuser                                                                  |
| `gen-types.sh`        | Generates or `--check`s `packages/api-client/src/database.types.ts` with @supabase/postgres-meta 0.99.0     |
| `enum-parity.ts`      | Fails when the database enums differ from `DB_ENUMS` in `packages/domain/src/enums.ts`                      |
| `lint-migrations.sh`  | squawk-cli 2.65.0 over the migrations: greenfield exemptions for 0001–0012, the full rule set afterwards    |
| `seed-demo.sh`        | Loads `supabase/seed/demo/*.sql`; refuses without `DEMO_MODE=true` (and in production by default)           |
| `lib.sh`              | Shared helpers (superuser connection, database name)                                                        |

## Tier C

Prerequisites (`bash scripts/dev/bootstrap-container.sh`): PostgreSQL 16 with `postgresql-16-pgvector`,
`postgresql-16-pgtap`, `libtap-parser-sourcehandler-pgtap-perl` (pg_prove) and `postgresql-16-cron`,
with `shared_preload_libraries = 'pg_cron'` and `cron.database_name = 'da_test'`. pg_net is not
packaged; the shim's `net.http_post()` records calls in `net._shim_requests` instead.

The runner needs a superuser connection. It uses the ambient libpq environment (`PGHOST`, `PGUSER`,
`PGPASSWORD`, …) when that is already a superuser, otherwise it runs the client binaries as the
`postgres` OS user (`runuser` as root, `sudo -n` otherwise). `DA_TEST_DB` overrides the database
name; pg_cron is only created when it equals `cron.database_name`.

Steps: drop and recreate the database → load `supabase/tests/shim/000_supabase_compat.sql` → apply
`supabase/migrations/*.sql` in file-name order, one transaction per file, stopping on the first error
→ check embedded seed blocks → `create extension pgtap` → load `supabase/tests/database/000_helpers.sql`
when present → `pg_prove` over every `supabase/tests/database/**/*.test.sql`. Any failure exits
non-zero. `--no-tests` stops after the migrations.

## Test files

- Suites are `supabase/tests/database/NNN_<area>.test.sql`; each runs in its own transaction
  (`begin; select plan(n); … select * from finish(); rollback;`).
- `000_helpers.sql` (schema `tests`) is not a suite: both runners load it before `pg_prove` /
  `supabase test db`, which only receive `*.test.sql` files.
- The shim lives outside `tests/database`, so tier A never runs it. It mirrors Supabase's default
  privileges on schema `public`, so a missing `revoke` fails tier C exactly like tier A.
- Helpers: `tests.create_user(email, timezone)`, `tests.authenticate_as(uid, aal, session)`,
  `tests.create_admin(email, role, status)` / `tests.authenticate_as_admin(role, aal)`,
  `tests.as_anon()`, `tests.as_service_role()`, `tests.clear_authentication()` and the fixtures
  `tests.make_*` (accounts, calendars, events, threads, messages, insights, commitments, life
  events, contacts, memory with deterministic `tests.axis_vector` embeddings, approvals,
  installations, briefings, Pro grants). Identity helpers switch role and claims for the current
  transaction only; the admin helpers also send the admin-api gateway header.

## Type generation and parity

- `pnpm db:types` rebuilds tier C from zero and regenerates the types for `public` and
  `admin_api`; `DA_TYPEGEN_DB_URL` points it at another database (for example the local stack).
  Tier C only allows password logins over TCP, so the script creates a throwaway `da_typegen`
  login role with a random password for the generator and drops it on exit.
- `pnpm db:enum-parity` needs a migrated database (tier C, or `DA_PARITY_DB_URL`).
