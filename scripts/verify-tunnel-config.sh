#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$ROOT/.tmp-verify-tunnel-config"
HOME_DIR="$SCRATCH/home"
FAKE_RUNTIME="$SCRATCH/tunnel-client-runtime"
FAKE_LOG="$SCRATCH/runtime-args.log"

cleanup() {
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

rm -rf "$SCRATCH"
mkdir -p "$HOME_DIR" "$SCRATCH"

cat > "$FAKE_RUNTIME" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${FAKE_LOG:?FAKE_LOG is required}"
SH
chmod +x "$FAKE_RUNTIME"

HOME="$HOME_DIR" \
CONTROL_PLANE_TUNNEL_ID="tunnel_verify_123456" \
CONTROL_PLANE_API_KEY="sk-verifier-not-real" \
TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
MCP_SERVER_URL="http://127.0.0.1:8787/mcp" \
  bash "$ROOT/scripts/tunnel-client.sh" setup >/dev/null

KEY_FILE="$HOME_DIR/.computer-mcp/secrets/openai-api-key"
TUNNEL_FILE="$HOME_DIR/.computer-mcp/tunnel/tunnel-id"
RUNTIME_FILE="$HOME_DIR/.computer-mcp/tunnel/runtime-path"

[[ "$(cat "$TUNNEL_FILE")" == "tunnel_verify_123456" ]]
[[ "$(cat "$RUNTIME_FILE")" == "$FAKE_RUNTIME" ]]
[[ "$(cat "$KEY_FILE")" == "sk-verifier-not-real" ]]

PERM="$(stat -f '%Lp' "$KEY_FILE" 2>/dev/null || stat -c '%a' "$KEY_FILE")"
[[ "$PERM" == "600" ]]

STATUS="$(
  HOME="$HOME_DIR" \
  TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
    bash "$ROOT/scripts/tunnel-client.sh" status
)"
[[ "$STATUS" == *"API key: configured (secret hidden)"* ]]
[[ "$STATUS" != *"sk-verifier-not-real"* ]]

HOME="$HOME_DIR" \
TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
FAKE_LOG="$FAKE_LOG" \
  bash "$ROOT/scripts/tunnel-client.sh" run --log.level warn

grep -Fx -- "run" "$FAKE_LOG" >/dev/null
grep -Fx -- "--control-plane.api-key" "$FAKE_LOG" >/dev/null
grep -Fx -- "file:$KEY_FILE" "$FAKE_LOG" >/dev/null
grep -Fx -- "--control-plane.tunnel-id" "$FAKE_LOG" >/dev/null
grep -Fx -- "tunnel_verify_123456" "$FAKE_LOG" >/dev/null
grep -Fx -- "--mcp.server-url" "$FAKE_LOG" >/dev/null
grep -Fx -- "url=http://127.0.0.1:8787/mcp" "$FAKE_LOG" >/dev/null
grep -Fx -- "--log.level" "$FAKE_LOG" >/dev/null
grep -Fx -- "warn" "$FAKE_LOG" >/dev/null

LEGACY_HOME="$SCRATCH/legacy-home"
LEGACY_DIR="$LEGACY_HOME/tunnel-client-runtime-v0.0.15-darwin-arm64"
LEGACY_SECRET="$LEGACY_HOME/.computer-mcp/secrets/openai-api-key"
LEGACY_LOG="$SCRATCH/legacy-runtime-args.log"

mkdir -p "$LEGACY_DIR" "$(dirname "$LEGACY_SECRET")"
printf '%s\n' "sk-legacy-not-real" > "$LEGACY_SECRET"
chmod 600 "$LEGACY_SECRET"

cat > "$LEGACY_DIR/start-tunnel.sh" <<'SH'
#!/bin/zsh
./tunnel-client-runtime run \
  --control-plane.api-key "file:$HOME/.computer-mcp/secrets/openai-api-key" \
  --control-plane.tunnel-id "tunnel_legacy_654321" \
  --mcp.server-url "url=http://127.0.0.1:8787/mcp"
SH

LEGACY_STATUS="$(
  HOME="$LEGACY_HOME" \
  TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
    bash "$ROOT/scripts/tunnel-client.sh" status
)"
[[ "$LEGACY_STATUS" == *"Tunnel ID: configured"* ]]
[[ "$LEGACY_STATUS" == *"API key: configured (secret hidden)"* ]]
[[ "$LEGACY_STATUS" != *"sk-legacy-not-real"* ]]

HOME="$LEGACY_HOME" \
TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
FAKE_LOG="$LEGACY_LOG" \
  bash "$ROOT/scripts/tunnel-client.sh" run

grep -Fx -- "tunnel_legacy_654321" "$LEGACY_LOG" >/dev/null
grep -Fx -- "file:$LEGACY_SECRET" "$LEGACY_LOG" >/dev/null

printf '\n\n' | \
HOME="$LEGACY_HOME" \
TUNNEL_CLIENT_RUNTIME_BIN="$FAKE_RUNTIME" \
  bash "$ROOT/scripts/tunnel-client.sh" setup >/dev/null

[[ "$(cat "$LEGACY_HOME/.computer-mcp/tunnel/tunnel-id")" == "tunnel_legacy_654321" ]]

printf '{"ok":true,"interactiveSetup":true,"secretFileMode":"0600","statusRedactsApiKey":true,"savedRuntimePath":true,"zeroInputRun":true,"legacyAutoImport":true}\n'
