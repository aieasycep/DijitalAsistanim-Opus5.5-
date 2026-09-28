#!/usr/bin/env bash
# Maestro on Android (TEST_PLAN §9.1 run command; T-12.02). Runs inside
# reactivecircus/android-emulator-runner, whose emulator (emulator-5554, read-only) is shard 1;
# MAESTRO_SHARDS-1 more read-only instances of the same AVD are booted so `--shard-split` has a
# device per shard. Installs the e2e APK on each, prepares them, runs the `android` flows and keeps
# JUnit, screenshots and logcat under build/maestro. One shard by default: the m102 flows sign in
# as the shared demo canon users, whose data every canon seed resets.
# After the run it prints each failed flow's reason, the harness log and the app's logcat errors
# into the job log, and renames output folders the artifact upload refuses (" : < > | * ?).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
APK="${E2E_APK:?E2E_APK must point at the e2e release APK}"
SHARDS="${MAESTRO_SHARDS:-1}"
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
# The package manager can still drop the streamed install right after it first answers: retry a
# failed install a few times with a growing pause before giving up.
install_apk() {
  local serial="$1"
  for attempt in 1 2 3 4; do
    adb -s "$serial" install -r -g "$APK" && return 0
    echo "run-maestro-android: install on $serial failed (attempt $attempt)" >&2
    sleep $((attempt * 10))
  done
  return 1
}
for serial in "${SERIALS[@]}"; do install_apk "$serial"; done

collect() {
  for serial in "${SERIALS[@]}"; do adb -s "$serial" logcat -d >"$OUT/logcat-$serial.txt" 2>&1 || true; done
  # Flow names become folder names; actions/upload-artifact refuses " : < > | * ? in paths.
  find "$OUT" -depth -name '*[":<>|*?]*' -print0 | while IFS= read -r -d '' path; do
    mv -- "$path" "$(dirname -- "$path")/$(basename -- "$path" | tr '":<>|*?' '_______')"
  done
}
trap collect EXIT

sharding=()
((SHARDS > 1)) && sharding=(--shard-split "$SHARDS")
status=0
"$HOME/.maestro/bin/maestro" test apps/mobile/.maestro \
  --include-tags android \
  --format junit --output "$OUT/junit.xml" \
  --test-output-dir "$OUT" \
  "${sharding[@]}" || status=$?

if ((status != 0)); then
  # Artifacts cannot always be downloaded: the reasons go into the job log as well.
  echo "::group::Failed flows (JUnit)"
  node scripts/e2e/junit-failures.ts "$OUT"/junit*.xml || true
  echo "::endgroup::"
  echo "::group::Harness and functions log (tail)"
  tail -n 80 "$ROOT/build/e2e/harness.log" 2>/dev/null || true
  grep -E '"level":"(error|warn)"' "$ROOT/build/e2e/functions.log" 2>/dev/null | tail -n 40 || true
  echo "::endgroup::"
  echo "::group::App errors in logcat"
  for serial in "${SERIALS[@]}"; do
    adb -s "$serial" logcat -d 2>/dev/null |
      grep -E 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS.*(Error|error|Warning)|E ReactNative' |
      tail -n 60 || true
  done
  echo "::endgroup::"
fi
exit "$status"
