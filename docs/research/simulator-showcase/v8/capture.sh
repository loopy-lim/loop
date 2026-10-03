#!/usr/bin/env bash
# v8 capture driver (task showcase-v8): scripted-session screenshots that
# evidence the Codex-detail checklist (decision 2026-xx-codex-detail-
# checklist C1/C2, C3/C4, C7, C6/C8, C9, C11) against the demo gateway's
# fake data — no real device, no model calls, nothing paid.
#
# Prereqs (done once):
#   cd apps/loop-mobile && bash scripts/build-ios-simulator.sh   # Release build + install
#
# What this script does:
#   1. starts the fake-data demo gateway on loopback:18488 and WAITS for a
#      200 on GET /v1/runs before any capture (gateway-running check);
#   2. launches the installed app four times with LOOP_SHOWCASE_* launch
#      env (the exact showcase hooks a human tap would drive);
#   3. screenshots each checklist state into this directory.
#
# The gateway is started fresh per run on purpose: the live session's
# scripted "next beat" (busy-row typing indicator) fires once per gateway
# process, so a long-lived gateway would leak the beat into the earlier
# tool-card capture.
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # repo root

PORT=18488
OUT=docs/research/simulator-showcase/v8
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile

echo "== gateway: starting demo gateway on 127.0.0.1:$PORT and waiting for 200 =="
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
  # app argv, which simctl never forwards as environment variables.
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

echo "== 1/4 markdown + code block + copy affordance (sess_demo_details_0005) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_details_0005
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/01-markdown-code-block-copy.png" >/dev/null

echo "== 2/4 live session: expanded tool card, then busy-row typing beat =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_live_0006
sleep 6   # before the gateway's scripted next beat (subscription +8s ≈ t+9)
xcrun simctl io "$UDID" screenshot "$OUT/02-tool-card-expanded-running-chip.png" >/dev/null
sleep 8   # after the beat (t≈14 ≫ t+9): empty assistant message → busy row (C7)
xcrun simctl io "$UDID" screenshot "$OUT/03-typing-indicator-streaming.png" >/dev/null

echo "== 3/4 two-day history: scripted scroll-up → jump pill + date header =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_history_0007 \
       SIMCTL_CHILD_LOOP_SHOWCASE_SCROLL_UP_DELAY_MS=6000
sleep 11
xcrun simctl io "$UDID" screenshot "$OUT/04-jump-pill-date-header-timestamps.png" >/dev/null

echo "== 4/4 empty state (uncorrelated orphan session) =="
launch SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=sess_demo_orphan_0003
sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/05-empty-state.png" >/dev/null

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
ls -la "$OUT"
