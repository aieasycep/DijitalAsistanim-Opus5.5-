#!/usr/bin/env bash
# Tier-A stack for the Maestro run (TEST_PLAN §9.1, §12.2; T-12.02): `supabase start`, the E2E
# preparation SQL, the demo seed, the E2E scenario seed functions (supabase/seed/e2e/functions.sql),
# `supabase functions serve` (APP_ENV=e2e, DEMO_MODE, fixture AI, fixed clock) and the harness on
# 127.0.0.1:8790. Writes the values later steps need to "$GITHUB_ENV" when set
# (else to stdout). Loopback only; CI-generated secrets never leave the runner.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${E2E_OUT:-$ROOT/build/e2e}"
mkdir -p "$OUT"
FIXED_NOW="${DA_FIXED_NOW:-2026-09-22T05:45:00Z}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

pnpm exec supabase start -x studio,imgproxy
eval "$(pnpm exec supabase status -o env | sed -E 's/^([A-Z_]+)=/SB_\1=/')"
SECRET_KEY="${SB_SECRET_KEY:-${SB_SERVICE_ROLE_KEY:-}}"
PUBLISHABLE_KEY="${SB_PUBLISHABLE_KEY:-${SB_ANON_KEY:-}}"
[[ -n "$SECRET_KEY" && -n "$PUBLISHABLE_KEY" ]] || {
  echo "start-stack: supabase status did not report the local keys" >&2
  exit 1
}

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/e2e/prepare-stack.sql
DEMO_MODE=true DEMO_DB_URL="$DB_URL" bash scripts/db/seed-demo.sh
# E2E scenario seeds (TEST_PLAN §12.2): e2e.seed_user / e2e.reset_user for the harness. The file and
# its functions refuse unless the session carries app.env (set only here, on the loopback stack).
SEED_APP_ENV=local
[[ "${CI:-}" == "true" ]] && SEED_APP_ENV=ci
{
  printf "set app.env = '%s';\n" "$SEED_APP_ENV"
  cat supabase/seed/e2e/functions.sql
} | psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q --single-transaction -f -

CRON_SECRET_VALUE="$(openssl rand -hex 24)"
ENV_FILE="$OUT/functions.env"
umask 077
cat >"$ENV_FILE" <<EOF
APP_ENV=e2e
DEMO_MODE=true
AI_FIXTURE_PROVIDER_ENABLED=true
DA_FIXED_NOW=$FIXED_NOW
CRON_SECRET=$CRON_SECRET_VALUE
HASH_PEPPER=$(openssl rand -base64 32)
TOKEN_ENC_KEY_V1=$(openssl rand -base64 32)
TOKEN_ENC_ACTIVE_VERSION=1
EOF

nohup pnpm exec supabase functions serve --env-file "$ENV_FILE" >"$OUT/functions.log" 2>&1 &
echo $! >"$OUT/functions.pid"
# The api answers 401 without a session once the edge runtime serves it.
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/functions/v1/api/me/bootstrap || true)"
  [[ "$code" == "401" ]] && break
  sleep 2
done

export APP_ENV=e2e SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY="$SECRET_KEY" \
  DA_E2E_DB_URL="$DB_URL" CRON_SECRET="$CRON_SECRET_VALUE" DA_FIXED_NOW="$FIXED_NOW" \
  E2E_RUN_ID="${E2E_RUN_ID:-${GITHUB_RUN_ID:-local}}"
nohup node scripts/e2e/harness-server.ts >"$OUT/harness.log" 2>&1 &
echo $! >"$OUT/harness.pid"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null -X POST -H 'content-type: application/json' -d '{}' \
    http://127.0.0.1:8790/otp && break
  sleep 1
done

emit() {
  if [[ -n "${GITHUB_ENV:-}" ]]; then echo "$1=$2" >>"$GITHUB_ENV"; else echo "$1=$2"; fi
}
emit E2E_SUPABASE_PUBLISHABLE_KEY "$PUBLISHABLE_KEY"
emit E2E_FUNCTIONS_ENV "$ENV_FILE"
echo "start-stack: supabase, functions and harness are up"
