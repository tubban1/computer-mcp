#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TUNNEL_HOME="${COMPUTER_MCP_TUNNEL_HOME:-$HOME/.computer-mcp}"
TUNNEL_ID_FILE="$TUNNEL_HOME/tunnel/tunnel-id"
API_KEY_FILE="${CONTROL_PLANE_API_KEY_FILE:-$TUNNEL_HOME/secrets/openai-api-key}"
RUNTIME_FILE="$TUNNEL_HOME/tunnel/runtime-path"
AGENTOS_HOME="${AGENTOS_HOME:-$HOME/.agentos}"
ENV_FILE="${AGENTOS_RUNTIME_ENV:-$AGENTOS_HOME/runtime.env}"
CURRENT_LINK="$AGENTOS_HOME/current"
RUNTIME_HOST="$HOME/Applications/Computer MCP Runtime.app/Contents/MacOS/ComputerMCPRuntime"
ONBOARD_DIR="$TUNNEL_HOME/onboarding"
ONBOARD_RECORD="$ONBOARD_DIR/chatgpt.json"
OPEN_CHATGPT=true
COPY_TUNNEL=true

for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_CHATGPT=false ;;
    --no-copy) COPY_TUNNEL=false ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

step() {
  printf '\n[%s] %s\n' "$1" "$2"
}

die() {
  printf '\nComputer MCP setup stopped: %s\n' "$*" >&2
  exit 1
}

production_port() {
  /bin/zsh -c '
    set -a
    [[ -f "$1" ]] && source "$1"
    set +a
    print -r -- "${PORT:-8787}"
  ' _ "$ENV_FILE"
}

production_health() {
  local port body
  port="$(production_port)"
  body="$(/usr/bin/curl -fsS --connect-timeout 1 --max-time 3 "http://127.0.0.1:$port/health")" || return 1
  printf '%s' "$body" | node -e '
    let data="";
    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => {
      try {
        const health = JSON.parse(data);
        process.exit(health?.ok === true && health?.runtime?.mode === "production" ? 0 : 2);
      } catch { process.exit(2); }
    });
  '
}

ensure_production() {
  if production_health >/dev/null 2>&1; then
    printf 'Production Runtime is healthy. Existing release will not be changed.\n'
    return 0
  fi

  if [[ -e "$CURRENT_LINK" ]]; then
    die "Production is installed but unhealthy. Run 'npm run status:production'; onboarding will not upgrade or replace it automatically."
  fi

  local install="yes"
  if [[ -t 0 ]]; then
    read -r "answer?Production Runtime is not installed. Install this verified release now? [Y/n] "
    case "${answer:-Y}" in
      n|N|no|NO) install="no" ;;
    esac
  elif [[ "${COMPUTER_MCP_ONBOARD_INSTALL_PRODUCTION:-false}" != "true" ]]; then
    die "Production is not installed. Re-run interactively, or set COMPUTER_MCP_ONBOARD_INSTALL_PRODUCTION=true."
  fi

  [[ "$install" == "yes" ]] || die "Production Runtime is required before connecting ChatGPT."
  (cd "$REPO_ROOT" && npm run install:production)
  production_health >/dev/null 2>&1 || die "Production install finished but /health is not ready."
}

cloud_auth_required() {
  /bin/zsh -c '
    set -a
    [[ -f "$1" ]] && source "$1"
    set +a
    case "${AGENTOS_CLOUD_AUTH_REQUIRED:-false}" in
      1|true|TRUE|yes|YES|on|ON) exit 0 ;;
      *) exit 1 ;;
    esac
  ' _ "$ENV_FILE"
}

run_cloud_command() {
  local command="$1"
  (
    set -a
    [[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
    set +a
    cd "$REPO_ROOT"
    npm run "cloud:$command"
  )
}

ensure_cloud_authorized() {
  if ! cloud_auth_required; then
    printf 'Cloud device authorization is not required by this Production profile.\n'
    return 0
  fi

  if run_cloud_command status >/dev/null 2>&1; then
    printf 'Computer MCP cloud device grant is active.\n'
    return 0
  fi

  printf 'This Production profile requires an OWL cloud account device grant.\n'
  run_cloud_command login
  run_cloud_command status >/dev/null 2>&1 ||
    die "Cloud device authorization did not become active."
}

ensure_tunnel_config() {
  if [[ -s "$TUNNEL_ID_FILE" && -s "$API_KEY_FILE" && -s "$RUNTIME_FILE" ]]; then
    printf 'Tunnel credentials and runtime are already configured.\n'
    return 0
  fi
  (cd "$REPO_ROOT" && npm run tunnel:setup)
}

ensure_tunnel_running() {
  local tunnel_id
  tunnel_id="$(tr -d '\r\n' < "$TUNNEL_ID_FILE")"
  if ps ax -o command= 2>/dev/null | grep '[t]unnel-client-runtime run' | grep -Fq -- "--control-plane.tunnel-id $tunnel_id"; then
    printf 'Configured tunnel client is already running; reusing it without interruption.\n'
    return 0
  fi
  (cd "$REPO_ROOT" && npm run tunnel:service:install)
}

copy_tunnel_id() {
  [[ "$COPY_TUNNEL" == "true" ]] || return 0
  command -v pbcopy >/dev/null 2>&1 || return 0
  tr -d '\r\n' < "$TUNNEL_ID_FILE" | pbcopy
  printf 'Tunnel ID copied to clipboard.\n'
}

write_record() {
  mkdir -p "$ONBOARD_DIR"
  chmod 700 "$ONBOARD_DIR"
  local version timestamp
  version="$(cd "$REPO_ROOT" && node -p "require('./package.json').version")"
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cat > "$ONBOARD_RECORD" <<EOF
{
  "version": 1,
  "computerMcpVersion": "$version",
  "lastPreparedAt": "$timestamp",
  "productionHealthy": true,
  "tunnelConfigured": true,
  "chatgptState": "pending_user_create"
}
EOF
  chmod 600 "$ONBOARD_RECORD"
}

open_chatgpt() {
  [[ "$OPEN_CHATGPT" == "true" ]] || return 0
  if command -v open >/dev/null 2>&1; then
    open "https://chatgpt.com/" >/dev/null 2>&1 || true
  fi
}

cd "$REPO_ROOT"
printf 'Computer MCP → ChatGPT setup\n'
printf 'This flow never upgrades an existing healthy Production Runtime.\n'

step 1 'Checking Computer MCP Production'
ensure_production

step 2 'Checking OWL cloud device authorization'
ensure_cloud_authorized

step 3 'Checking Secure MCP Tunnel configuration'
ensure_tunnel_config

step 4 'Ensuring the tunnel is available'
ensure_tunnel_running

step 5 'Preparing ChatGPT handoff'
copy_tunnel_id
write_record
open_chatgpt

cat <<'EOF'

Local setup is ready.

In ChatGPT web:
  1. Open Plugins and press + to create a developer-mode app.
  2. Enter a name such as "Computer MCP".
  3. Under Connection, choose Tunnel.
  4. Choose the available tunnel, or paste the Tunnel ID already copied to your clipboard.
  5. Create the connection and review the discovered tools.

After that, use Computer MCP directly from ChatGPT. You do not need to keep this terminal open.
EOF
