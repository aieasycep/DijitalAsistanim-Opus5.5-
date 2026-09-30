#!/usr/bin/env bash
# Emulator preparation for the Maestro run (TEST_PLAN §9.1): no animations, no Chrome first-run
# (the demo OAuth Custom Tab), nothing else pre-installed. Usage: prepare-emulator.sh [serial ...]
set -euo pipefail

SERIALS=("$@")
if [[ ${#SERIALS[@]} -eq 0 ]]; then
  mapfile -t SERIALS < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
fi

# A framework restart (the locale change below) leaves sys.boot_completed at 1 while
# system_server is down: device commands then fail with "Failure calling service package /
# activity: Broken pipe". Ready means the package and activity services answer three times in a
# row, two seconds apart (at most 4 minutes).
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

# The flows expect Turkish. The emulator's own `-change-locale` restarts the framework right after
# boot, racing the emulator action's first adb command, so the locale is set here instead: as root
# (google_apis images allow it), then a framework restart and the same readiness wait.
LOCALE="${E2E_LOCALE:-tr-TR}"
set_locale() {
  local serial="$1"
  [[ "$(adb -s "$serial" shell getprop persist.sys.locale | tr -d '\r')" == "$LOCALE" ]] && return 0
  adb -s "$serial" root >/dev/null
  adb -s "$serial" wait-for-device
  on_device "$serial" "setprop persist.sys.locale $LOCALE; setprop ctl.restart zygote"
  sleep 5
  wait_for_services "$serial"
  if [[ "$(adb -s "$serial" shell getprop persist.sys.locale | tr -d '\r')" != "$LOCALE" ]]; then
    echo "prepare-emulator: $serial locale is not $LOCALE" >&2
    return 1
  fi
}

for serial in "${SERIALS[@]}"; do
  adb -s "$serial" wait-for-device
  until [[ "$(adb -s "$serial" shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; do sleep 2; done
  wait_for_services "$serial"
  set_locale "$serial"
  for key in window_animation_scale transition_animation_scale animator_duration_scale; do
    on_device "$serial" settings put global "$key" 0
  done
  on_device "$serial" am set-debug-app --persistent com.android.chrome
  on_device "$serial" "echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
  echo "prepare-emulator: $serial ready"
done
