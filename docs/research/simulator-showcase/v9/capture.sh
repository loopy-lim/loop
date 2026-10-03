#!/usr/bin/env bash
# v9 capture driver (task showcase-v9): scripted-session screenshots for the
# v9 promotions — composer photo attach (thumbnails → send → inline user
# image), syntax-highlighted code block, and the beauty-pass look — against
# the demo gateway's fake data. No real device, no model calls, nothing
# paid; both demo images are generated locally in demo-gateway.ts.
#
# Prereqs (done once, after any app change):
#   cd apps/loop-mobile && bash scripts/build-ios-simulator.sh   # Release build + install
#
# What this script does:
#   0. confirms a gateway is reachable BEFORE any capture: the real
#      gateway's /v1/runs is probed and its status is recorded (evidence
#      only — captures never depend on it), and the demo gateway is
#      hard-gated on a 200;
#   1. starts the fake-data demo gateway on loopback:18588 fresh per run
#      (the input route's pushed frame is once-per-process);
#   2. launches the installed app four times with LOOP_SHOWCASE_* launch
#      env — the exact showcase hooks a human tap would drive (attach
#      enters the flow at the same continuation the OS photo picker feeds);
#   3. screenshots each promotion into this directory.
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # repo root

PORT=18588
OUT=docs/research/simulator-showcase/v9
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile

echo "== preflight: real gateway probe (evidence only) =="
REAL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://100.80.133.120:18477/v1/runs || echo "000")
echo "real gateway /v1/runs -> $REAL_CODE (captures use the demo gateway; recorded for evidence)"

echo "== gateway: starting demo gateway on 127.0.0.1:$PORT and waiting for 200 =="
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true
bun apps/loop-mobile/scripts/demo-gateway.ts "$PORT" &
GW=$!
trap 'kill "$GW" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" || { echo "demo gateway not ready" >&2; exit 1; }
echo "== gateway confirmed running (200 on /v1/runs) =="

launch() {  # launch <KEY=value ...> — extra LOOP_SHOWCASE_* launch env;
  # must go through env(1): appending to `simctl launch` would pass them as
  # app argv, which simctl never forwards as environment variables (v8
  # capture-reliability note).
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

echo "== 1-2/5 attach demo on the live v9 session (draft + 2 thumbnails, then scripted send) =="
launch \
  SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_v9_0008 \
  SIMCTL_CHILD_LOOP_SHOWCASE_COMPOSER_DRAFT="첨부한 화면처럼 리스트 카드 간격이 들쭉날쭉해 — 원인 찾아줘" \
  SIMCTL_CHILD_LOOP_SHOWCASE_ATTACH_ASSETS=att_demo_capture_0001,att_demo_capture_0002 \
  SIMCTL_CHILD_LOOP_SHOWCASE_ATTACH_DELAY_MS=3000 \
  SIMCTL_CHILD_LOOP_SHOWCASE_ATTACH_SEND_DELAY_MS=9000
sleep 7   # attach fired at ~t+3s (session mount + delay): 2 thumbnails + draft, pre-send
xcrun simctl io "$UDID" screenshot "$OUT/01-composer-attach-thumbnails.png" >/dev/null
sleep 8   # send fired at ~t+9s: upload 201 → input 202 → observed user_message (+0.8s) → inline images
xcrun simctl io "$UDID" screenshot "$OUT/02-user-image-inline.png" >/dev/null

echo "== 3/5 syntax-highlighted code block (sess_demo_details_0005, ts fence) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_details_0005
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/03-syntax-highlighted-code.png" >/dev/null

echo "== 4/5 refreshed chats list (beauty-pass tokens) =="
launch
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/04-refreshed-chats.png" >/dev/null

echo "== 5/5 refreshed conversation (two-day history, cards, date header) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_history_0007
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/05-refreshed-conversation.png" >/dev/null

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "== distinctness check (v8 lesson: all captures must differ) =="
md5 "$OUT"/*.png
ls -la "$OUT"
