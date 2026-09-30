#!/usr/bin/env bash
# Idempotent toolchain bootstrap for local/container development (never run in CI; CI uses the
# Supabase CLI stack — tier A). Provides tier-C database testing: local PostgreSQL 16 with
# pgvector, pgTAP, pg_prove and pg_cron, plus a Chromium for Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_MAJOR=16
DB_NAME=da_test

log() { printf '\n==> %s\n' "$*"; }

log "PostgreSQL ${PG_MAJOR} extensions (pgvector, pgTAP, pg_prove, pg_cron)"
need=()
for pkg in "postgresql-${PG_MAJOR}-pgvector" "postgresql-${PG_MAJOR}-pgtap" libtap-parser-sourcehandler-pgtap-perl "postgresql-${PG_MAJOR}-cron"; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need+=("$pkg")
done
if ((${#need[@]})); then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
fi

log "Configure and start the ${PG_MAJOR}/main cluster"
CONF_DIR="/etc/postgresql/${PG_MAJOR}/main"
if ! grep -q "^shared_preload_libraries = 'pg_cron'" "$CONF_DIR/postgresql.conf"; then
  cat >>"$CONF_DIR/postgresql.conf" <<CONF
shared_preload_libraries = 'pg_cron'
cron.database_name = '${DB_NAME}'
CONF
fi
if pg_ctlcluster "$PG_MAJOR" main status >/dev/null 2>&1; then
  pg_ctlcluster "$PG_MAJOR" main restart
else
  pg_ctlcluster "$PG_MAJOR" main start
fi

log "Test database ${DB_NAME}"
su postgres -c "psql -tAc \"select 1 from pg_database where datname='${DB_NAME}'\"" | grep -q 1 \
  || su postgres -c "createdb ${DB_NAME}"
su postgres -c "psql -d ${DB_NAME} -qc 'create extension if not exists vector; create extension if not exists pgtap; create extension if not exists pg_cron;'"
pg_prove --version

log "Chromium for Playwright"
if [[ -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ]]; then
  echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
else
  CFT_DIR="$ROOT/.cache/cft"
  mkdir -p "$CFT_DIR"
  if [[ ! -x "$CFT_DIR/chrome-linux64/chrome" ]]; then
    curl -fsSL -o "$CFT_DIR/chrome.zip" \
      https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-linux64.zip
    unzip -q -o "$CFT_DIR/chrome.zip" -d "$CFT_DIR"
  fi
  echo "PLAYWRIGHT_CHROMIUM_EXECUTABLE=$CFT_DIR/chrome-linux64/chrome"
fi

log "Docker daemon (tier B, best effort)"
if ! docker info >/dev/null 2>&1; then
  (dockerd >/tmp/dockerd.log 2>&1 &) || true
  sleep 5
  docker info >/dev/null 2>&1 && echo "docker daemon started" || echo "docker daemon unavailable — tier C only"
else
  echo "docker daemon already running"
fi
