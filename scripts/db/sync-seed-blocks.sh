#!/usr/bin/env bash
# Keeps reference-data blocks inside migrations identical to their source files in supabase/seed/.
#
# Model IDs may only appear in supabase/seed/ai_model_config.sql and ai_model_prices.sql
# (AI_PIPELINE_PLAN §3.7). Migrations ship that reference data to production, so the migration
# embeds a copy between the markers
#   -- >>> BEGIN SEED BLOCK supabase/seed/<file>.sql
#   -- <<< END SEED BLOCK supabase/seed/<file>.sql
#
# Usage:
#   bash scripts/db/sync-seed-blocks.sh --check   exit 1 when a block differs from its source
#   bash scripts/db/sync-seed-blocks.sh --write   rewrite every block from its source (authoring)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---check}"
[[ "$MODE" == "--check" || "$MODE" == "--write" ]] || { echo "usage: $0 --check|--write" >&2; exit 2; }

BEGIN_RE='^-- >>> BEGIN SEED BLOCK (supabase/seed/[A-Za-z0-9_./-]+\.sql)$'
status=0
found=0

while IFS= read -r migration; do
  mapfile -t sources < <(sed -nE "s#${BEGIN_RE}#\\1#p" "$migration")
  for src in "${sources[@]}"; do
    found=$((found + 1))
    [[ -f "$ROOT/$src" ]] || { echo "missing seed source $src (referenced by $migration)" >&2; status=1; continue; }
    begin="-- >>> BEGIN SEED BLOCK $src"
    end="-- <<< END SEED BLOCK $src"
    grep -qxF -- "$end" "$migration" || { echo "missing end marker for $src in $migration" >&2; status=1; continue; }
    if [[ "$MODE" == "--check" ]]; then
      if ! diff -u --label "$src" --label "$migration (block)" "$ROOT/$src" \
        <(awk -v b="$begin" -v e="$end" '$0 == e {inside = 0} inside {print} $0 == b {inside = 1}' "$migration"); then
        echo "seed block for $src in $(basename "$migration") is out of date: run bash scripts/db/sync-seed-blocks.sh --write" >&2
        status=1
      fi
    else
      tmp="$(mktemp)"
      awk -v b="$begin" -v e="$end" -v f="$ROOT/$src" '
        $0 == b { print; while ((getline line < f) > 0) print line; close(f); skip = 1; next }
        $0 == e { skip = 0 }
        !skip { print }
      ' "$migration" >"$tmp"
      cat "$tmp" >"$migration"
      rm -f "$tmp"
    fi
  done
done < <(grep -lE "$BEGIN_RE" "$ROOT"/supabase/migrations/*.sql 2>/dev/null || true)

if [[ "$MODE" == "--write" ]]; then
  echo "seed blocks rewritten: $found"
elif ((status == 0)); then
  echo "seed blocks in sync: $found"
fi
exit "$status"
