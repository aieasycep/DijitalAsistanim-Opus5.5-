#!/usr/bin/env bash
# Local environment helper.
#   --init   create .env from .env.example (if missing) and fill locally generated secrets that are empty
#   (no arg) print `export` lines for the current .env (usage: eval "$(bash scripts/dev/env.sh)")
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"

GENERATED_KEYS=(TOKEN_ENC_KEY_V1 HASH_PEPPER AI_HASH_PEPPER CRON_SECRET WEBHOOK_HMAC_SECRET ADMIN_BFF_SECRET \
  ADMIN_GATEWAY_SECRET RECOVERY_CODE_PEPPER PII_LOOKUP_PEPPER AUDIT_SUBJECT_PEPPER)

random_b64() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

init() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ROOT/.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "created .env from .env.example"
  fi
  for key in "${GENERATED_KEYS[@]}"; do
    if grep -qE "^${key}=$" "$ENV_FILE"; then
      value="$(random_b64)"
      # '|' never appears in base64 output, so it is a safe sed delimiter.
      sed -i "s|^${key}=$|${key}=${value}|" "$ENV_FILE"
      echo "generated ${key}"
    fi
  done
}

export_lines() {
  [[ -f "$ENV_FILE" ]] || { echo "missing .env — run: bash scripts/dev/env.sh --init" >&2; exit 1; }
  grep -E '^[A-Z0-9_]+=' "$ENV_FILE" | while IFS='=' read -r key value; do
    printf 'export %s=%q\n' "$key" "$value"
  done
}

case "${1:-}" in
  --init) init ;;
  "") export_lines ;;
  *) echo "usage: $0 [--init]" >&2; exit 2 ;;
esac
