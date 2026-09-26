#!/usr/bin/env bash
# Tier-A stack for the Maestro run (TEST_PLAN §9.1; T-12.02): `supabase start`, the E2E preparation
# SQL, the demo seed, the mock provider server (RevenueCat REST v2 for the paywall flows E2E-M-06 /
# M-16), `supabase functions serve` (APP_ENV=e2e, DEMO_MODE, fixture AI, fixed clock) and the
# harness on 127.0.0.1:8790. Writes the values later steps need to "$GITHUB_ENV" when set (else to
# stdout). Loopback / runner-local only; CI-generated secrets never leave the runner.
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

# The edge runtime runs in Docker, where host.docker.internal is the host gateway (the Docker bridge
# gateway on Linux, the host loopback under Docker Desktop): the mock listens there, never on a
# wildcard address. MOCK_PROVIDERS_HOSTNAME overrides the address (server.ts refuses public ones).
MOCK_PORT=8788
if [[ -z "${MOCK_PROVIDERS_HOSTNAME:-}" ]]; then
  if [[ "$(uname -s)" == Darwin ]]; then
    MOCK_PROVIDERS_HOSTNAME=127.0.0.1
  else
    MOCK_PROVIDERS_HOSTNAME="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')"
  fi
fi
[[ -n "$MOCK_PROVIDERS_HOSTNAME" ]] || {
  echo "start-stack: no Docker bridge gateway; set MOCK_PROVIDERS_HOSTNAME" >&2
  exit 1
}
MOCK_URL="http://$MOCK_PROVIDERS_HOSTNAME:$MOCK_PORT"

CRON_SECRET_VALUE="$(openssl rand -hex 24)"
RC_SECRET_VALUE="sk_$(openssl rand -hex 18)"
ENV_FILE="$OUT/functions.env"
umask 077
# RevenueCat: test values only; REVENUECAT_API_BASE_URL is a test-only override the env schema
# refuses in preview/production.
cat >"$ENV_FILE" <<EOF
APP_ENV=e2e
DEMO_MODE=true
AI_FIXTURE_PROVIDER_ENABLED=true
DA_FIXED_NOW=$FIXED_NOW
CRON_SECRET=$CRON_SECRET_VALUE
HASH_PEPPER=$(openssl rand -base64 32)
TOKEN_ENC_KEY_V1=$(openssl rand -base64 32)
TOKEN_ENC_ACTIVE_VERSION=1
REVENUECAT_PROJECT_ID=proje2e
REVENUECAT_API_V2_SECRET_KEY=$RC_SECRET_VALUE
REVENUECAT_API_BASE_URL=http://host.docker.internal:$MOCK_PORT/revenuecat/v2
EOF

if curl -fs -o /dev/null "$MOCK_URL/__health"; then
  echo "start-stack: $MOCK_URL is already serving (a stale mock provider server?)" >&2
  exit 1
fi
# The node_modules/.bin shim runs deno as a child of node; starting the binary it resolves keeps
# the pid file the server's own pid.
DENO_BIN="$(DENO_NO_UPDATE_CHECK=1 node_modules/.bin/deno eval 'console.log(Deno.execPath())')"
nohup env REVENUECAT_API_V2_SECRET_KEY="$RC_SECRET_VALUE" \
  MOCK_PROVIDERS_HOSTNAME="$MOCK_PROVIDERS_HOSTNAME" MOCK_PROVIDERS_PORT="$MOCK_PORT" \
  DENO_NO_UPDATE_CHECK=1 NO_COLOR=1 \
  "$DENO_BIN" run --allow-net="$MOCK_PROVIDERS_HOSTNAME" --allow-env --allow-read \
  --config supabase/functions/deno.json supabase/functions/_shared/testing/mock-providers/server.ts \
  >"$OUT/mock-providers.log" 2>&1 &
echo $! >"$OUT/mock-providers.pid"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$MOCK_URL/__health" && break
  sleep 1
done
curl -fsS -o /dev/null "$MOCK_URL/__health" || {
  echo "start-stack: the mock provider server did not start (see $OUT/mock-providers.log)" >&2
  exit 1
}

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
  E2E_RUN_ID="${E2E_RUN_ID:-${GITHUB_RUN_ID:-local}}" REVENUECAT_MOCK_URL="$MOCK_URL/revenuecat"
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
echo "start-stack: supabase, mock providers, functions and harness are up"
