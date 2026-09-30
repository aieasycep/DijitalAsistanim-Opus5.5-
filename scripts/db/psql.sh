#!/usr/bin/env bash
# Opens psql on the tier-C test database as a superuser (see scripts/db/lib.sh for how the
# connection is resolved). Extra arguments are passed to psql, e.g.
#   bash scripts/db/psql.sh -c 'select count(*) from public.plan_limits'
set -euo pipefail
# shellcheck source=scripts/db/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
da_pg_resolve
da_pg psql -X -d "$DA_TEST_DB" "$@"
