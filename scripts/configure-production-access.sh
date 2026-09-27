#!/bin/zsh
set -euo pipefail

AGENTOS_HOME="${AGENTOS_HOME:-$HOME/.agentos}"
ENV_FILE="${AGENTOS_RUNTIME_ENV:-$AGENTOS_HOME/runtime.env}"
LABEL="com.agentos.runtime"
MODE="${1:-status}"

die() {
  printf 'computer-mcp access: %s\n' "$*" >&2
  exit 1
}

ensure_env() {
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<'EOF'
PORT=8787
AGENTOS_WAKE_NAME=Jarvis
EOF
  fi
  chmod 600 "$ENV_FILE"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp="${ENV_FILE}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    $0 ~ "^" key "=" { print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

helper_status() {
  local helper="$HOME/Applications/Computer MCP Helper.app/Contents/MacOS/ComputerMCPHelper"
  if [[ -x "$helper" ]]; then
    "$helper" --status 2>/dev/null || printf '{"ok":false,"error":"helper status failed"}\n'
  else
    printf '{"ok":false,"installed":false}\n'
  fi
}

print_status() {
  ensure_env
  printf 'Computer MCP production access\n'
  printf '  env: %s\n' "$ENV_FILE"
  local roots
  roots="$(grep '^ALLOWED_DIRECTORIES=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  printf '  filesystem roots: %s\n' "${roots:-not configured}"
  for key in ALLOW_WRITE ALLOW_DELETE ALLOW_SHELL ALLOW_GIT_PUSH ALLOW_ROLLBACK ALLOW_BROWSER ALLOW_GUI MACOS_HELPER_MODE; do
    local value
    value="$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
    printf '  %-18s %s\n' "$key" "${value:-default}"
  done
  printf '  helper: '
  helper_status
}

apply_profile() {
  local profile="$1"
  ensure_env
  local roots=""
  case "$profile" in
    standard)
      roots="$HOME/Desktop,$HOME/Documents,$HOME/Downloads,$HOME/Pictures,$HOME/Movies,$HOME/Music,$HOME/Public"
      ;;
    full-home)
      roots="$HOME"
      ;;
    *)
      die "Unknown profile '$profile'. Use: status | standard | full-home"
      ;;
  esac

  cp "$ENV_FILE" "${ENV_FILE}.backup.$(date '+%Y%m%d-%H%M%S')"
  set_env_value ALLOWED_DIRECTORIES "$roots"
  set_env_value ALLOW_WRITE true
  set_env_value ALLOW_DELETE true
  set_env_value ALLOW_SHELL true
  set_env_value ALLOW_GIT_PUSH true
  set_env_value ALLOW_ROLLBACK true
  set_env_value ALLOW_BROWSER true
  set_env_value ALLOW_GUI true
  set_env_value MACOS_HELPER_MODE required
  chmod 600 "$ENV_FILE"

  printf 'Applied Computer MCP access profile: %s\n' "$profile"
  printf '  filesystem roots: %s\n' "$roots"
  printf '  runtime env backup created beside %s\n' "$ENV_FILE"

  if [[ "${COMPUTER_MCP_ACCESS_NO_RESTART:-false}" == "true" ]]; then
    printf '  Runtime restart skipped by COMPUTER_MCP_ACCESS_NO_RESTART.\n'
  elif launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$UID/$LABEL"
    printf '  Production Runtime restarted to apply the profile.\n'
  else
    printf '  Production Runtime is not loaded; profile will apply on next start.\n'
  fi
}

case "$MODE" in
  status) print_status ;;
  standard|full-home) apply_profile "$MODE" ;;
  *) die "Usage: $0 {status|standard|full-home}" ;;
esac
