#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP="$(mktemp -d -t computer-mcp-onboard.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
export COMPUTER_MCP_TUNNEL_HOME="$HOME/.computer-mcp"
export CONTROL_PLANE_TUNNEL_ID="tunnel_test_onboarding_1234567890"
export CONTROL_PLANE_API_KEY="sk-test-onboarding-secret"
export MCP_SERVER_URL="http://127.0.0.1:8787/mcp"
export TUNNEL_CLIENT_RUNTIME_BIN="$TMP/tunnel-client-runtime"
export FAKE_ARGS_FILE="$TMP/runtime-args.txt"
mkdir -p "$HOME"

cat > "$TUNNEL_CLIENT_RUNTIME_BIN" <<'EOF'
#!/bin/zsh
printf '%s\n' "$@" > "$FAKE_ARGS_FILE"
exit 0
EOF
chmod 755 "$TUNNEL_CLIENT_RUNTIME_BIN"

cd "$REPO_ROOT"
bash scripts/tunnel-client.sh setup >/dev/null
COMPUTER_MCP_TUNNEL_NO_LAUNCHD=true zsh scripts/tunnel-service.sh install >/dev/null

PLIST="$HOME/Library/LaunchAgents/fan.fde.computermcp.tunnel.plist"
KEY_FILE="$COMPUTER_MCP_TUNNEL_HOME/secrets/openai-api-key"
TID_FILE="$COMPUTER_MCP_TUNNEL_HOME/tunnel/tunnel-id"

[[ -f "$PLIST" ]] || { echo 'missing tunnel service plist' >&2; exit 1; }
[[ -f "$KEY_FILE" ]] || { echo 'missing API key file' >&2; exit 1; }
[[ -f "$TID_FILE" ]] || { echo 'missing tunnel ID file' >&2; exit 1; }
[[ "$(stat -f '%Lp' "$KEY_FILE")" == "600" ]] || { echo 'API key file mode is not 0600' >&2; exit 1; }
[[ "$(stat -f '%Lp' "$PLIST")" == "600" ]] || { echo 'service plist mode is not 0600' >&2; exit 1; }

if grep -q 'sk-test-onboarding-secret' "$PLIST"; then
  echo 'raw API key leaked into service plist' >&2
  exit 1
fi
grep -q 'file:.*openai-api-key' "$PLIST" || { echo 'service does not use file secret reference' >&2; exit 1; }

STATUS="$(bash scripts/tunnel-client.sh status)"
[[ "$STATUS" != *"sk-test-onboarding-secret"* ]] || { echo 'status leaked API key' >&2; exit 1; }

bash scripts/tunnel-client.sh run --help >/dev/null
[[ -f "$FAKE_ARGS_FILE" ]] || { echo 'fake runtime did not receive arguments' >&2; exit 1; }
if grep -q 'sk-test-onboarding-secret' "$FAKE_ARGS_FILE"; then
  echo 'raw API key leaked into runtime arguments' >&2
  exit 1
fi
grep -q '^file:.*openai-api-key$' "$FAKE_ARGS_FILE" || { echo 'runtime did not receive file secret reference' >&2; exit 1; }

node - <<'NODE'
const p = require('./package.json');
for (const key of ['setup','onboard:chatgpt','tunnel:service:install','tunnel:service:status','verify:onboarding']) {
  if (!p.scripts?.[key]) throw new Error(`missing package script ${key}`);
}
NODE

grep -q 'choose Tunnel' scripts/chatgpt-onboard.sh || { echo 'ChatGPT Tunnel handoff instructions missing' >&2; exit 1; }
grep -q 'pending_user_create' scripts/chatgpt-onboard.sh || { echo 'onboarding handoff receipt missing' >&2; exit 1; }

cat <<'EOF'
{
  "ok": true,
  "chatgptOnboarding": true,
  "backgroundTunnelService": true,
  "secretFileMode": "0600",
  "servicePlistMode": "0600",
  "rawApiKeyInPlist": false,
  "rawApiKeyInRuntimeArgs": false,
  "chatgptHandoff": "Tunnel"
}
EOF
