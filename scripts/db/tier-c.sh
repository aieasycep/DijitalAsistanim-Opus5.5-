#!/usr/bin/env bash
# Tier-C database test run (docs/TEST_PLAN.md §1, §4, §15; IMPLEMENTATION_PLAN T-2.02).
#
#   1. drops and recreates the test database (default da_test) on the local PostgreSQL 16 cluster;
#   2. loads the Supabase compatibility shim (supabase/tests/shim/000_supabase_compat.sql);
#   3. applies every supabase/migrations/*.sql file in lexical order, each in one transaction,
#      stopping on the first error;
#   4. checks that seed blocks embedded in migrations match their supabase/seed sources;
#   5. installs pgTAP, loads supabase/tests/database/000_helpers.sql when it exists, and runs
#      pg_prove over every supabase/tests/database/**/*.test.sql file.
# Any failure exits non-zero. Re-running always starts from an empty database.
#
# Usage: bash scripts/db/tier-c.sh [--no-tests]
set -euo pipefail
# shellcheck source=scripts/db/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
export LC_ALL=C

RUN_TESTS=1
for arg in "$@"; do
  case "$arg" in
    --no-tests) RUN_TESTS=0 ;;
    *) da_die "unknown argument: $arg (usage: tier-c.sh [--no-tests])" ;;
  esac
done

SHIM="$DA_ROOT/supabase/tests/shim/000_supabase_compat.sql"
MIGRATIONS_DIR="$DA_ROOT/supabase/migrations"
TESTS_DIR="$DA_ROOT/supabase/tests/database"
HELPERS="$TESTS_DIR/000_helpers.sql"

[[ -f "$SHIM" ]] || da_die "missing shim: $SHIM"
[[ -d "$MIGRATIONS_DIR" ]] || da_die "missing migrations directory: $MIGRATIONS_DIR"

da_pg_resolve

da_log "recreating database ${DA_TEST_DB}"
da_pg dropdb --if-exists --force "$DA_TEST_DB"
da_pg createdb --encoding=UTF8 --template=template0 "$DA_TEST_DB"
# Same search_path as a Supabase database (extensions schema reachable without qualification).
da_psql -c "alter database \"${DA_TEST_DB}\" set search_path to \"\$user\", public, extensions"

# SQL files are streamed on stdin so the postgres OS user never needs read access to the checkout.
da_log "loading the Supabase compatibility shim"
da_psql -f - <"$SHIM"

mapfile -t migrations < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
((${#migrations[@]} > 0)) || da_die "no migrations found in $MIGRATIONS_DIR"
for file in "${migrations[@]}"; do
  da_log "applying $(basename "$file")"
  da_psql --single-transaction -f - <"$file"
done

da_log "checking embedded seed blocks against supabase/seed"
bash "$DA_ROOT/scripts/db/sync-seed-blocks.sh" --check

if ((RUN_TESTS == 0)); then
  da_log "migrations applied; tests skipped (--no-tests)"
  exit 0
fi

da_log "installing pgTAP"
da_psql -c 'create extension if not exists pgtap with schema extensions'
if [[ -f "$HELPERS" ]]; then
  da_log "loading $(basename "$HELPERS")"
  da_psql -f - <"$HELPERS"
fi

mapfile -t tests < <(find "$TESTS_DIR" -type f -name '*.test.sql' | sort)
((${#tests[@]} > 0)) || da_die "no pgTAP files (*.test.sql) found under $TESTS_DIR"
# pg_prove opens the files itself: stage a readable copy when the postgres OS user cannot read them.
if ((${#DA_PG_RUNNER[@]} > 0)) && ! da_pg test -r "${tests[0]}"; then
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  staged=()
  for file in "${tests[@]}"; do
    rel="${file#"$TESTS_DIR"/}"
    mkdir -p "$STAGE/$(dirname "$rel")"
    cp "$file" "$STAGE/$rel"
    staged+=("$STAGE/$rel")
  done
  chmod -R a+rX "$STAGE"
  tests=("${staged[@]}")
fi
da_log "running pg_prove over ${#tests[@]} file(s)"
da_pg pg_prove --dbname "$DA_TEST_DB" --failures "${tests[@]}"
