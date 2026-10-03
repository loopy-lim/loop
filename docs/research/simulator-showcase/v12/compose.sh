#!/bin/bash
# compose.sh — build the v12 side-by-side evidence cuts (terminal | app).
# Inputs: the raw-* captures in this directory. Outputs: 02/03/04 side-by-side PNGs.
# Requires: magick (ImageMagick). No model calls, no gateway interaction.
set -euo pipefail
cd "$(dirname "$0")"
H=1500
GAP=40
BG="#101216"
pair() { # pair <out> <terminal.png> <app.png>
  local out=$1 term=$2 app=$3
  magick "$term" -resize x$H /tmp/v12-t.png
  magick "$app" -resize x$H /tmp/v12-a.png
  local tw aw
  tw=$(magick identify -format '%w' /tmp/v12-t.png)
  aw=$(magick identify -format '%w' /tmp/v12-a.png)
  local W=$((tw + GAP + aw))
  magick -size ${W}x$H xc:"$BG" \
    /tmp/v12-t.png -geometry +0+0 -composite \
    /tmp/v12-a.png -geometry +$((tw + GAP))+0 -composite \
    -quality 92 "$out"
  echo "wrote $out (${W}x${H})"
}
pair 02-live-streaming-turn1.png  raw-03-terminal-streaming.png  raw-03-app-streaming.png
pair 03-live-completed-turn1.png  raw-04-terminal-completed.png  raw-04-app-completed.png
pair 04-live-two-turns-final.png  raw-06-terminal-completed.png  raw-06-app-completed.png
rm -f /tmp/v12-t.png /tmp/v12-a.png
