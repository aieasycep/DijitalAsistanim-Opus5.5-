#!/usr/bin/env bash
# JVM unit tests of the pure-Kotlin rules of the local Android modules: the Notification
# Intelligence package denylist, OTP / security detector, signal extractor and listener health
# (T-8.26, KPL-04), and the da-platform exact-alarm / battery rules (KPL-09). They are pure Kotlin,
# so no Android SDK is needed; the Gradle build in modules/notification-intelligence/jvm-test
# compiles only them.
#
# Usage: pnpm --filter @da/mobile ni:test     (GRADLE=/path/to/gradle overrides the binary)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="$HERE/modules/notification-intelligence"
SRC="$MODULE/android/src/main/java/expo/modules/notificationintelligence"
PLATFORM_SRC="$HERE/modules/da-platform/android/src/main/java/expo/modules/daplatform"

# The rule files must stay free of Android APIs, or the JVM build (and these tests) cannot run.
for file in "$SRC/PackageRules.kt" "$SRC/OtpDetector.kt" "$SRC/SignalExtractor.kt" \
  "$SRC/ListenerHealth.kt" "$PLATFORM_SRC/PlatformRules.kt"; do
  if grep -nE '^import (android|androidx|expo)\.' "$file"; then
    echo "ni-test: $(basename "$file") must not import android.*, androidx.* or expo.*" >&2
    exit 1
  fi
done

GRADLE_BIN="${GRADLE:-}"
if [[ -z "$GRADLE_BIN" ]]; then
  if command -v gradle >/dev/null 2>&1; then
    GRADLE_BIN="$(command -v gradle)"
  elif [[ -x /opt/gradle/bin/gradle ]]; then
    GRADLE_BIN=/opt/gradle/bin/gradle
  else
    echo "ni-test: Gradle is not installed (set GRADLE=/path/to/gradle)" >&2
    exit 1
  fi
fi

# Maven Central answers bursts with 429; let Gradle back off and retry instead of failing.
exec "$GRADLE_BIN" -p "$MODULE/jvm-test" test --no-daemon --console=plain \
  -Dorg.gradle.internal.repository.max.tentatives=12 \
  -Dorg.gradle.internal.repository.initial.backoff=3000
