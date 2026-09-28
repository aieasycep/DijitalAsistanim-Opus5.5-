#!/usr/bin/env bash
# Emulator preparation for the Maestro run (TEST_PLAN §9.1): no animations, no Chrome first-run
# (the demo OAuth Custom Tab), nothing else pre-installed. Usage: prepare-emulator.sh [serial ...]
set -euo pipefail

SERIALS=("$@")
if [[ ${#SERIALS[@]} -eq 0 ]]; then
  mapfile -t SERIALS < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
fi

for serial in "${SERIALS[@]}"; do
  adb -s "$serial" wait-for-device
  until [[ "$(adb -s "$serial" shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; do sleep 2; done
  # sys.boot_completed can precede the package manager service; an install then fails with
  # "Failure calling service package: Broken pipe". Wait until it answers (at most 3 minutes).
  for ((tries = 0; ; tries++)); do
    adb -s "$serial" shell pm path android 2>/dev/null | grep -q '^package:' && break
    ((tries < 90)) || { echo "prepare-emulator: $serial package manager not ready" >&2; exit 1; }
    sleep 2
  done
  for key in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb -s "$serial" shell settings put global "$key" 0
  done
  adb -s "$serial" shell am set-debug-app --persistent com.android.chrome
  adb -s "$serial" shell "echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
  echo "prepare-emulator: $serial ready"
done
