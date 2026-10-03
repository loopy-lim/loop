#!/usr/bin/env bash
# v10 capture driver (task showcase-v10): the QR pairing demo — scan once,
# stay connected (decision docs/decisions/2026-xx-qr-pairing.md).
#
#   01  CLI `loop pair` printing the loop:// pairing payload + ASCII QR
#       (operator surface — the thing a phone would scan).
#   02  The iOS simulator receiving the SAME payload as a cold `simctl
#       openurl` deep link (the automation equivalent of a system-camera
#       scan), approving the OS open-confirmation banner, and landing in the
#       gateway-connected Chats list. No manual typing anywhere.
#   03  A plain relaunch with NO launch env: the tokenless connection setting
#       (host:port + mode marker in the keychain) auto-restores and the app
#       lands connected again — "stay connected".
#
# Prereqs (once, after any app change):
#   cd apps/loop-mobile && bash scripts/build-ios-simulator.sh
#
# What is automated vs human: simctl openurl REPLACES the physical camera
# scan; the OS open-confirmation banner is approved by one scripted click.
# The banner appears only on the FIRST loop:// open after a fresh install,
# so the script uninstalls/reinstalls first — making the banner, its fixed
# position (center of the simulator window: verified identical across
# installs), and the single approval click deterministic. Everything the app
# does (parse → prefill → probe → connect → persist → relaunch restore) is
# the production code path. No real device, no paid model calls, and the
# payload carries no secret (tokenless pairing only).
#
# One-time OS consents (interactive, asked only the first run): Automation
# consent for osascript → Terminal/System Events, Accessibility for the
# synthetic click.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

OUT=docs/research/simulator-showcase/v10
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
[ -n "$UDID" ] || { echo "no booted simulator" >&2; exit 1; }
BUNDLE=org.reactjs.native.example.LoopMobile
# The pairing payload: the exact golden payload the CLI QR renders
# (packages/cli + apps/loop-desktop share it; see pairing-qr-golden.json).
PAIR_HOST=loopy-macbookpro.tail42f248.ts.net
PAIR_PORT=18477
PAIR_URL="loop://connect?host=${PAIR_HOST}&port=${PAIR_PORT}"

# ---------------------------------------------------------------- preflight
echo "== preflight: gateway must be running before any capture =="
GW_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://${PAIR_HOST}:${PAIR_PORT}/v1/runs" || echo "000")
[ "$GW_CODE" = "200" ] || { echo "gateway ${PAIR_HOST}:${PAIR_PORT} not reachable (got $GW_CODE) — start it first (bun run gateway:serve)" >&2; exit 1; }
echo "gateway ${PAIR_HOST}:${PAIR_PORT} /v1/runs -> $GW_CODE (MagicDNS tailnet address — the QR payload target)"

# ---------------------------------------------------- 1/3 CLI QR (operator)
echo "== 1/3 CLI pair: terminal window printing the pairing QR =="
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
open -a Terminal; sleep 3
osascript <<EOF >/dev/null
tell application "Terminal"
  do script "clear; cd '$PWD' && LOOP_GATEWAY_PORT=${PAIR_PORT} bun packages/cli/src/main.ts pair --host ${PAIR_HOST}"
end tell
EOF
sleep 6
TERM_WIN_ID=$(osascript -e 'tell application "Terminal" to id of window 1')
screencapture -x -l "$TERM_WIN_ID" "$ROOT/$OUT/01-cli-pair-qr.png"
echo "captured $OUT/01-cli-pair-qr.png (Terminal window $TERM_WIN_ID)"
osascript -e 'tell application "Terminal" to close window 1' >/dev/null

# ---------------------------------------------------- deeplink click target
# Simulator window geometry (live, so a moved window stays correct): the
# open-confirmation banner sits at a fixed FRACTION of the window content —
# measured (603,1105)px of the 912x1944 window capture → (0.660, 0.568).
read -r WIN_X WIN_Y WIN_W WIN_H < <(osascript \
  -e 'tell application "Simulator" to activate' -e 'delay 0.3' \
  -e 'tell application "System Events" to tell process "Simulator"' \
  -e   'set p to position of window 1' -e 'set s to size of window 1' \
  -e   'return ((item 1 of p) as text) & " " & ((item 2 of p) as text) & " " & ((item 1 of s) as text) & " " & ((item 2 of s) as text)' \
  -e 'end tell' | tr -d ',')
CLICK_X=$(( WIN_X + (WIN_W * 660) / 1000 ))
CLICK_Y=$(( WIN_Y + (WIN_H * 568) / 1000 ))
echo "simulator window at ($WIN_X,$WIN_Y) ${WIN_W}x${WIN_H} → banner approval click at ($CLICK_X,$CLICK_Y)"

# ------------------------------------------- 2/3 deeplink scan → Chats list
echo "== 2/3 scan equivalent: cold simctl openurl with the QR payload =="
# Fresh install: (a) the keychain may hold an older credential whose probe
# adds noise, and (b) iOS shows the open-confirmation banner only on the
# FIRST loop:// open per install — a fresh install makes the banner (and the
# one scripted approval click) deterministic.
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$UDID" "$ROOT/apps/loop-mobile/ios/build/Build/Products/Release-iphonesimulator/LoopMobile.app"
sleep 1
xcrun simctl openurl "$UDID" "$PAIR_URL"
sleep 2.5   # banner is up (fixed screen position — verified across installs)
osascript -e 'tell application "Simulator" to activate' \
          -e 'delay 0.3' \
          -e "tell application \"System Events\" to click at {$CLICK_X, $CLICK_Y}" >/dev/null
sleep 11    # cold JS boot → parse → prefill → probe → connect → Chats list
xcrun simctl io "$UDID" screenshot "$ROOT/$OUT/02-deeplink-connect-chats.png" >/dev/null
echo "captured $OUT/02-deeplink-connect-chats.png"

# ------------------------------------------- 3/3 relaunch: stays connected
echo "== 3/3 relaunch with no env: tokenless setting restores =="
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
sleep 1.5
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null   # NO LOOP_SHOWCASE_* env at all
sleep 10    # keychain read (tokenless marker) → probe → restored → Chats list
xcrun simctl io "$UDID" screenshot "$ROOT/$OUT/03-relaunch-stays-connected.png" >/dev/null
echo "captured $OUT/03-relaunch-stays-connected.png"

# ------------------------------------------------------------ text evidence
echo "== launch-key log lines (keys only — no values, AGENTS.md) =="
xcrun simctl spawn "$UDID" log show --last 5m --style compact \
  --predicate 'eventMessage CONTAINS "showcase-launch"' 2>/dev/null | grep showcase-launch || true
echo "== integrity: three distinct captures =="
md5 -q "$ROOT/$OUT"/01-cli-pair-qr.png "$ROOT/$OUT"/02-deeplink-connect-chats.png "$ROOT/$OUT"/03-relaunch-stays-connected.png
echo "v10 capture complete."
