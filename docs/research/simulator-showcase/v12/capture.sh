#!/bin/bash
# capture.sh — v12 rerun: real pi TUI session mirrored live into the simulator app.
#
# Pipeline: pi (tmux) ──tap(pi-extensions/session-tap.ts)──▶ gateway session-collector
#           (launchd kr.ll3.loop.gateway) ──▶ GET /v1/sessions + SSE ──▶ LoopMobile app.
#
# Paid-call policy (operator-approved, disclosed in evidence.md §유료 호출 공개):
#   the script drives EVERYTHING up to the first prompt, then STOPS. The 1–2 tiny
#   paid prompts are sent by the operator with `tmux send-keys` exactly as below.
#   Model: whatever pi's default routes to (this capture: gpt-5.5 via openai-codex
#   subscription — $0.049 equivalent total for 2 turns).
#
# Manual procedure this script encodes:
#   0. preflight — gateway 200 + collector socket present
#   1. provisioning — register the tap in ~/.pi/agent/settings.json (idempotent)
#   2. tmux new-session v12demo running `pi`; read the registered sessionId
#   3. app launch #1 (autoConnect) → swipe to SESSIONS section → capture 01
#   4. app launch #2 (autoOpenSessionId) → capture raw-02 (empty conversation)
#   5. OPERATOR (paid): tmux send-keys -t v12demo -l '<tiny prompt>'; Enter
#      → +2.5s capture raw-03 pair (streaming beat), +12s raw-04 pair (completed)
#      → optional second approved prompt → raw-05/06 pair
#   6. bash compose.sh ; /exit in pi ; tmux kill-session
set -euo pipefail
cd "$(dirname "$0")"          # docs/research/simulator-showcase/v12
REPO=$(git rev-parse --show-toplevel)
GATEWAY_HOST=127.0.0.1        # loopback binding of the SAME launchd gateway
GATEWAY_PORT=18477
UDID=${UDID:-99B087B5-DEF6-4CF1-9177-81A5DE564CFC}
BUNDLE=org.reactjs.native.example.LoopMobile
TAP="$REPO/pi-extensions/session-tap.ts"
SETTINGS="$HOME/.pi/agent/settings.json"

echo "[0] preflight"
curl -sf -m 5 "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions" >/dev/null || {
  echo "gateway not reachable on $GATEWAY_HOST:$GATEWAY_PORT — start kr.ll3.loop.gateway first"; exit 1; }
SOCKET_DIR=$(curl -s "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions" >/dev/null; echo "${TMPDIR:-/tmp}")
[ -S "$SOCKET_DIR/loop-session-collector.sock" ] || { echo "collector socket missing"; exit 1; }

echo "[1] register tap in $SETTINGS (idempotent)"
python3 - "$TAP" "$SETTINGS" <<'EOF'
import json, os, sys
tap, path = sys.argv[1], sys.argv[2]
with open(path) as f: s = json.load(f)
if tap not in s.setdefault("extensions", []):
    s["extensions"].append(tap)
    with open(path, "w") as f: json.dump(s, f, indent=2); f.write("\n")
print("tap registered")
EOF

echo "[2] start pi in tmux"
tmux kill-session -t v12demo 2>/dev/null || true
tmux new-session -d -s v12demo -c "$REPO" -x 110 -y 34 'pi'
sleep 7
SID=$(curl -s -m 5 "http://$GATEWAY_HOST:$GATEWAY_PORT/v1/sessions" \
  | python3 -c 'import json,sys; ss=json.load(sys.stdin)["sessions"]; print(next(s["sessionId"] for s in ss if s["state"]=="live" and s["lane"]=="pi"))')
echo "    live session: $SID"

echo "[3] app launch #1 — chats list with SESSIONS section"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=$GATEWAY_HOST SIMCTL_CHILD_LOOP_SHOWCASE_PORT=$GATEWAY_PORT \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 xcrun simctl launch "$UDID" "$BUNDLE"; sleep 10
# swipe up inside the simulator window to the bottom SESSIONS section, then:
echo "    (swipe the simulator list to the bottom, then) xcrun simctl io $UDID screenshot 01-chats-live-sessions.png"

echo "[4] app launch #2 — conversation screen"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=$GATEWAY_HOST SIMCTL_CHILD_LOOP_SHOWCASE_PORT=$GATEWAY_PORT \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_SESSION=$SID \
  xcrun simctl launch "$UDID" "$BUNDLE"; sleep 10
echo "    xcrun simctl io $UDID screenshot raw-02-conversation-open.png"

cat <<'EOF'

[5] PAID CALLS (operator-approved, max 2 tiny prompts, disclosed):
      tmux send-keys -t v12demo -l '1+1은? 정확히 한 단어로만 답해.'; tmux send-keys -t v12demo Enter
      sleep 2.5  # screencapture -x -o -l<ghosttyWindowID> raw-03-terminal-streaming.png
                 # xcrun simctl io $UDID screenshot raw-03-app-streaming.png
      sleep 10   # same pair as raw-04-*-completed.png
      (optional 2nd approved prompt → raw-05/06 pair)

[6] bash compose.sh ; tmux send-keys -t v12demo '/exit' Enter; sleep 2; tmux kill-session -t v12demo
EOF
