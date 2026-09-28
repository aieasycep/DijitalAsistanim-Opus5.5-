#!/usr/bin/env bash
# Emulator preparation for the Maestro run (TEST_PLAN §9.1): no animations, no Chrome first-run
# (the demo OAuth Custom Tab), nothing else pre-installed. Usage: prepare-emulator.sh [serial ...]
set -euo pipefail

SERIALS=("$@")
if [[ ${#SERIALS[@]} -eq 0 ]]; then
  mapfile -t SERIALS < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
fi

# The emulator restarts the Android framework after boot when it applies `-change-locale`, so
# sys.boot_completed can read 1 while system_server is down: installs then fail with "Failure
# calling service package / activity: Broken pipe". Ready means the package and activity services
# answer three times in a row, two seconds apart (at most 4 minutes).
wait_for_services() {
  local serial="$1" streak=0
  for ((tries = 0; tries < 120; tries++)); do
    if adb -s "$serial" shell pm path android 2>/dev/null | grep -q '^package:' &&
      adb -s "$serial" shell am get-current-user >/dev/null 2>&1; then
      streak=$((streak + 1))
      ((streak >= 3)) && return 0
    else
      streak=0
    fi
    sleep 2
  done
  echo "prepare-emulator: $serial system services not ready" >&2
  return 1
}

# A device command that can still meet a restarting service is retried a few times.
on_device() {
  local serial="$1"
  shift
  for attempt in 1 2 3 4 5; do
    adb -s "$serial" shell "$@" && return 0
    sleep $((attempt * 3))
  done
  echo "prepare-emulator: $serial: '$*' kept failing" >&2
  return 1
}

for serial in "${SERIALS[@]}"; do
  adb -s "$serial" wait-for-device
  until [[ "$(adb -s "$serial" shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; do sleep 2; done
  wait_for_services "$serial"
  for key in window_animation_scale transition_animation_scale animator_duration_scale; do
    on_device "$serial" settings put global "$key" 0
  done
  on_device "$serial" am set-debug-app --persistent com.android.chrome
  on_device "$serial" "echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
  echo "prepare-emulator: $serial ready"
done
