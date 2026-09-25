#!/usr/bin/env bash
# Maestro on Android (TEST_PLAN §9.1 run command; T-12.02). Runs inside
# reactivecircus/android-emulator-runner, whose emulator (emulator-5554, read-only) is shard 1;
# MAESTRO_SHARDS-1 more read-only instances of the same AVD are booted so `--shard-split` has a
# device per shard. Installs the e2e APK on each, prepares them, runs the `android` flows and keeps
# JUnit, screenshots and logcat under build/maestro.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
APK="${E2E_APK:?E2E_APK must point at the e2e release APK}"
SHARDS="${MAESTRO_SHARDS:-2}"
AVD="${AVD_NAME:-test}"
OUT="$ROOT/build/maestro"
mkdir -p "$OUT"

for ((i = 1; i < SHARDS; i++)); do
  port=$((5554 + 2 * i))
  nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -read-only -port "$port" -no-window \
    -no-snapshot -noaudio -no-boot-anim -camera-back none -gpu swiftshader_indirect \
    -change-locale tr-TR -timezone Europe/Istanbul >"$OUT/emulator-$port.log" 2>&1 &
done

mapfile -t SERIALS < <(for ((i = 0; i < SHARDS; i++)); do echo "emulator-$((5554 + 2 * i))"; done)
bash scripts/e2e/prepare-emulator.sh "${SERIALS[@]}"
for serial in "${SERIALS[@]}"; do adb -s "$serial" install -r -g "$APK"; done

collect() {
  for serial in "${SERIALS[@]}"; do adb -s "$serial" logcat -d >"$OUT/logcat-$serial.txt" 2>&1 || true; done
}
trap collect EXIT

"$HOME/.maestro/bin/maestro" test apps/mobile/.maestro \
  --include-tags android \
  --format junit --output "$OUT/junit.xml" \
  --test-output-dir "$OUT" \
  --shard-split "$SHARDS"
