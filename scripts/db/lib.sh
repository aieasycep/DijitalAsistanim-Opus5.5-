#!/usr/bin/env bash
# Shared helpers for the tier-C database scripts (sourced, never executed directly).
#
# Tier C = a plain local PostgreSQL 16 cluster (pgvector 0.6, pgTAP, pg_cron) plus the Supabase
# compatibility shim (supabase/tests/shim/000_supabase_compat.sql). The scripts need a superuser
# connection. It is resolved in this order:
#   1. the ambient libpq environment (PGHOST, PGPORT, PGUSER, PGPASSWORD, …) when it already
#      connects as a superuser;
#   2. running the PostgreSQL client binaries as the `postgres` OS user (peer authentication):
#      `runuser` when the caller is root, `sudo -n` otherwise (CI runners have passwordless sudo).
# Override the database name with DA_TEST_DB (default: da_test, which is also the database named
# in `cron.database_name`, the only one where pg_cron can be created).

DA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DA_TEST_DB="${DA_TEST_DB:-da_test}"
DA_PG_RUNNER=()

da_log() { printf '==> %s\n' "$*" >&2; }
da_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# Decide how PostgreSQL client binaries are run. Sets DA_PG_RUNNER (a command prefix array).
da_pg_resolve() {
  local is_super
  is_super="$(psql -X -At -d postgres -c 'select rolsuper from pg_roles where rolname = current_user' 2>/dev/null || true)"
  if [[ "$is_super" == "t" ]]; then
    DA_PG_RUNNER=()
    return 0
  fi
  if ! id -u postgres >/dev/null 2>&1; then
    da_die "no superuser connection: set PGHOST/PGUSER/PGPASSWORD for a superuser, or run where the postgres OS user exists"
  fi
  if [[ "$(id -u)" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    DA_PG_RUNNER=(runuser -u postgres --)
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    DA_PG_RUNNER=(sudo -n -u postgres)
  else
    da_die "cannot run PostgreSQL clients as the postgres OS user (need root or passwordless sudo)"
  fi
  is_super="$("${DA_PG_RUNNER[@]}" psql -X -At -d postgres -c 'select rolsuper from pg_roles where rolname = current_user' 2>/dev/null || true)"
  [[ "$is_super" == "t" ]] || da_die "could not connect to the local PostgreSQL cluster as a superuser (is it running?)"
}

# Run a PostgreSQL client binary (psql, createdb, dropdb, pg_prove, …) with superuser rights.
da_pg() {
  "${DA_PG_RUNNER[@]}" "$@"
}

# psql against the test database, stopping on the first error, without reading ~/.psqlrc.
da_psql() {
  da_pg psql -X -q -v ON_ERROR_STOP=1 -d "$DA_TEST_DB" "$@"
}
