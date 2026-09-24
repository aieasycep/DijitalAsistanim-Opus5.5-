#!/usr/bin/env bash
# JVM unit tests of the Android Notification Intelligence rules (T-8.26): the package denylist, the
# OTP / security detector and the signal extractor. They are pure Kotlin, so no Android SDK is
# needed; the Gradle build in modules/notification-intelligence/jvm-test compiles only them.
#
# Usage: pnpm --filter @da/mobile ni:test     (GRADLE=/path/to/gradle overrides the binary)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE="$HERE/modules/notification-intelligence"
SRC="$MODULE/android/src/main/java/expo/modules/notificationintelligence"

# The rule files must stay free of Android APIs, or the JVM build (and these tests) cannot run.
for file in PackageRules.kt OtpDetector.kt SignalExtractor.kt; do
  if grep -nE '^import (android|androidx|expo)\.' "$SRC/$file"; then
    echo "ni-test: $file must not import android.*, androidx.* or expo.*" >&2
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
