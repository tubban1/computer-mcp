#!/usr/bin/env bash
set -euo pipefail

ROOT="${COMPUTER_MCP_TUNNEL_HOME:-$HOME/.computer-mcp}"
CONFIG_DIR="$ROOT/tunnel"
SECRETS_DIR="$ROOT/secrets"
TUNNEL_ID_FILE="$CONFIG_DIR/tunnel-id"
RUNTIME_FILE="$CONFIG_DIR/runtime-path"
MCP_URL_FILE="$CONFIG_DIR/mcp-server-url"
API_KEY_FILE="${CONTROL_PLANE_API_KEY_FILE:-$SECRETS_DIR/openai-api-key}"
DEFAULT_MCP_URL="http://127.0.0.1:8787/mcp"

die() {
  printf 'computer-mcp tunnel: %s\n' "$*" >&2
  exit 1
}

read_value() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  tr -d '\r\n' < "$file"
}

write_private_value() {
  local file="$1"
  local value="$2"
  local tmp="${file}.tmp.$$"
  umask 077
  printf '%s\n' "$value" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

ensure_dirs() {
  mkdir -p "$CONFIG_DIR" "$SECRETS_DIR"
  chmod 700 "$CONFIG_DIR" "$SECRETS_DIR"
}

detect_runtime() {
  local saved=""
  local candidate=""

  if [[ -n "${TUNNEL_CLIENT_RUNTIME_BIN:-}" && -x "${TUNNEL_CLIENT_RUNTIME_BIN}" ]]; then
    printf '%s\n' "$TUNNEL_CLIENT_RUNTIME_BIN"
    return 0
  fi

  saved="$(read_value "$RUNTIME_FILE" 2>/dev/null || true)"
  if [[ -n "$saved" && -x "$saved" ]]; then
    printf '%s\n' "$saved"
    return 0
  fi

  candidate="$(command -v tunnel-client-runtime 2>/dev/null || true)"
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  for candidate in "$HOME"/tunnel-client-runtime-v*-darwin-*/tunnel-client-runtime; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

legacy_tunnel_id() {
  local script=""
  local value=""
  for script in "$HOME"/tunnel-client-runtime-v*-darwin-*/start-tunnel.sh; do
    [[ -f "$script" ]] || continue
    value="$(
      sed -nE 's/.*--control-plane\.tunnel-id[[:space:]]+"?([^"[:space:]\\]+)"?.*/\1/p' "$script" |
        head -n 1
    )"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}

masked_tunnel_id() {
  local value="$1"
  local len="${#value}"
  if (( len <= 12 )); then
    printf '%s\n' "$value"
  else
    printf '%s...%s\n' "${value:0:8}" "${value: -4}"
  fi
}

setup_tunnel() {
  ensure_dirs

  local runtime=""
  local tunnel_id="${CONTROL_PLANE_TUNNEL_ID:-}"
  local current_tunnel_id=""
  local api_key="${CONTROL_PLANE_API_KEY:-}"
  local mcp_url="${MCP_SERVER_URL:-}"
  local answer=""

  runtime="$(detect_runtime 2>/dev/null || true)"
  current_tunnel_id="$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)"
  if [[ -z "$current_tunnel_id" ]]; then
    current_tunnel_id="$(legacy_tunnel_id 2>/dev/null || true)"
  fi

  if [[ -z "$tunnel_id" ]]; then
    if [[ -n "$current_tunnel_id" ]]; then
      read -r -p "Tunnel ID [$current_tunnel_id]: " tunnel_id
      tunnel_id="${tunnel_id:-$current_tunnel_id}"
    else
      read -r -p "Tunnel ID: " tunnel_id
    fi
  fi
  [[ -n "$tunnel_id" ]] || die "Tunnel ID is required."

  if [[ -z "$api_key" ]]; then
    if [[ -s "$API_KEY_FILE" ]]; then
      read -r -p "API key is already saved. Press Enter to keep it, or type replace: " answer
      case "$answer" in
        r|R|replace|Replace|REPLACE)
          read -r -s -p "New API key (input hidden): " api_key
          printf '\n'
          ;;
      esac
    else
      read -r -s -p "API key (input hidden): " api_key
      printf '\n'
    fi
  fi

  if [[ -n "$api_key" ]]; then
    write_private_value "$API_KEY_FILE" "$api_key"
  fi
  [[ -s "$API_KEY_FILE" ]] || die "API key was not saved."

  if [[ -z "$runtime" ]]; then
    read -r -p "Path to tunnel-client-runtime: " runtime
  fi
  [[ -x "$runtime" ]] || die "tunnel-client-runtime is not executable: $runtime"

  if [[ -z "$mcp_url" ]]; then
    mcp_url="$(read_value "$MCP_URL_FILE" 2>/dev/null || true)"
  fi
  mcp_url="${mcp_url:-$DEFAULT_MCP_URL}"

  write_private_value "$TUNNEL_ID_FILE" "$tunnel_id"
  write_private_value "$RUNTIME_FILE" "$runtime"
  write_private_value "$MCP_URL_FILE" "$mcp_url"

  printf '\nTunnel configured.\n'
  printf '  Tunnel ID: %s\n' "$(masked_tunnel_id "$tunnel_id")"
  printf '  API key: saved securely at %s\n' "$API_KEY_FILE"
  printf '  Runtime: %s\n' "$runtime"
  printf '  MCP target: %s\n' "$mcp_url"
  printf '\nNext time: npm run tunnel:run\n'
}

status_tunnel() {
  local tunnel_id=""
  local runtime=""
  local mcp_url=""

  tunnel_id="$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)"
  if [[ -z "$tunnel_id" ]]; then
    tunnel_id="$(legacy_tunnel_id 2>/dev/null || true)"
  fi
  runtime="$(detect_runtime 2>/dev/null || true)"
  mcp_url="$(read_value "$MCP_URL_FILE" 2>/dev/null || true)"

  printf 'Computer MCP tunnel configuration\n'
  if [[ -n "$tunnel_id" ]]; then
    printf '  Tunnel ID: configured (%s)\n' "$(masked_tunnel_id "$tunnel_id")"
  else
    printf '  Tunnel ID: missing\n'
  fi
  if [[ -s "$API_KEY_FILE" ]]; then
    printf '  API key: configured (secret hidden)\n'
  else
    printf '  API key: missing\n'
  fi
  if [[ -n "$runtime" ]]; then
    printf '  Runtime: %s\n' "$runtime"
  else
    printf '  Runtime: missing\n'
  fi
  printf '  MCP target: %s\n' "${mcp_url:-$DEFAULT_MCP_URL}"
}

run_tunnel() {
  local tunnel_id=""
  local runtime=""
  local mcp_url=""

  tunnel_id="${CONTROL_PLANE_TUNNEL_ID:-$(read_value "$TUNNEL_ID_FILE" 2>/dev/null || true)}"
  if [[ -z "$tunnel_id" ]]; then
    tunnel_id="$(legacy_tunnel_id 2>/dev/null || true)"
  fi
  runtime="$(detect_runtime 2>/dev/null || true)"
  mcp_url="${MCP_SERVER_URL:-$(read_value "$MCP_URL_FILE" 2>/dev/null || true)}"
  mcp_url="${mcp_url:-$DEFAULT_MCP_URL}"

  [[ -n "$tunnel_id" ]] || die "Tunnel ID is missing. Run: npm run tunnel:setup"
  [[ -s "$API_KEY_FILE" ]] || die "API key is missing. Run: npm run tunnel:setup"
  [[ -x "$runtime" ]] || die "tunnel-client-runtime was not found. Run: npm run tunnel:setup"

  exec "$runtime" run \
    --control-plane.api-key "file:$API_KEY_FILE" \
    --control-plane.tunnel-id "$tunnel_id" \
    --mcp.server-url "url=$mcp_url" \
    "$@"
}

case "${1:-status}" in
  setup)
    setup_tunnel
    ;;
  status)
    status_tunnel
    ;;
  run)
    shift
    run_tunnel "$@"
    ;;
  *)
    die "Usage: $0 {setup|status|run [tunnel-client args...]}"
    ;;
esac
