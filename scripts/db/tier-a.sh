#!/usr/bin/env bash
# Tier-A database test run on the full local Supabase stack (CI `db` job; needs Docker).
# docs/TEST_PLAN.md §1 and §13; IMPLEMENTATION_PLAN T-2.02.
#
#   supabase start → supabase db reset (all migrations from zero) → pgTAP helpers →
#   supabase test db over supabase/tests/database/**/*.test.sql → supabase db lint.
# The tier-C shim is never loaded here: the real auth, storage, vault, cron and net objects exist.
#
# Usage: bash scripts/db/tier-a.sh [--keep-running]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export LC_ALL=C

KEEP_RUNNING=0
for arg in "$@"; do
  case "$arg" in
    --keep-running) KEEP_RUNNING=1 ;;
    *) echo "unknown argument: $arg (usage: tier-a.sh [--keep-running])" >&2; exit 2 ;;
  esac
done

supabase_cli() { pnpm exec supabase "$@"; }
DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
HELPERS="supabase/tests/database/000_helpers.sql"

local_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"
  else
    local project_id
    project_id="$(sed -nE 's/^project_id = "([^"]+)"/\1/p' supabase/config.toml)"
    docker exec -i "supabase_db_${project_id}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
  fi
}

cleanup() {
  if ((KEEP_RUNNING == 0)); then supabase_cli stop --no-backup >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "==> supabase start" >&2
supabase_cli start -x studio,imgproxy
echo "==> supabase db reset (every migration from zero)" >&2
supabase_cli db reset

if [[ -f "$HELPERS" ]]; then
  echo "==> loading $(basename "$HELPERS")" >&2
  local_psql -c 'create extension if not exists pgtap with schema extensions'
  if command -v psql >/dev/null 2>&1; then
    local_psql -f "$HELPERS"
  else
    local_psql <"$HELPERS"
  fi
fi

mapfile -t tests < <(find supabase/tests/database -type f -name '*.test.sql' | sort)
((${#tests[@]} > 0)) || { echo "no pgTAP files (*.test.sql) under supabase/tests/database" >&2; exit 1; }
echo "==> supabase test db (${#tests[@]} file(s))" >&2
supabase_cli test db "${tests[@]}"

echo "==> supabase db lint" >&2
# Only our schemas: pgTAP (installed into `extensions` for the test run) ships functions that
# plpgsql_check cannot resolve statically, and extension code is not ours to lint.
supabase_cli db lint --schema public,private,admin_api --level warning --fail-on error
