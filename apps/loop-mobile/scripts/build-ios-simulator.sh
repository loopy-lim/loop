#!/usr/bin/env bash
# Build the Loop mobile app for the iOS simulator (Release configuration,
# self-contained JS bundle — no Metro dev server needed at launch) and boot
# it. Deterministic: no network beyond CocoaPods/Xcode artifact fetches, no
# model call. See docs/research/app-device-install.md §5 and
# docs/research/simulator-showcase/README.md.
#
# Usage: bun run ios:release [device-name]
#   device-name defaults to the first booted simulator, else "iPhone 17".
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$APP_DIR/ios"
DEVICE="${1:-}"

cd "$IOS_DIR"

if ! [ -d Pods ]; then
  echo "build-ios-simulator: Pods missing; run 'bun run pod' first" >&2
  exit 1
fi

# Prefer the booted simulator by UDID: device names can be ambiguous across
# runtimes (e.g. "iPhone 17" exists on both iOS 26.2 and 26.3.1).
BOOTED_UDID=$(xcrun simctl list devices booted | sed -n 's/^[[:space:]]*.* (\([0-9A-F-]\{36\}\)) (Booted)[[:space:]]*$/\1/p' | head -1)
if [ -n "$BOOTED_UDID" ]; then
  DEST="platform=iOS Simulator,id=$BOOTED_UDID"
elif [ -n "$DEVICE" ]; then
  DEST="platform=iOS Simulator,name=$DEVICE"
else
  DEST="platform=iOS Simulator,name=iPhone 17"
fi

xcodebuild \
  -workspace LoopMobile.xcworkspace \
  -scheme LoopMobile \
  -configuration Release \
  -destination "$DEST" \
  -derivedDataPath "$IOS_DIR/build" \
  build

APP_PATH="$IOS_DIR/build/Build/Products/Release-iphonesimulator/LoopMobile.app"
SIMUDID=$(xcrun simctl list devices booted | sed -n 's/^[[:space:]]*.* (\([0-9A-F-]\{36\}\)) (Booted)[[:space:]]*$/\1/p' | head -1)
if [ -z "$SIMUDID" ]; then
  SIMUDID=$(xcrun simctl list devices available | sed -n 's/^[[:space:]]*.* (\([0-9A-F-]\{36\}\)) (iPhone 17)[[:space:]]*$/\1/p' | head -1)
  xcrun simctl boot "$SIMUDID"
fi

xcrun simctl install "$SIMUDID" "$APP_PATH"
BUNDLE_ID=$(defaults read "$APP_PATH/Info.plist" CFBundleIdentifier 2>/dev/null || xcodebuild -showBuildSettings -workspace LoopMobile.xcworkspace -scheme LoopMobile 2>/dev/null | grep -m1 PRODUCT_BUNDLE_IDENTIFIER | awk '{print $3}')
xcrun simctl launch "$SIMUDID" "$BUNDLE_ID"
echo "build-ios-simulator: installed and launched $BUNDLE_ID on simulator $SIMUDID"
