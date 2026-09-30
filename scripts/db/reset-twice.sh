#!/usr/bin/env bash
# Resets the database from zero twice and runs the pgTAP suites each time, proving that migrations
# and their embedded reference data apply idempotently to a fresh database (IMPLEMENTATION_PLAN
# T-2.26). Tier C by default; `--tier a` uses the local Supabase stack (Docker).
#
# Usage: bash scripts/db/reset-twice.sh [--tier c|a]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TIER=c
if [[ "${1:-}" == "--tier" ]]; then
  TIER="${2:-}"
fi
case "$TIER" in
  c) RUNNER=(bash "$HERE/tier-c.sh") ;;
  a) RUNNER=(bash "$HERE/tier-a.sh") ;;
  *) echo "usage: $0 [--tier c|a]" >&2; exit 2 ;;
esac

for run in 1 2; do
  echo "==> reset from zero, run ${run}/2 (tier ${TIER})" >&2
  "${RUNNER[@]}"
done
echo "==> both runs passed" >&2
