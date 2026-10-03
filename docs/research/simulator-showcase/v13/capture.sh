#!/bin/bash
# capture.sh — v13 rerun: simulator "New TUI session" tap -> host tmux pi -> live mirror.
#
# Pipeline: app tap (idb HID) ──POST /v1/sessions/spawn──▶ gateway spawn.ts
#           ──tmux new-window──▶ pi TUI (session `loop`) ──session-tap.ts──▶
#           gateway collector ──▶ /v1/sessions + SSE ──▶ app auto-opens + mirrors.
#
# Paid-call policy (operator-approved, disclosed in evidence.md §유료 호출 공개):
#   the script drives EVERYTHING up to the first prompt, then STOPS. The 1–2 tiny
#   paid prompts are sent by the operator with `tmux send-keys` exactly as below.
#
# Prereqs (see evidence.md §환경·한계):
#   - launchd gateway kr.ll3.loop.gateway running, with PATH containing tmux
#     (/opt/homebrew/bin) and the fnm node bin (pi needs `env node`) — otherwise
#     the endpoint answers spawn_tmux_unavailable (deterministic, by design).
#   - fb-idb client for touch injection: python3 -m venv /tmp/idb-venv &&
#     /tmp/idb-venv/bin/pip install fb-idb   (cliclick/System-Events clicks do
#     not reach RN touches in this environment; idb HID taps do)
#   - tap extension registered in ~/.pi/agent/settings.json (step 1 is idempotent)
set -euo pipefail
cd "$(dirname "$0")/../../../.."   # repo root

GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=18477
UDID=${UDID:-99B087B5-DEF6-4CF1-9177-81A5DE564CFC}
BUNDLE=org.reactjs.native.example.LoopMobile
OUT=docs/research/simulator-showcase/v13
TAP="$(git rev-parse --show-toplevel)/pi-extensions/session-tap.ts"
SETTINGS="$HOME/.pi/agent/settings.json"
IDB=/tmp/idb-venv/bin/idb
mkdir -p "$OUT"

echo "[0] preflight — gateway + spawn gate probe (deterministic 404, NO spawn)"
curl -sf -m 5 "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions" >/dev/null
CODE=$(curl -s -m 5 -o /tmp/v13-probe.json -w '%{http_code}' -X POST \
  "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions/spawn" \
  -H 'content-type: application/json' -d '{"cwd":"/definitely/missing"}')
grep -q spawn_cwd_missing /tmp/v13-probe.json || { echo "unexpected probe: $(cat /tmp/v13-probe.json)"; exit 1; }
echo "    spawn probe: $CODE spawn_cwd_missing ✓ (deterministic problem, no side effects)"

echo "[1] register tap in $SETTINGS (idempotent)"
python3 - "$TAP" "$SETTINGS" <<'EOF'
import json, sys
tap, path = sys.argv[1], sys.argv[2]
with open(path) as f: s = json.load(f)
if tap not in s.setdefault("extensions", []):
    s["extensions"].append(tap)
    with open(path, "w") as f: json.dump(s, f, indent=2); f.write("\n")
print("tap registered")
EOF

echo "[2] clean slate — kill stale loop session, relaunch app on chats home"
tmux kill-session -t loop 2>/dev/null || true
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=$GATEWAY_HOST SIMCTL_CHILD_LOOP_SHOWCASE_PORT=$GATEWAY_PORT \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 xcrun simctl launch "$UDID" "$BUNDLE"; sleep 9
xcrun simctl io "$UDID" screenshot "$OUT/01-chats-before-spawn.png" >/dev/null

echo "[3] tap 'New TUI session' (idb HID @ 201,256 pt — button AX frame 0,234 402x44)"
"$IDB" ui tap 201 256 --udid "$UDID"
sleep 1.5
xcrun simctl io "$UDID" screenshot "$OUT/02-app-auto-opened-after-tap.png" >/dev/null
for i in $(seq 1 30); do tmux ls 2>/dev/null | grep -q loop && break; sleep 1; done
tmux list-windows -t loop
NEWID=$(curl -s -m 5 "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions" \
  | python3 -c 'import json,sys; ss=json.load(sys.stdin)["sessions"]; live=[s["sessionId"] for s in ss if s["state"]=="live" and s["lane"]=="pi"]; print(live[-1])')
echo "    spawned+registered: $NEWID  (app auto-opened it: $OUT/02-*)"

echo "[4] host side — attach the loop session in a visible terminal window, then"
echo "    capture it with a WINDOW capture (screencapture -l; -R regions go stale"
echo "    for occluded windows). Get the window id from AppleScript, e.g.:"
echo "      osascript -e 'tell application \"Terminal\" to id of window 1'"
echo "      screencapture -x -o -l<id> $OUT/03-host-tmux-window-pi.png"

cat <<'EOF'

[5] PAID CALLS (operator-approved, max 2 tiny prompts, disclosed):
      tmux send-keys -t loop:2 -l '1+1은? 정확히 한 단어로만 답해.'; tmux send-keys -t loop:2 Enter
      +3s: xcrun simctl io $UDID screenshot 04-app-turn1-inflight.png   (bubble, in flight)
      +13s: capture terminal window (-l<id>) and app → 05-app-two-turns-final.png
      optional 2nd approved prompt → recapture 03/05
      then: compose side-by-side with magick (see v12/compose.sh pattern)

[6] cleanup — honest lifecycle:
      tmux send-keys -t loop:2 -l '/exit'; tmux send-keys -t loop:2 Enter
      sleep 3; curl -s http://127.0.0.1:18477/v1/sessions   # state:"ended"
      tmux kill-session -t loop
EOF
