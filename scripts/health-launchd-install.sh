#!/bin/bash
set -eu

label="kr.ll3.loop.health"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/.loop/health-monitor"
bun_bin="$HOME/.bun/bin/bun"

case "${1:-status}" in
  install)
    test -x "$bun_bin" || { echo "bun is unavailable at $bun_bin" >&2; exit 1; }
    test -x "$repo_root/dist/loop" || { echo "build dist/loop first" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$log_dir"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$bun_bin</string>
    <string>$repo_root/scripts/health-monitor.ts</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string></dict>
  <key>StartInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$log_dir/service.log</string>
  <key>StandardErrorPath</key><string>$log_dir/service.log</string>
</dict></plist>
EOF
    if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then launchctl bootout "gui/$(id -u)/$label"; fi
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "installed: $label (30-second read-only scan)"
    ;;
  status)
    launchctl print "gui/$(id -u)/$label" | grep -E 'state|pid|last exit code' | head -4
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "uninstalled: $label"
    ;;
  *) echo "usage: $0 {install|status|uninstall}" >&2; exit 2 ;;
esac
