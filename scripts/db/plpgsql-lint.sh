#!/usr/bin/env bash
# Static check of every PL/pgSQL function with plpgsql_check — the same analysis `supabase db lint`
# runs in the tier-A CI job (`--level warning --fail-on error`). Fails on error-level findings and
# prints warnings. Runs against the tier-C database after the migrations are applied.
#
# Usage: bash scripts/db/plpgsql-lint.sh
set -euo pipefail
# shellcheck source=scripts/db/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
da_pg_resolve

available="$(da_psql -At -c "select count(*) from pg_available_extensions where name = 'plpgsql_check'")"
if [[ "$available" != "1" ]]; then
  da_log "plpgsql_check is not installed (apt: postgresql-16-plpgsql-check); skipping the PL/pgSQL lint"
  exit 0
fi
da_psql -c 'create extension if not exists plpgsql_check with schema extensions'

report="$(da_psql -At -F $'\t' -c "
  select r.level, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         coalesce(r.lineno::text, '-'), r.message, coalesce(r.detail, '')
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  cross join lateral extensions.plpgsql_check_function_tb(p.oid) r
  where l.lanname = 'plpgsql'
    and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and n.nspname in ('public', 'private', 'admin_api')
    and r.level in ('error', 'warning')
  order by r.level, 2")"

errors="$(printf '%s\n' "$report" | awk -F '\t' '$1 == "error"' | grep -c . || true)"
warnings="$(printf '%s\n' "$report" | awk -F '\t' '$1 == "warning"' | grep -c . || true)"
if ((errors > 0)); then
  printf '%s\n' "$report" | awk -F '\t' '$1 == "error" { printf "error   %s line %s: %s %s\n", $2, $3, $4, $5 }' >&2
  da_die "plpgsql_check: ${errors} error(s), ${warnings} warning(s)"
fi
da_log "plpgsql_check: 0 errors, ${warnings} warning(s)"
