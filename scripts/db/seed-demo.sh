#!/usr/bin/env bash
# Loads the demo dataset (supabase/seed/demo/*.sql; IMPLEMENTATION_PLAN T-2.24, DATABASE_AND_RLS_PLAN §11).
#
# Guards (M§89, M§100):
#   - refuses unless DEMO_MODE=true;
#   - refuses when APP_ENV=production unless ALLOW_DEMO_IN_PRODUCTION=true.
# The SQL itself also refuses unless the session carries da.demo_mode = 'true', which only this
# runner sets, so the dataset can never be loaded by `supabase db reset` or by accident.
#
# Target database, in order:
#   1. DEMO_DB_URL (any libpq connection string, e.g. the local stack
#      postgresql://postgres:postgres@127.0.0.1:54322/postgres);
#   2. otherwise the tier-C test database (scripts/db/lib.sh, DA_TEST_DB, default da_test).
#
# Usage: DEMO_MODE=true pnpm db:seed:demo
set -euo pipefail
# shellcheck source=scripts/db/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ "${DEMO_MODE:-}" == "true" ]] || da_die "DEMO_MODE=true is required to load the demo dataset"
if [[ "${APP_ENV:-}" == "production" && "${ALLOW_DEMO_IN_PRODUCTION:-}" != "true" ]]; then
  da_die "APP_ENV=production: set ALLOW_DEMO_IN_PRODUCTION=true to load demo data there"
fi

SEED_DIR="$DA_ROOT/supabase/seed/demo"
mapfile -t files < <(find "$SEED_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
((${#files[@]} > 0)) || da_die "no demo seed files in $SEED_DIR"

# One transaction for every file, with the session flag the SQL checks.
payload() {
  printf '%s\n' "set da.demo_mode = 'true';"
  for file in "${files[@]}"; do
    printf -- '-- %s\n' "$(basename "$file")"
    cat "$file"
    printf '\n'
  done
}

if [[ -n "${DEMO_DB_URL:-}" ]]; then
  da_log "loading ${#files[@]} demo seed file(s) into DEMO_DB_URL"
  payload | psql "$DEMO_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -
else
  da_pg_resolve
  da_log "loading ${#files[@]} demo seed file(s) into ${DA_TEST_DB}"
  payload | da_psql --single-transaction -f -
fi
da_log "demo dataset loaded (demo@dijitalasistan.app, demo-free@dijitalasistan.app)"
