#!/usr/bin/env bash
# Prebuild smoke (C-MOB-SMOKE, T-8.01; INTEGRATION_PLAN §0.5 / §12.1).
#
# For every APP_ENV, copies apps/mobile (sources only) into a throwaway directory whose
# node_modules is a symlink to the real one, runs
#   EXPO_OFFLINE=1 npx expo prebuild --clean --no-install --platform all
# with a clean environment (identifier defaults only), and asserts the generated native projects:
# bundle ID / package, URL scheme, App Group, entitlements, share extension, SDK levels, usage
# strings and app links. Production must carry exactly the M§108 identifiers.
#
# Usage: bash scripts/mobile/prebuild-smoke.sh [APP_ENV ...]   (default: all four variants)
#        KEEP_PREBUILD=1 keeps the temp directory for inspection.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/apps/mobile"
BASE_ID="com.dijitalasistan.app"
BASE_SCHEME="dijitalasistan"
WEB_HOST="dijitalasistan.app"
SHARE_TARGET="DijitalAsistanaEkle"

if [[ ! -x "$APP/node_modules/.bin/expo" ]]; then
  echo "prebuild-smoke: apps/mobile/node_modules is missing; run pnpm install first" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/da-prebuild-smoke.XXXXXX")"
cleanup() {
  if [[ "${KEEP_PREBUILD:-0}" == "1" ]]; then
    echo "prebuild-smoke: kept $WORK"
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

FAILURES=0
fail() {
  echo "  ✗ $*" >&2
  FAILURES=$((FAILURES + 1))
}

# expect_contains <file> <fixed string> [label]
expect_contains() {
  local file="$1" needle="$2" label="${3:-$2}"
  if [[ ! -f "$file" ]]; then
    fail "${file#"$WORK"/} is missing (wanted: $label)"
  elif ! grep -qF -- "$needle" "$file"; then
    fail "${file#"$WORK"/} lacks $label"
  fi
}

# expect_absent <file> <fixed string> [label]
expect_absent() {
  local file="$1" needle="$2" label="${3:-$2}"
  if [[ -f "$file" ]] && grep -qF -- "$needle" "$file"; then
    fail "${file#"$WORK"/} must not contain $label"
  fi
}

# expect_once <file> <fixed string> [label]
expect_once() {
  local file="$1" needle="$2" label="${3:-$2}" count
  count="$(grep -cF -- "$needle" "$file" 2>/dev/null || true)"
  if [[ "${count:-0}" != "1" ]]; then
    fail "${file#"$WORK"/} has $label ${count:-0} times (expected once)"
  fi
}

copy_app() {
  local dest="$1"
  mkdir -p "$dest"
  tar -C "$APP" \
    --exclude=./node_modules --exclude=./ios --exclude=./android \
    --exclude=./.expo --exclude=./.expo-export -cf - . | tar -C "$dest" -xf -
  ln -s "$APP/node_modules" "$dest/node_modules"
}

run_prebuild() {
  local dest="$1" app_env="$2"
  # A clean environment: only the variant is set, so every identifier comes from its default.
  (
    cd "$dest"
    env -i PATH="$PATH" HOME="${HOME:-$dest}" LANG="${LANG:-C.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
      CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_NO_GIT_STATUS=1 APP_ENV="$app_env" \
      npx --no expo prebuild --clean --no-install --platform all
  ) >"$dest.log" 2>&1 || {
    cat "$dest.log" >&2
    fail "expo prebuild failed for APP_ENV=$app_env"
    return 1
  }
}

assert_variant() {
  local dest="$1" app_env="$2" suffix="$3" project="$4"
  local id="$BASE_ID" scheme="$BASE_SCHEME"
  if [[ -n "$suffix" ]]; then
    id="$BASE_ID.$suffix"
    scheme="$BASE_SCHEME-$suffix"
  fi
  local group="group.$id"
  local ios="$dest/ios" android="$dest/android"
  local plist="$ios/$project/Info.plist"
  local entitlements="$ios/$project/$project.entitlements"
  local pbxproj="$ios/$project.xcodeproj/project.pbxproj"
  local manifest="$android/app/src/main/AndroidManifest.xml"

  # iOS: identifiers, scheme, App Group, capabilities.
  expect_contains "$pbxproj" "PRODUCT_BUNDLE_IDENTIFIER = $id;" "bundle ID $id"
  expect_contains "$pbxproj" "PRODUCT_BUNDLE_IDENTIFIER = \"$id.share-extension\";" \
    "share extension bundle ID $id.share-extension"
  expect_contains "$pbxproj" "IPHONEOS_DEPLOYMENT_TARGET = 16.4;" "deployment target 16.4"
  expect_contains "$plist" "<string>$scheme</string>" "URL scheme $scheme"
  expect_contains "$plist" "<key>CFBundleDevelopmentRegion</key>" "development region"
  expect_contains "$plist" "<key>ITSAppUsesNonExemptEncryption</key>" "encryption declaration"
  expect_contains "$plist" "<string>com.expo.modules.backgroundtask.processing</string>" \
    "background task identifier"
  expect_contains "$plist" "Asistana sesle soru sorabilmen" "Turkish microphone usage string"
  expect_contains "$ios/$project/Supporting/en.lproj/InfoPlist.strings" "ask the assistant by voice" \
    "English microphone usage string"
  expect_once "$entitlements" "<string>$group</string>" "App Group $group"
  expect_contains "$entitlements" "<string>applinks:$WEB_HOST</string>" "associated domain"
  expect_contains "$entitlements" "com.apple.developer.applesignin" "Sign in with Apple"
  expect_contains "$entitlements" "com.apple.developer.usernotifications.time-sensitive" \
    "time-sensitive notifications"
  expect_contains "$ios/$SHARE_TARGET/ShareExtension.entitlements" "<string>$group</string>" \
    "share extension App Group"
  expect_contains "$ios/$project/PrivacyInfo.xcprivacy" "1C8F.1" "App Group UserDefaults reason"

  # Android: package, scheme, links, permissions, SDK levels.
  expect_contains "$android/app/build.gradle" "applicationId '$id'" "applicationId $id"
  expect_contains "$android/app/build.gradle" "namespace '$id'" "namespace $id"
  expect_contains "$manifest" "android:scheme=\"$scheme\"" "scheme $scheme"
  expect_contains "$manifest" "android:host=\"$WEB_HOST\" android:pathPrefix=\"/app\"" \
    "verified /app link"
  expect_contains "$manifest" "android:autoVerify=\"true\"" "autoVerify"
  expect_contains "$manifest" "android:allowBackup=\"false\"" "allowBackup=false"
  expect_contains "$manifest" "android.permission.POST_NOTIFICATIONS" "POST_NOTIFICATIONS"
  expect_contains "$manifest" \
    "<uses-permission android:name=\"android.permission.READ_MEDIA_IMAGES\" tools:node=\"remove\"/>" \
    "blocked READ_MEDIA_IMAGES"
  expect_contains "$manifest" \
    "<uses-permission android:name=\"com.google.android.gms.permission.AD_ID\" tools:node=\"remove\"/>" \
    "blocked AD_ID"
  expect_contains "$manifest" "android:mimeType=\"application/pdf\"" "PDF share intent"
  expect_contains "$manifest" "android:launchMode=\"singleTask\"" "singleTask launch mode"
  expect_contains "$android/gradle.properties" "android.compileSdkVersion=36" "compileSdk 36"
  expect_contains "$android/gradle.properties" "android.targetSdkVersion=36" "targetSdk 36"
  expect_contains "$android/gradle.properties" "android.minSdkVersion=24" "minSdk 24"
  expect_contains "$android/gradle.properties" "hermesEnabled=true" "Hermes"
  expect_contains "$android/app/src/main/res/values/strings.xml" "expo_runtime_version" \
    "fingerprint runtime version resource"

  if [[ -z "$suffix" ]]; then
    # Production carries no variant identifiers at all.
    for other in dev preview e2e; do
      expect_absent "$pbxproj" "$BASE_ID.$other" "a .$other identifier"
      expect_absent "$manifest" "$BASE_SCHEME-$other" "a -$other scheme"
      expect_absent "$entitlements" "group.$BASE_ID.$other" "a .$other App Group"
    done
  fi
}

VARIANTS=("$@")
if [[ ${#VARIANTS[@]} -eq 0 ]]; then
  VARIANTS=(development preview e2e production)
fi

for app_env in "${VARIANTS[@]}"; do
  case "$app_env" in
    development) suffix="dev" project="DijitalAsistanDev" ;;
    preview) suffix="preview" project="DijitalAsistanPreview" ;;
    e2e) suffix="e2e" project="DijitalAsistanE2E" ;;
    production) suffix="" project="DijitalAsistan" ;;
    *)
      echo "prebuild-smoke: unknown APP_ENV $app_env" >&2
      exit 2
      ;;
  esac
  dest="$WORK/$app_env"
  echo "prebuild-smoke: $app_env"
  copy_app "$dest"
  before=$FAILURES
  if run_prebuild "$dest" "$app_env"; then
    assert_variant "$dest" "$app_env" "$suffix" "$project"
  fi
  if [[ $FAILURES -eq $before ]]; then
    id="$BASE_ID${suffix:+.$suffix}"
    echo "  ✓ $id · ${BASE_SCHEME}${suffix:+-$suffix} · group.$id · ios/$project + $SHARE_TARGET · android"
  fi
done

if [[ $FAILURES -gt 0 ]]; then
  echo "prebuild-smoke: $FAILURES assertion(s) failed" >&2
  exit 1
fi
echo "prebuild-smoke: ${#VARIANTS[@]} variant(s) passed"
