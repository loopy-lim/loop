#!/bin/bash
set -eu

# Install/manage the Loop gateway LaunchAgent.
#
#   scripts/gateway-launchd-install.sh install     # write plist + bootstrap
#   scripts/gateway-launchd-install.sh uninstall   # bootout + remove plist
#   scripts/gateway-launchd-install.sh restart     # kickstart -k
#   scripts/gateway-launchd-install.sh status      # launchctl print
#
# Label history: dev.loop.gateway (removed) -> kr.ll3.loop.gateway (current).
# The plist contains no secrets; credentials come from ~/.loop/gateway.env
# (0600, user-managed), read by scripts/gateway-serve.sh.

LABEL="kr.ll3.loop.gateway"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
OLD_LABEL="dev.loop.gateway"
OLD_PLIST="$HOME/Library/LaunchAgents/${OLD_LABEL}.plist"
SERVE_SCRIPT="$HOME/dev/ll3/loop/scripts/gateway-serve.sh"
LOG_FILE="$HOME/.loop/gateway/service.log"

write_plist() {
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SERVE_SCRIPT}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${HOME}</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
EOF
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
}

cmd="${1:-status}"
case "$cmd" in
  install)
    # Remove any pre-rename service so both labels never compete for the port.
    if launchctl print "gui/$(id -u)/$OLD_LABEL" >/dev/null 2>&1; then
      launchctl bootout "gui/$(id -u)/$OLD_LABEL"
    fi
    rm -f "$OLD_PLIST"
    write_plist
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: $LABEL"
    ;;
  uninstall)
    uninstall
    echo "uninstalled: $LABEL"
    ;;
  restart)
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "restarted: $LABEL"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|pid" | head -3
    ;;
  *)
    echo "usage: $0 {install|uninstall|restart|status}" >&2
    exit 1
    ;;
esac
