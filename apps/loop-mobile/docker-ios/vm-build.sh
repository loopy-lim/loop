#!/usr/bin/env bash
#
# docker-ios/vm-build.sh — sync+build+install inside the macOS VM. Invoked
# over SSH by apps/loop-mobile/scripts/build-ios-docker.sh after provisioning
# and after the human has signed into Xcode with the team's Apple ID.
#
# Usage: vm-build.sh <repo-dir> [--team TEAM_ID] [--install]
#   --team     DEVELOPMENT_TEAM for automatic signing (falls back to
#              $LOOP_DEVICE_TEAM, the same .env key device-build-wizard.sh writes)
#   --install  also install+launch on the first iPhone visible to devicectl
#
# Build contract mirrors scripts/device-build-wizard.sh stages 4–5:
# Release, CODE_SIGN_STYLE=Automatic, -allowProvisioningUpdates, then
# xcrun devicectl device install app + process launch.

set -euo pipefail

REPO="${1:?usage: vm-build.sh <repo-dir> [--team TEAM_ID] [--install]}"
shift || true

TEAM_ID="${LOOP_DEVICE_TEAM:-}"
INSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --team)    TEAM_ID="${2:?--team needs a TEAM_ID}"; shift 2 ;;
    --install) INSTALL=1; shift ;;
    *) echo "vm-build: unknown argument: $1" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v bun   >/dev/null 2>&1 || { echo "vm-build: bun missing — run vm-provision.sh first" >&2; exit 1; }
command -v pod   >/dev/null 2>&1 || { echo "vm-build: cocoapods missing — run vm-provision.sh first" >&2; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "vm-build: Xcode missing — run vm-provision.sh first" >&2; exit 1; }
[ -d "$REPO" ] || { echo "vm-build: repo dir not found: $REPO" >&2; exit 1; }

cd "$REPO"

echo "vm-build: bun install..."
bun install

echo "vm-build: pod install..."
( cd ios && pod install )

echo "vm-build: xcodebuild Release (team: ${TEAM_ID:-<project default>})..."
TEAM_ARGS=()
[ -n "$TEAM_ID" ] && TEAM_ARGS+=("DEVELOPMENT_TEAM=$TEAM_ID")
xcodebuild \
  -workspace LoopMobile.xcworkspace \
  -scheme LoopMobile \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  ${TEAM_ARGS[@]+"${TEAM_ARGS[@]}"} \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -derivedDataPath "$REPO/ios/build" \
  build

APP="$REPO/ios/build/Build/Products/Release-iphoneos/LoopMobile.app"
echo "vm-build: built $APP"

if [ "$INSTALL" -ne 1 ]; then
  echo "vm-build: --install not given; done (app at $APP)"
  exit 0
fi

# First iPhone devicectl can see (pair it once over USB or Wi-Fi first).
DEVICE_ID="$(xcrun devicectl list devices 2>/dev/null \
  | awk '/iPhone/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/) { print $i; exit } }')"
if [ -z "$DEVICE_ID" ]; then
  echo "vm-build: no iPhone visible to devicectl." >&2
  echo "  Pair once: attach via usbipd + QEMU usb-host (docker-ios/README.md)," >&2
  echo "  trust the VM on the phone, then pair in Xcode's Devices window." >&2
  echo "  App is built; you can also pull $APP to the host and sideload." >&2
  exit 3
fi

echo "vm-build: installing to device $DEVICE_ID..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
BUNDLE_ID="$(defaults read "$APP/Info.plist" CFBundleIdentifier)"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
echo "vm-build: installed and launched $BUNDLE_ID on $DEVICE_ID"
