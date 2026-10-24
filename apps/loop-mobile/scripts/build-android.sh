#!/usr/bin/env bash
# Build the Loop mobile app for the Android emulator (Release APK, self-
# contained JS bundle — no Metro dev server needed at launch), install and
# launch it on the running emulator (boots the loop-test AVD headlessly when
# none is running). Android counterpart of build-ios-simulator.sh.
#
# Toolchain layout (this machine, no sudo): JDK at ~/tools/jdk17, Android
# SDK at ~/android-sdk (ANDROID_HOME). Deterministic: no network beyond
# gradle/maven artifact fetches, no model call.
#
# Usage: bun run android:release [abi]
#   abi defaults to x86_64 (the emulator's architecture); pass
#   "arm64-v8a" for a physical-device APK.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$APP_DIR/android"
ABI="${1:-x86_64}"
AVD_NAME="${ANDROID_AVD_NAME:-loop-test}"
PACKAGE="com.loopmobile"

export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# The release bundling step shells out to `node`; in fnm shells a fresh
# environment may not have it on PATH — fall back to the newest install.
if ! command -v node > /dev/null 2>&1; then
  FNM_NODE=$(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin 2>/dev/null | sort -V | tail -1)
  if [ -n "$FNM_NODE" ]; then
    export PATH="$FNM_NODE:$PATH"
  fi
fi
if ! command -v node > /dev/null 2>&1; then
  echo "build-android: node not found on PATH (required for JS bundling)" >&2
  exit 1
fi

ADB="$ANDROID_HOME/platform-tools/adb"
if ! [ -x "$ADB" ]; then
  echo "build-android: adb missing at $ADB — install the Android SDK first" >&2
  exit 1
fi

# KVM acceleration needs group access (crw-rw---- root:kvm). Without it the
# emulator falls back to pure software emulation (TCG): boots, but slowly.
if ! [ -r /dev/kvm ] || ! [ -w /dev/kvm ]; then
  echo "build-android: WARNING: no /dev/kvm access — emulator runs unaccelerated." >&2
  echo "  One-time fix (then re-login): sudo usermod -aG kvm \$USER" >&2
fi

SERIAL=$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 ~ /emulator-/ {print $1; exit}')
if [ -z "$SERIAL" ]; then
  EMULATOR="$ANDROID_HOME/emulator/emulator"
  if ! [ -x "$EMULATOR" ]; then
    echo "build-android: emulator missing — install the SDK emulator package first" >&2
    exit 1
  fi
  echo "build-android: booting headless AVD $AVD_NAME"
  nohup "$EMULATOR" -avd "$AVD_NAME" -no-window -gpu swiftshader_indirect \
    -no-audio -no-boot-anim -no-snapshot >/tmp/loop-android-emulator.log 2>&1 &
  for i in $(seq 1 120); do
    SERIAL=$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 ~ /emulator-/ {print $1; exit}')
    [ -n "$SERIAL" ] && break
    sleep 2
  done
  [ -n "$SERIAL" ] || { echo "build-android: emulator did not come online" >&2; exit 1; }
  "$ADB" -s "$SERIAL" wait-for-device
  for i in $(seq 1 120); do
    BOOTED=$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    [ "$BOOTED" = "1" ] && break
    sleep 2
  done
  [ "$BOOTED" = "1" ] || { echo "build-android: emulator did not finish booting" >&2; exit 1; }
fi
echo "build-android: emulator online ($SERIAL)"

cd "$ANDROID_DIR"
./gradlew assembleRelease -PreactNativeArchitectures="$ABI"

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell am start -n "$PACKAGE/.MainActivity" >/dev/null
echo "build-android: installed and launched $PACKAGE on $SERIAL"
