#!/usr/bin/env bash
# v11 composer (task showcase-v11): pairs each BEFORE representative cut
# (v8/v9, the pre-redesign app) with the matching AFTER cut captured by
# capture.sh, side by side under labeled bars. Before files are resolved
# by glob so on-disk names are taken verbatim from the filesystem.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"   # invocation-independent repo root
cd "$ROOT"

V=docs/research/simulator-showcase/v11
R=docs/research/simulator-showcase
W=560    # panel width (px)
GUT=24   # gutter between panels
BAR=56   # label bar height
BORDER='rgba(230,237,243,0.12)'   # tokens.hairline

one() {  # one <glob> -> assert exactly one match, print it
  local n
  n=$(ls -1 $1 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -eq 1 ] || { echo "glob '$1' matched $n files (need 1)" >&2; exit 1; }
  printf '%s\n' $1
}

pair() {  # pair <before-glob> <after> <out> <before-label> <after-label>
  local b a out="$V/$3" bl="$4" al="$5"
  b=$(one "$R/$1")
  a=$(one "$V/$2")
  magick "$b" -resize ${W}x /tmp/v11-before.png
  magick "$a" -resize ${W}x /tmp/v11-after.png
  local H TOTW
  H=$(magick identify -format '%h' /tmp/v11-before.png)
    magick /tmp/v11-before.png -resize ${W}x \
    -background '#161C26' -gravity North -splice 0x${BAR} \
    -font /System/Library/Fonts/Helvetica.ttc -pointsize 26 \
    -fill '#8B949E' -annotate +24+14 "$bl" /tmp/v11-before.png
  magick /tmp/v11-after.png -resize ${W}x \
    -background '#161C26' -gravity North -splice 0x${BAR} \
    -font /System/Library/Fonts/Helvetica.ttc -pointsize 26 \
    -fill '#E6EDF3' -annotate +24+14 "$al" /tmp/v11-after.png
  local HB
  HB=$(( H + BAR ))
  magick \
    /tmp/v11-before.png \
    \( -size ${GUT}x${HB} xc:'#0D1117' \) \
    /tmp/v11-after.png \
    -background '#0D1117' -gravity North +append \
    -bordercolor "$BORDER" -border 1 \
    "$out"
  echo "composed $(basename "$out")"
}

pair 'v9/04-*.png'  'after-01-*.png' 01-chats-list.png \
     'BEFORE - v9 (pre-redesign)' 'AFTER - v11 minimal redesign'
pair 'v8/02-*.png'  'after-02-*.png' 02-conversation-tool-card.png \
     'BEFORE - v8 (pre-redesign)' 'AFTER - v11 minimal redesign'
pair 'v8/03-*.png'  'after-03-*.png' 03-conversation-streaming-arrival.png \
     'BEFORE - v8 (pre-redesign)' 'AFTER - v11 streaming arrival (entrance)'
pair 'v9/03-*.png'  'after-04-*.png' 04-conversation-code.png \
     'BEFORE - v9 (pre-redesign)' 'AFTER - v11 minimal redesign'
pair 'v9/01-*.png'  'after-05-*.png' 05-composer-attach.png \
     'BEFORE - v9 (pre-redesign)' 'AFTER - v11 minimal redesign'
pair 'v8/05-*.png'  'after-06-*.png' 06-empty-state.png \
     'BEFORE - v8 (pre-redesign)' 'AFTER - v11 minimal redesign'

rm -f /tmp/v11-before.png /tmp/v11-after.png
echo "done"
