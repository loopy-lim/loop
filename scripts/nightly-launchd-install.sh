#!/usr/bin/env bash
set -euo pipefail

# Usage: nightly-launchd-install.sh preview|install [HH:MM]
#        nightly-launchd-install.sh status|uninstall
# StartCalendarInterval follows this Mac's local timezone. The job runs one
# pass at the chosen time and does not start immediately on installation.
label="kr.ll3.loop.nightly"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner="$repo_root/scripts/nightly-run.sh"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_file="$HOME/.loop/nightly/nightly.log"
command="${1:-status}"
schedule="${2:-02:00}"

validate_schedule() {
  if [[ ! "$schedule" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    echo "nightly schedule must be HH:MM (00:00 to 23:59)" >&2
    exit 2
  fi
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

render_plist() {
  validate_schedule
  local hour="${schedule%%:*}" minute="${schedule##*:}"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$runner")</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$(xml_escape "$HOME")</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>$((10#$hour))</integer>
    <key>Minute</key><integer>$((10#$minute))</integer>
  </dict>
  <key>StandardOutPath</key><string>$(xml_escape "$log_file")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$log_file")</string>
</dict>
</plist>
EOF
}

case "$command" in
  preview) render_plist ;;
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.loop/nightly"
    temporary="$plist.tmp.$$"
    trap 'rm -f "$temporary"' EXIT
    render_plist > "$temporary"
    plutil -lint "$temporary" >/dev/null
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    mv "$temporary" "$plist"
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "installed: $label at $schedule local time"
    ;;
  status) launchctl print "gui/$(id -u)/$label" ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "uninstalled: $label"
    ;;
  *) echo "usage: $0 {preview|install [HH:MM]|status|uninstall}" >&2; exit 2 ;;
esac
