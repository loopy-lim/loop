#!/usr/bin/env bash
# v11 capture driver (task showcase-v11): the AFTER side of the minimal-
# redesign before/after showcase (decision 2026-xx-minimal-design-spec).
# Same scripted sessions the v8/v9 BEFORE cuts used, re-captured on the
# redesigned app — so each v11 composite pairs the same scene across the
# design change. No real device, no model calls, nothing paid.
#
# Prereqs (done once, after any app change — the bundle must contain the
# token pass, or the AFTER side is silently the old design):
#   cd apps/loop-mobile && bash scripts/build-ios-simulator.sh
#
# What this script does:
#   0. confirms a gateway is reachable BEFORE any capture: the real
#      gateway's /v1/runs is probed and its status recorded (evidence
#      only — captures use the demo gateway), and the fake-data demo
#      gateway is hard-gated on a 200;
#   1. starts the demo gateway on loopback:18589 fresh per run (the live
#      session's scripted beat is once-per-process — v8 lesson);
#   2. launches the installed app five times with LOOP_SHOWCASE_* launch
#      env (the exact showcase hooks a human tap would drive);
#   3. screenshots six AFTER cuts into this directory:
#      01 chats list · 02 running tool card · 03 streaming arrival beat ·
#      04 highlighted code card · 05 composer draft + attach thumbnails ·
#      06 empty state.
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # repo root

PORT=18589
OUT=docs/research/simulator-showcase/v11
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
[ -n "$UDID" ] || { echo "no booted simulator" >&2; exit 1; }
mkdir -p "$OUT"

echo "== preflight: real gateway probe (evidence only) =="
for HOST in 100.80.133.120 loopy-macbookpro.tail42f248.ts.net; do
  REAL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://$HOST:18477/v1/runs" || echo "000")
  echo "real gateway $HOST:18477 /v1/runs -> $REAL_CODE"
done
echo "(captures use the demo gateway below; real-gateway status recorded as evidence)"

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

echo "== 1/6 chats list (sessions inventory, new design) =="
launch
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/after-01-chats.png" >/dev/null

echo "== 2-3/6 live session: running tool card, then the streaming arrival beat =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_live_0006
sleep 6   # before the gateway's scripted beat (subscription +8s ≈ t+9)
xcrun simctl io "$UDID" screenshot "$OUT/after-02-conversation-tool-card.png" >/dev/null
sleep 8   # after the beat (t≈14 ≫ t+9): busy row faded in — entrance motion target state
xcrun simctl io "$UDID" screenshot "$OUT/after-03-conversation-streaming-arrival.png" >/dev/null

echo "== 4/6 highlighted code card (sess_demo_details_0005, ts fence) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_details_0005
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/after-04-conversation-code.png" >/dev/null

echo "== 5/6 composer: draft + 2 attach thumbnails (sess_demo_v9_0008) =="
launch \
  SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_v9_0008 \
  SIMCTL_CHILD_LOOP_SHOWCASE_COMPOSER_DRAFT="첨부한 화면처럼 리스트 카드 간격이 들쭉날쭉해 — 원인 찾아줘" \
  SIMCTL_CHILD_LOOP_SHOWCASE_ATTACH_ASSETS=att_demo_capture_0001,att_demo_capture_0002 \
  SIMCTL_CHILD_LOOP_SHOWCASE_ATTACH_DELAY_MS=3000
sleep 7   # attach fired at ~t+3s: draft + thumbnails, pre-send (v9 01 cut timing)
xcrun simctl io "$UDID" screenshot "$OUT/after-05-composer-attach.png" >/dev/null

echo "== 6/6 empty state (uncorrelated orphan session) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_orphan_0003
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/after-06-empty-state.png" >/dev/null

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "== distinctness check (v8 lesson: all captures must differ) =="
md5 -r "$OUT"/after-*.png
ls -la "$OUT"
