#!/bin/zsh
set -euo pipefail

ACTION="${1:-status}"
HELPER_APP="${COMPUTER_MCP_HELPER_APP:-$HOME/Applications/Computer MCP Helper.app}"
HELPER_BIN="$HELPER_APP/Contents/MacOS/ComputerMCPHelper"
SOCKET="${COMPUTER_MCP_HELPER_SOCKET:-$HOME/.computer-mcp/helper.sock}"
SERVICE_LABEL="${COMPUTER_MCP_HELPER_SERVICE_LABEL:-fan.fde.computermcp.helper.service}"
SERVICE_PLIST="${COMPUTER_MCP_HELPER_SERVICE_PLIST:-$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist}"
LOG_DIR="${COMPUTER_MCP_HOME:-$HOME/.computer-mcp}/logs"
STDOUT_LOG="$LOG_DIR/helper.stdout.log"
STDERR_LOG="$LOG_DIR/helper.stderr.log"

die() {
  print -u2 -- "computer-mcp helper service: $*"
  exit 1
}

xml_escape() {
  print -n -- "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

service_loaded() {
  launchctl print "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1
}

write_plist() {
  [[ -x "$HELPER_BIN" ]] || die "Helper executable is missing: $HELPER_BIN"
  mkdir -p "$LOG_DIR" "$(dirname "$SERVICE_PLIST")" "$(dirname "$SOCKET")"
  chmod 700 "$(dirname "$SOCKET")" "$LOG_DIR"
  touch "$STDOUT_LOG" "$STDERR_LOG"
  chmod 600 "$STDOUT_LOG" "$STDERR_LOG"

  cat > "$SERVICE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$SERVICE_LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$HELPER_BIN")</string>
    <string>--serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$STDOUT_LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$STDERR_LOG")</string>
</dict>
</plist>
EOF
  chmod 600 "$SERVICE_PLIST"
  plutil -lint "$SERVICE_PLIST" >/dev/null
}

install_service() {
  write_plist
  if [[ "${COMPUTER_MCP_HELPER_NO_LAUNCHD:-false}" == "true" ]]; then
    print -- "Helper service configuration prepared; launchd skipped."
    return 0
  fi
  launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
  while IFS= read -r line; do
    pid="${line%% *}"
    command="${line#* }"
    if [[ "$command" == "$HELPER_BIN"* ]]; then
      kill -TERM "$pid" >/dev/null 2>&1 || true
    fi
  done < <(ps ax -o pid=,command= | sed -E 's/^[[:space:]]+//')
  sleep 0.2
  rm -f "$SOCKET"
  launchctl bootstrap "gui/$UID" "$SERVICE_PLIST"
  launchctl kickstart -k "gui/$UID/$SERVICE_LABEL"

  for _ in {1..50}; do
    [[ -S "$SOCKET" ]] && {
      print -- "Computer MCP Helper background service is ready."
      return 0
    }
    sleep 0.1
  done
  die "Helper service loaded but socket did not become ready: $SOCKET"
}

stop_service() {
  launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
  rm -f "$SOCKET"
  print -- "Computer MCP Helper background service stopped."
}

status_service() {
  print -- "Computer MCP Helper service"
  if service_loaded; then
    print -- "  launchd: loaded"
  else
    print -- "  launchd: not loaded"
  fi
  if [[ -S "$SOCKET" ]]; then
    print -- "  socket: ready"
  else
    print -- "  socket: not ready"
  fi
  print -- "  app: $HELPER_APP"
}

case "$ACTION" in
  install|restart)
    [[ "$ACTION" == "restart" ]] && stop_service >/dev/null 2>&1 || true
    install_service
    ;;
  stop) stop_service ;;
  status) status_service ;;
  *) die "Usage: $0 {install|restart|stop|status}" ;;
esac
