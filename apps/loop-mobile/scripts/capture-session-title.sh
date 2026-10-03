#!/usr/bin/env bash
# Session-title capture driver (task session-title-implementation): scripted
# screenshots proving the operator-approved session naming rule on the
# simulator — first-utterance titles, the `새 세션` + start time fallback,
# the Korean relative-time + source-badge subtitle, and the chats list
# re-reading observed evidence after the scripted Back. Runs against the
# demo gateway's fake data. No real device, no model calls, nothing paid.
#
# Prereq (after any app change):
#   cd apps/loop-mobile && bash scripts/build-ios-simulator.sh   # Release build + install
#
# Outputs into apps/loop-mobile/showcase-captures/session-title/.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

PORT=18588
OUT=apps/loop-mobile/showcase-captures/session-title
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
mkdir -p "$OUT"

echo "== gateway: starting demo gateway on 127.0.0.1:$PORT and waiting for 200 =="
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true
# --max-runs=2 keeps the CHATS section short so the SESSIONS section (the
# naming rule's target) fits the first screenful of the list captures.
bun apps/loop-mobile/scripts/demo-gateway.ts "$PORT" --max-runs=2 &
GW=$!
trap 'kill "$GW" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" || { echo "demo gateway not ready" >&2; exit 1; }
echo "== gateway confirmed running (200 on /v1/runs) =="

launch() {  # launch <KEY=value ...> — extra LOOP_SHOWCASE_* launch env via
  # env(1) (simctl never forwards appended args as environment variables).
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

echo "== 1/4 chats list, fresh launch (no evidence yet: honest fallbacks) =="
launch
sleep 8
xcrun simctl io "$UDID" screenshot "$OUT/01-chats-fresh-fallback.png" >/dev/null

echo "== 2/4 conversation header, first-utterance title ≠ adapter label (details session) =="
# Adapter title "Showcase v8: markdown + code budget"; first utterance is
# 58 chars — the header must show the CLAMPED UTTERANCE, not the label.
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_details_0005
sleep 7
xcrun simctl io "$UDID" screenshot "$OUT/02-header-first-utterance.png" >/dev/null

echo "== 3/4 conversation header, 새 세션 + start time (empty session) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_empty_0009
sleep 7
xcrun simctl io "$UDID" screenshot "$OUT/03-header-new-session-stamp.png" >/dev/null

echo "== 4/4 chats list AFTER observing (scripted Back; rule title + subtitle) =="
# Open the empty session, let the stream observe its lifecycle frame (start
# time evidence), then the scripted Back fires the real back handler — the
# list remounts and the SESSIONS row now names by the rule.
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_empty_0009 \
  SIMCTL_CHILD_LOOP_SHOWCASE_BACK_DELAY_MS=9000
sleep 13
xcrun simctl io "$UDID" screenshot "$OUT/04-chats-after-observe.png" >/dev/null

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "== distinctness check (v8 lesson: all captures must differ) =="
md5 "$OUT"/*.png
ls -la "$OUT"
