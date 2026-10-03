#!/usr/bin/env bash
# Header-as-status-bar verification capture (task header-showcase-verify).
# Rebuild-first is done by the caller (build-ios-simulator.sh); this script
# relaunches the freshly installed app against the demo gateway's fake data
# and captures the status-bar-substitute header rounds:
#   01 chats list  (left title / right logout glyph, island center empty)
#   02 conversation header (back+title left, actions right)
#   03 logout menu open (header icon tap -> confirmation alert surface)
#   04 destructive confirm -> Keychain deleted -> Connect screen
#   05 relaunch with no env -> stays logged out (restore gone)
# Pixel calibration: the simulator window is pre-measured once; the device
# screen maps 1:1 to screen points at origin (WINX,WINY) below. Taps go
# through cliclick; the destructive target is located per-frame from the
# live screenshot (red destructive text bbox), never hardcoded.
# No model calls, nothing paid, no real device.
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # repo root

PORT=18588
OUT=docs/research/simulator-showcase/review-header
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
# Device-screen origin in mac screen points at Point Accurate scale
# (calibrated 2026-09-27 against the booted iPhone 17; re-measure if the
# window moves or the scale menu changes — see README).
WINX=1289
WINY=165
mkdir -p "$OUT"

shot() { xcrun simctl io "$UDID" screenshot "$1" >/dev/null; }

launch() {  # launch <KEY=value ...> — extra LOOP_SHOWCASE_* launch env
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  sleep 1
  env \
  SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token \
  SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
  SIMCTL_CHILD_LOOP_SHOWCASE_PORT="$PORT" \
  SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
  "$@" \
    xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
}

tap_dev_px() {  # tap_dev_px <device_px_x> <device_px_y>
  local PT
  PT=$(python3 -c "print(f'c:{round($WINX + $1/3)},{round($WINY + $2/3)}')")
  cliclick "$PT"
}

echo "== gateway: demo gateway on 127.0.0.1:$PORT (fake data), real launchd gateway recorded =="
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true
bun apps/loop-mobile/scripts/demo-gateway.ts "$PORT" --max-runs=2 &
GW=$!
trap 'kill "$GW" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" && break; sleep 0.5; done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" || { echo "demo gateway not ready" >&2; exit 1; }
echo "== demo gateway 200; real gateway: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18477/v1/runs) on /v1/runs =="

echo "== 1/5 chats list, left/right header =="
launch
sleep 8
shot "$OUT/01-chats-header.png"

echo "== 2/5 conversation header (back+title left, actions right) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_details_0005
sleep 7
shot "$OUT/02-conversation-header.png"

echo "== 3/5 chats again; tap header logout icon -> confirmation surface =="
launch
sleep 8
# Logout glyph center measured from the live frame (device px), not assumed.
shot /tmp/rh-pre.png
GLYPH=$(python3 - "$OUT" <<'EOF'
import sys
from PIL import Image
im = Image.open('/tmp/rh-pre.png').convert('RGB')
px = im.load()
# muted-ink glyph in the header's right corner: brightest pixels x>1000,y<160
pts = [(x, y) for y in range(0, 160) for x in range(1000, 1206)
       if sum(px[x, y]) > 330]
assert pts, 'no logout glyph pixels found in header right corner'
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
print(int((min(xs) + max(xs)) / 2), int((min(ys) + max(ys)) / 2))
EOF
)
read -r GX GY <<<"$GLYPH"
echo "   logout glyph center device px: $GX,$GY"
tap_dev_px "$GX" "$GY"
sleep 2
shot "$OUT/03-logout-menu-open.png"

echo "== 4/5 destructive confirm -> Keychain delete -> Connect =="
RED=$(python3 - <<'EOF'
from PIL import Image
im = Image.open('docs/research/simulator-showcase/review-header/03-logout-menu-open.png').convert('RGB')
px = im.load()
pts = [(x, y) for y in range(700, 2000, 2) for x in range(0, 1206, 2)
       if px[x, y][0] > 180 and px[x, y][1] < 90 and px[x, y][2] < 90]
assert pts, 'no destructive red text found — alert did not open'
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
print(int((min(xs) + max(xs)) / 2), int((min(ys) + max(ys)) / 2))
EOF
)
read -r RX RY <<<"$RED"
echo "   destructive button center device px: $RX,$RY"
tap_dev_px "$RX" "$RY"
sleep 2.5
shot "$OUT/04-logout-confirmed-connect.png"

echo "== 5/5 relaunch with no env -> stays logged out =="
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
sleep 1
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
sleep 6
shot "$OUT/05-relaunch-stays-logged-out.png"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "== distinctness check =="
md5 -r "$OUT"/*.png
ls -la "$OUT"
