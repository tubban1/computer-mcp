#!/bin/zsh
set -euo pipefail

ROOT="${COMPUTER_MCP_TUNNEL_HOME:-$HOME/.computer-mcp}"
CONFIG_DIR="$ROOT/tunnel"
SECRETS_DIR="$ROOT/secrets"
TUNNEL_ID_FILE="$CONFIG_DIR/tunnel-id"
RUNTIME_FILE="$CONFIG_DIR/runtime-path"
MCP_URL_FILE="$CONFIG_DIR/mcp-server-url"
API_KEY_FILE="${CONTROL_PLANE_API_KEY_FILE:-$SECRETS_DIR/openai-api-key}"
SERVICE_LABEL="${COMPUTER_MCP_TUNNEL_SERVICE_LABEL:-fan.fde.computermcp.tunnel}"
SERVICE_PLIST="${COMPUTER_MCP_TUNNEL_SERVICE_PLIST:-$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist}"
HEALTH_URL_FILE="$CONFIG_DIR/health-url"
PID_FILE="$CONFIG_DIR/tunnel.pid"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/tunnel.log"
STDOUT_LOG="$LOG_DIR/tunnel.stdout.log"
STDERR_LOG="$LOG_DIR/tunnel.stderr.log"

die() {
  printf 'computer-mcp tunnel service: %s\n' "$*" >&2
  exit 1
}

read_value() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  tr -d '\r\n' < "$file"
}

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

service_loaded() {
  launchctl print "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1
}

manual_tunnel_running() {
  local tunnel_id="${TUNNEL_ID:-$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)}"
  [[ -n "$tunnel_id" ]] || return 1
  ps ax -o command= 2>/dev/null | grep '[t]unnel-client-runtime run' | grep -Fq -- "--control-plane.tunnel-id $tunnel_id"
}

stop_matching_manual_tunnels() {
  local tunnel_id="${TUNNEL_ID:-$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)}"
  [[ -n "$tunnel_id" ]] || return 0
  while IFS= read -r line; do
    local pid="${line%% *}"
    local command="${line#* }"
    if [[ "$command" == *"tunnel-client-runtime run"* && "$command" == *"--control-plane.tunnel-id $tunnel_id"* ]]; then
      kill -TERM "$pid" >/dev/null 2>&1 || true
    fi
  done < <(ps ax -o pid=,command= | sed -E 's/^[[:space:]]+//')
}

load_config() {
  TUNNEL_ID="$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)"
  RUNTIME="$(read_value "$RUNTIME_FILE" 2>/dev/null || true)"
  MCP_URL="$(read_value "$MCP_URL_FILE" 2>/dev/null || true)"
  MCP_URL="${MCP_URL:-http://127.0.0.1:8787/mcp}"
  [[ -n "$TUNNEL_ID" ]] || die "Tunnel ID is missing. Run: npm run tunnel:setup"
  [[ -s "$API_KEY_FILE" ]] || die "API key is missing. Run: npm run tunnel:setup"
  [[ -x "$RUNTIME" ]] || die "tunnel-client-runtime is missing. Run: npm run tunnel:setup"
}

write_plist() {
  mkdir -p "$CONFIG_DIR" "$LOG_DIR" "$(dirname "$SERVICE_PLIST")"
  chmod 700 "$CONFIG_DIR" "$LOG_DIR"
  touch "$LOG_FILE" "$STDOUT_LOG" "$STDERR_LOG"
  chmod 600 "$LOG_FILE" "$STDOUT_LOG" "$STDERR_LOG"
  cat > "$SERVICE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$SERVICE_LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$RUNTIME")</string>
    <string>run</string>
    <string>--control-plane.api-key</string>
    <string>file:$(xml_escape "$API_KEY_FILE")</string>
    <string>--control-plane.tunnel-id</string>
    <string>$(xml_escape "$TUNNEL_ID")</string>
    <string>--mcp.server-url</string>
    <string>url=$(xml_escape "$MCP_URL")</string>
    <string>--mcp.startup-wait-timeout</string>
    <string>30s</string>
    <string>--health.listen-addr</string>
    <string>127.0.0.1:0</string>
    <string>--health.url-file</string>
    <string>$(xml_escape "$HEALTH_URL_FILE")</string>
    <string>--pid.file</string>
    <string>$(xml_escape "$PID_FILE")</string>
    <string>--log.file</string>
    <string>$(xml_escape "$LOG_FILE")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$(dirname "$RUNTIME")")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
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
}

install_service() {
  load_config
  write_plist

  if [[ "${COMPUTER_MCP_TUNNEL_NO_LAUNCHD:-false}" == "true" ]]; then
    printf 'Tunnel service configuration prepared; launchd skipped.\n'
    return 0
  fi

  if ! service_loaded && manual_tunnel_running; then
    if [[ "${COMPUTER_MCP_TUNNEL_FORCE_SERVICE:-false}" == "true" ]]; then
      printf 'Existing tunnel-client process detected; handing it over to launchd.\n'
      stop_matching_manual_tunnels
      sleep 0.5
    else
      printf 'Existing tunnel-client process detected; reusing it without interruption.\n'
      printf 'Launchd service definition is ready for the next restart.\n'
      return 0
    fi
  fi

  launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
  local bootstrapped=false
  for _ in {1..5}; do
    if launchctl bootstrap "gui/$UID" "$SERVICE_PLIST" >/dev/null 2>&1; then
      bootstrapped=true
      break
    fi
    sleep 0.5
  done
  [[ "$bootstrapped" == "true" ]] || die "launchd bootstrap failed for $SERVICE_LABEL"
  launchctl kickstart -k "gui/$UID/$SERVICE_LABEL"
  printf 'Tunnel background service installed: %s\n' "$SERVICE_LABEL"
}

status_service() {
  printf 'Computer MCP tunnel service\n'
  if service_loaded; then
    printf '  launchd: loaded\n'
  else
    printf '  launchd: not loaded\n'
  fi
  local health_url=""
  health_url="$(read_value "$HEALTH_URL_FILE" 2>/dev/null || true)"
  if [[ -n "$health_url" ]] && /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 "$health_url/readyz" >/dev/null 2>&1; then
    printf '  readiness: ready\n'
  elif manual_tunnel_running; then
    printf '  readiness: tunnel process detected (not launchd-managed)\n'
  else
    printf '  readiness: not ready\n'
  fi
  printf '  log: %s\n' "$LOG_FILE"
}

stop_service() {
  if service_loaded; then
    launchctl bootout "gui/$UID/$SERVICE_LABEL" >/dev/null 2>&1 || true
    printf 'Tunnel background service stopped.\n'
  else
    printf 'Tunnel background service is not loaded.\n'
  fi
  rm -f "$PID_FILE" "$HEALTH_URL_FILE"
}

restart_service() {
  stop_service
  install_service
}

case "${1:-status}" in
  install) install_service ;;
  status) status_service ;;
  stop) stop_service ;;
  restart) restart_service ;;
  *) die "Usage: $0 {install|status|stop|restart}" ;;
esac
