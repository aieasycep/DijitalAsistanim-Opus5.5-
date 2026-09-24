#!/usr/bin/env bash
# Migration lint with squawk-cli 2.65.0 (IMPLEMENTATION_PLAN T-2.26; config supabase/.squawk.toml).
#
# Two passes:
#   1. The greenfield baseline 0001–0012 created every table empty in a single release, so the
#      zero-downtime rules for live tables do not apply there (foreign keys and indexes on empty
#      tables, lock/statement timeouts) and three PostgreSQL-truncated constraint names stay as the
#      schema tests assert them.
#   2. Every later migration (0013 onwards, including all future ones) gets the full rule set.
# Exits non-zero on any finding.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQUAWK="$ROOT/node_modules/.bin/squawk"
CONFIG="$ROOT/supabase/.squawk.toml"
[[ -x "$SQUAWK" ]] || { echo "squawk is not installed (run pnpm install)" >&2; exit 1; }

BASELINE_LAST=20260924001200
baseline=()
later=()
while IFS= read -r file; do
  version="$(basename "$file" | cut -d_ -f1)"
  if [[ "$version" -le "$BASELINE_LAST" ]]; then baseline+=("$file"); else later+=("$file"); fi
done < <(find "$ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

status=0
if ((${#baseline[@]} > 0)); then
  echo "==> squawk: baseline migrations (${#baseline[@]})" >&2
  # --exclude replaces the config's excluded_rules, so the config's global list is repeated here.
  "$SQUAWK" --config "$CONFIG" \
    --exclude=prefer-bigint-over-int,prefer-bigint-over-smallint,ban-char-field \
    --exclude=adding-foreign-key-constraint,constraint-missing-not-valid,require-concurrent-index-creation \
    --exclude=require-lock-timeout,require-statement-timeout,identifier-too-long \
    "${baseline[@]}" || status=1
fi
if ((${#later[@]} > 0)); then
  echo "==> squawk: migrations after the baseline (${#later[@]})" >&2
  "$SQUAWK" --config "$CONFIG" "${later[@]}" || status=1
fi
exit "$status"
