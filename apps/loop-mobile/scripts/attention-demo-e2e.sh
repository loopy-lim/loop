#!/usr/bin/env bash
# Attention end-to-end demo on the iOS simulator (task
# `simulator-attention-demo`).
#
# Builds/installs the Release app (build-ios-simulator.sh), starts the fake
# attention gateway (attention-demo-gateway.ts — no paid calls), connects
# the app via its showcase launch hook, walks the REAL UI to the RunScreen's
# attention block, types a response into the resolution input, taps
# "Submit response" with cliclick, and proves the resolve landed in the
# actual run state (attention released) with screenshots + a
# release-confirmation JSON.
#
# Fails with a non-zero exit code when any step cannot be proven. All
# evidence lands in apps/loop-mobile/showcase/attention-demo/.
#
# Env:
#   SKIP_BUILD=1   reuse the installed app (fast reruns)
#   PORT           demo gateway port (default 18600, loopback only)
#
# Tap-target fractions were derived from the migrated layouts; every
# navigation tap is followed by a screen-change proof, so a stale fraction
# fails loudly at that step (with the screenshot pair as evidence) instead
# of clicking blindly through the run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

PORT="${PORT:-18600}"
OUT="apps/loop-mobile/showcase/attention-demo"
BUNDLE="org.reactjs.native.example.LoopMobile"
RUN_ID="run_demo_attention_0010"
RESOLUTION="skip the flaky test and continue with the remaining tasks"
mkdir -p "$OUT"
rm -f "$OUT"/0*.png

UDID=$(xcrun simctl list devices booted | sed -n 's/^[[:space:]]*.* (\([0-9A-F-]\{36\}\)) (Booted)[[:space:]]*$/\1/p' | head -1)
if [ -z "$UDID" ]; then
  echo "e2e: FAIL — no booted simulator (build-ios-simulator.sh boots one)" >&2
  exit 1
fi

step() { echo "e2e: == $1 =="; }
die() { echo "e2e: FAIL — $1" >&2; exit 1; }

command -v cliclick >/dev/null 2>&1 || die "cliclick not installed (brew install cliclick)"

# Pre-flight: a broken bundle crashes the app at launch (ReferenceError in
# module scope) — the exact failure that stalled attempt 1 and produced
# home-screen-only "evidence". Type-check FIRST so a broken tree fails in
# seconds with the fix in hand instead of after a full Release build.
step "pre-flight type-check (broken src cannot launch — fail before building)"
TSC_OUT=$( (cd apps/loop-mobile && bunx tsc --noEmit) 2>&1 ) || die "src does not type-check; the app WILL crash at launch. Fix first, then rerun:
$TSC_OUT"

shot() {  # shot <path>
  xcrun simctl io "$UDID" screenshot "$1" >/dev/null
}

# "did the screen actually change" proof: compare deterministic 32x32
# grayscale downscamples byte-for-byte (identical screens → identical BMP).
screens_differ() {  # screens_differ <a.png> <b.png> -> exit 0 when different
  local a=/tmp/.e2e-a.bmp b=/tmp/.e2e-b.bmp
  sips -s format bmp -s formatOptions grayscale --resampleHeightWidth 32 32 "$1" --out "$a" >/dev/null 2>&1 || return 1
  sips -s format bmp -s formatOptions grayscale --resampleHeightWidth 32 32 "$2" --out "$b" >/dev/null 2>&1 || return 1
  ! cmp -s "$a" "$b"
}

# tap <fx> <fy> — fractions of the DEVICE screen, mapped through the
# Simulator window at a known scale (see geometry step below).
tap() {
  local fx="$1" fy="$2"
  local x y
  x=$(awk -v wx="$WINX" -v ww="$WINW" -v f="$fx" 'BEGIN{printf "%d", wx + ww*f}')
  y=$(awk -v wy="$WINY" -v tb="$TITLEBAR" -v ch="$CONTENT_H" -v f="$fy" 'BEGIN{printf "%d", wy + tb + ch*f}')
  cliclick "c:$x,$y"
}

# tap_and_prove <fx> <fy> <shot-after> <prev-shot> — tap, then prove the
# screen changed; retries once (some transitions animate past the first
# probe) and dies with both screenshots as evidence when it never changes.
tap_and_prove() {
  local fx="$1" fy="$2" after="$3" prev="$4"
  tap "$fx" "$fy"
  sleep 2.5
  shot "$after"
  if screens_differ "$prev" "$after"; then return 0; fi
  tap "$fx" "$fy"
  sleep 3
  shot "$after"
  screens_differ "$prev" "$after" || die "tap ($fx,$fy) did not change the screen — evidence: $prev vs $after"
}

# ── 1. build + install (idempotent; SKIP_BUILD=1 for fast reruns) ────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "building Release app and installing on simulator $UDID"
  bash apps/loop-mobile/scripts/build-ios-simulator.sh >/tmp/attn-e2e-build.log 2>&1 \
    || { tail -20 /tmp/attn-e2e-build.log >&2; die "build failed (log: /tmp/attn-e2e-build.log)"; }
fi

# ── 2. fake attention gateway on loopback ────────────────────────────────
step "starting attention-demo gateway on 127.0.0.1:$PORT"
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true
sleep 1
ATTENTION_DEMO_LOG="$REPO_ROOT/$OUT/release-log.jsonl" \
  bun apps/loop-mobile/scripts/attention-demo-gateway.ts "$PORT" >"$OUT/gateway-stdout.log" 2>&1 &
GW=$!
trap 'kill "$GW" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/v1/runs" && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/v1/demo/attention-state" | grep -q '"open":true' \
  || die "gateway not serving the open attention run"

# ── 3. window geometry → tap mapping ─────────────────────────────────────
# Put the Simulator window at a deterministic scale: Window > Physical Size
# renders the device at exactly 1 device-point = 1 screen-point, so the
# content rect is (device points wide, device points tall) under a measured
# title bar — no per-tap screenshot math that can silently go negative.
osascript -e '
tell application "Simulator" to activate
delay 0.5
tell application "System Events" to tell process "Simulator"
  click menu item "Physical Size" of menu "Window" of menu bar 1
  delay 0.5
end tell' >/dev/null || die "cannot drive the Simulator window menu (accessibility permission?)"

# cliclick types via macOS key events; the simulator must accept its hardware
# keyboard rather than showing only the software keyboard.
KEYBOARD_MARK=$(osascript -e 'tell application "System Events" to tell process "Simulator" to get value of attribute "AXMenuItemMarkChar" of menu item "Connect Hardware Keyboard" of menu 1 of menu item "Keyboard" of menu "I/O" of menu bar 1')
if [ "$KEYBOARD_MARK" = "missing value" ]; then
  osascript -e 'tell application "System Events" to tell process "Simulator" to click menu item "Connect Hardware Keyboard" of menu 1 of menu item "Keyboard" of menu "I/O" of menu bar 1' >/dev/null
fi

read -r WINX WINY WINW WINH < <(osascript -e '
tell application "System Events" to tell process "Simulator"
  set p to position of window 1
  set s to size of window 1
  return ((item 1 of p) as text) & " " & ((item 2 of p) as text) & " " & ((item 1 of s) as text) & " " & ((item 2 of s) as text)
end tell' | tr -d ',') || die "cannot read Simulator window geometry"

# Device points from a probe screenshot (3x device → points = px/3).
shot "$OUT/.probe.png"
read -r PW PH < <(sips -g pixelWidth -g pixelHeight "$OUT/.probe.png" | awk '/pixel/{printf "%s ", $2} END {print ""}')
rm -f "$OUT/.probe.png"
DEV_W=$(awk -v pw="$PW" 'BEGIN{printf "%d", pw/3}')
DEV_H=$(awk -v ph="$PH" 'BEGIN{printf "%d", ph/3}')
# Simulator's accessibility window bounds describe the device viewport on
# this runtime; its aspect can differ slightly from the screenshot (rounded
# display bezel). Map fractions to those bounds, not a guessed title bar.
# The accessibility bounds include Simulator's floating toolbar and bezel.
# The visible display starts ~78pt below the window origin on iPhone 17.
TITLEBAR=78
CONTENT_H=$((WINH - 94))
[ "$WINW" -gt 200 ] && [ "$WINH" -gt 400 ] \
  || die "invalid Simulator window bounds: ${WINW}x${WINH}"
echo "e2e: geometry win=($WINX,$WINY) ${WINW}x${WINH} titlebar=$TITLEBAR content=${DEV_W}x${DEV_H}"

# ── 4. connect + open the attention run's chat ───────────────────────────
step "launching app (auto-connect to 127.0.0.1:$PORT, open $RUN_ID)"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
APP_PID=$(xcrun simctl launch "$UDID" "$BUNDLE" | awk -F: '{print $2}' | tr -d ' ')
[ -n "$APP_PID" ] || die "simctl launch returned no pid"
# Liveness proof: a stale/mismatched bundle dies here (see blocked-report
# in this directory for the 2026-10-05 crash this check now catches).
sleep 8
if ! kill -0 "$APP_PID" 2>/dev/null; then
  CRASH=$(ls -t ~/Library/Logs/DiagnosticReports/"LoopMobile"-*.ips 2>/dev/null | head -1)
  {
    echo "app died within 8s of launch (pid $APP_PID)"
    [ -n "$CRASH" ] && echo "newest crash report: $CRASH"
    echo "recent app JS/native errors:"
    xcrun simctl spawn "$UDID" log show --last 2m --predicate 'process == "LoopMobile"' --style compact 2>/dev/null \
      | grep -E "Exception|error" | tail -6
  } >&2
  die "app process died at launch — see diagnostics above"
fi
shot "$OUT/01-launch-conversation.png"

# Select the attention run to establish the app's active run ID, then
# return to chats before opening Files & reports (RunSplitScreen).
tap_and_prove 0.40 0.47 "$OUT/02-run-conversation.png" "$OUT/01-launch-conversation.png"
tap_and_prove 0.09 0.09 "$OUT/02-chats-attention-row.png" "$OUT/02-run-conversation.png"

# ── 5. FILES & REPORTS → RunScreen shows the open attention ──────────────
tap_and_prove 0.15 0.935 "$OUT/03-attention-open-runs.png" "$OUT/02-chats-attention-row.png"

# ── 6. type the resolution into the attention input, tap Submit ─────────
tap 0.50 0.205   # focus the "Attention response" input
sleep 1
cliclick -e 40 t:"$RESOLUTION"
sleep 1
shot "$OUT/04-resolution-typed.png"
# ── 7. prove the resolve landed in the actual run state ─────────────────
# A Simulator click can be dropped during keyboard focus transitions. Retry
# the UI button only while the gateway still reports open; never synthesize a
# resolve HTTP request from the test (that would bypass the app).
step "verifying attention release in run state"
CONFIRMED=""
for attempt in 1 2 3; do
  tap 0.50 0.30    # tap "Submit response"
  for _ in $(seq 1 10); do
    BODY=$(curl -sf "http://127.0.0.1:$PORT/v1/demo/attention-state" || true)
    if echo "$BODY" | grep -q '"resolved":true'; then CONFIRMED="$BODY"; break; fi
    sleep 0.5
  done
  [ -z "$CONFIRMED" ] || break
  echo "e2e: submit tap $attempt did not reach gateway; retrying UI" >&2
done
shot "$OUT/05-attention-released-runs.png"
[ -n "$CONFIRMED" ] || die "resolve never landed in the run state (evidence: 04/05 screenshots, gateway-stdout.log)"

echo "$CONFIRMED" | bun -e '
  const s = JSON.parse(await Bun.stdin.text());
  const out = {
    demo: "simulator-attention-demo",
    runId: s.runId,
    attentionId: s.attentionId,
    open: s.open,
    resolved: s.resolved,
    resolution: s.resolution,
    resolvedAt: s.resolvedAt,
    runStatusAfter: s.run.status,
    taskCountsAfter: s.run.taskCounts,
    evidence: ["01-launch-conversation.png","02-chats-attention-row.png","03-attention-open-runs.png","04-resolution-typed.png","05-attention-released-runs.png","release-log.jsonl"],
    notes: "Resolution typed and submitted through the app RunScreen UI (cliclick taps on the real buttons); gateway state change proves the resolve hit POST /v1/runs/{id}/attention/resolve.",
  };
  await Bun.write(process.argv[1], JSON.stringify(out, null, 2) + "\n");
' "$REPO_ROOT/$OUT/release-confirmation.json"

# The run projection itself must show the released shape too.
curl -sf "http://127.0.0.1:$PORT/v1/runs/$RUN_ID" | grep -q '"attention":null' \
  || die "run projection still carries an attention"

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

step "DONE — attention released via app-submitted resolution"
ls -la "$OUT"
exit 0
