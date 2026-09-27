#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH="${MACOS_ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64) EXPECTED_ARCH="arm64" ;;
  x86_64|x64) ARCH="x64"; EXPECTED_ARCH="x86_64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 2 ;;
esac

if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  HOST_ARCH="arm64"
else
  HOST_ARCH="x64"
fi
CAN_EXECUTE_PACKAGE=false
[[ "$ARCH" == "$HOST_ARCH" ]] && CAN_EXECUTE_PACKAGE=true

ZIP="$ROOT/dist-packages/Computer-MCP-$VERSION-macOS-$ARCH.zip"
SHA="$ZIP.sha256"
TMP="$ROOT/.tmp-verify-macos-distribution-$ARCH"

if [[ "${VERIFY_MACOS_DISTRIBUTION_REBUILD:-false}" == "true" || ! -f "$ZIP" || ! -f "$SHA" ]]; then
  MACOS_ARCH="$ARCH" "$ROOT/scripts/build-macos-distribution.sh" >/dev/null
fi

[[ -f "$ZIP" ]]
[[ -f "$SHA" ]]
shasum -a 256 -c "$SHA" >/dev/null

rm -rf "$TMP"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

ditto -x -k "$ZIP" "$TMP"

PAYLOAD="$TMP/Computer-MCP-$VERSION-macOS-$ARCH"
APP="$PAYLOAD/Computer MCP Runtime.app"
HELPER="$PAYLOAD/Computer MCP Helper.app"
NODE_ROOT="$PAYLOAD/node-runtime"
NODE="$NODE_ROOT/bin/node"
TUNNEL_ROOT="$PAYLOAD/tunnel-runtime"
TUNNEL="$TUNNEL_ROOT/tunnel-client-runtime"
SERVER="$PAYLOAD/server-release"
PLIST="$APP/Contents/Info.plist"
HELPER_PLIST="$HELPER/Contents/Info.plist"

[[ -x "$APP/Contents/MacOS/ComputerMCPRuntime" ]]
[[ -f "$APP/Contents/Resources/ComputerMCPRuntime.icns" ]]
[[ -x "$HELPER/Contents/MacOS/ComputerMCPHelper" ]]
[[ -x "$NODE" ]]
[[ -f "$NODE_ROOT/LICENSE" ]]
[[ -f "$NODE_ROOT/VERSION" ]]
[[ -x "$TUNNEL" ]]
[[ -f "$TUNNEL_ROOT/VERSION" ]]
[[ -f "$TUNNEL_ROOT/LICENSE" ]]
[[ -f "$TUNNEL_ROOT/NOTICE" ]]
[[ -f "$TUNNEL_ROOT/SOURCE.txt" ]]
[[ -f "$SERVER/dist/server.js" ]]
[[ -x "$SERVER/scripts/tunnel-client.sh" ]]
[[ -x "$SERVER/scripts/tunnel-service.sh" ]]
[[ -x "$SERVER/scripts/helper-service.sh" ]]
[[ -d "$SERVER/node_modules/@modelcontextprotocol/sdk" ]]
[[ -d "$SERVER/node_modules/express" ]]
[[ -d "$SERVER/node_modules/zod" ]]
[[ ! -d "$SERVER/node_modules/typescript" ]]
[[ ! -d "$SERVER/node_modules/tsx" ]]
[[ -x "$PAYLOAD/Install Computer MCP.command" ]]
[[ -f "$PAYLOAD/README.txt" ]]

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")"
HOST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")"
ICON_FILE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$PLIST")"
HELPER_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$HELPER_PLIST")"
HELPER_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$HELPER_PLIST")"
NODE_VERSION="$(cat "$NODE_ROOT/VERSION")"
TUNNEL_VERSION="$(cat "$TUNNEL_ROOT/VERSION")"

[[ "$BUNDLE_ID" == "fan.fde.computermcp.runtime" ]]
[[ "$HOST_VERSION" == "1.0.0" ]]
[[ "$ICON_FILE" == "ComputerMCPRuntime" ]]
[[ "$HELPER_ID" == "fan.fde.computermcp.helper" ]]
[[ "$HELPER_VERSION" == "0.2.0" ]]
file "$NODE" | grep -q "$EXPECTED_ARCH"
file "$TUNNEL" | grep -q "$EXPECTED_ARCH"
RUNTIME_EXECUTION_TEST="skipped-cross-arch"
if [[ "$CAN_EXECUTE_PACKAGE" == "true" ]]; then
  [[ "$("$NODE" -v)" == "$NODE_VERSION" ]]
  "$TUNNEL" --version 2>&1 | grep -q "^$TUNNEL_VERSION "
  RUNTIME_EXECUTION_TEST="passed"
fi
grep -q "Apache License" "$TUNNEL_ROOT/LICENSE"
grep -q "github.com/openai/tunnel-client/releases" "$TUNNEL_ROOT/SOURCE.txt"
grep -q "sha256:" "$TUNNEL_ROOT/SOURCE.txt"
bash -n "$SERVER/scripts/tunnel-client.sh"
zsh -n "$SERVER/scripts/tunnel-service.sh"
zsh -n "$SERVER/scripts/helper-service.sh"
if find "$PAYLOAD" -type f \( -name 'openai-api-key' -o -name 'tunnel-id' \) | grep -q .; then
  echo "Distribution must not contain Tunnel credentials." >&2
  exit 1
fi
codesign --verify --deep --strict "$APP"
codesign --verify --deep --strict "$HELPER"

SERVICE_TEST="$TMP/service-test"
TUNNEL_TEST_HOME="$SERVICE_TEST/tunnel-home"
mkdir -p "$TUNNEL_TEST_HOME/tunnel" "$TUNNEL_TEST_HOME/secrets"
chmod 700 "$TUNNEL_TEST_HOME" "$TUNNEL_TEST_HOME/tunnel" "$TUNNEL_TEST_HOME/secrets"
printf '%s\n' "verify-tunnel-id" > "$TUNNEL_TEST_HOME/tunnel/tunnel-id"
printf '%s\n' "$TUNNEL" > "$TUNNEL_TEST_HOME/tunnel/runtime-path"
printf '%s\n' "http://127.0.0.1:8787/mcp" > "$TUNNEL_TEST_HOME/tunnel/mcp-server-url"
printf '%s\n' "verify-secret-must-not-appear-in-plist" > "$TUNNEL_TEST_HOME/secrets/openai-api-key"
chmod 600 "$TUNNEL_TEST_HOME/tunnel/"* "$TUNNEL_TEST_HOME/secrets/openai-api-key"

COMPUTER_MCP_TUNNEL_HOME="$TUNNEL_TEST_HOME" \
COMPUTER_MCP_TUNNEL_SERVICE_PLIST="$SERVICE_TEST/tunnel.plist" \
COMPUTER_MCP_TUNNEL_NO_LAUNCHD=true \
  zsh "$SERVER/scripts/tunnel-service.sh" install >/dev/null
plutil -lint "$SERVICE_TEST/tunnel.plist" >/dev/null
grep -Fq "file:$TUNNEL_TEST_HOME/secrets/openai-api-key" "$SERVICE_TEST/tunnel.plist"
if grep -Fq "verify-secret-must-not-appear-in-plist" "$SERVICE_TEST/tunnel.plist"; then
  echo "Tunnel API key leaked into launchd plist." >&2
  exit 1
fi

COMPUTER_MCP_HELPER_APP="$HELPER" \
COMPUTER_MCP_HELPER_SOCKET="$SERVICE_TEST/helper.sock" \
COMPUTER_MCP_HELPER_SERVICE_PLIST="$SERVICE_TEST/helper.plist" \
COMPUTER_MCP_HELPER_NO_LAUNCHD=true \
COMPUTER_MCP_HOME="$SERVICE_TEST/helper-home" \
  zsh "$SERVER/scripts/helper-service.sh" install >/dev/null
plutil -lint "$SERVICE_TEST/helper.plist" >/dev/null
grep -Fq "$HELPER/Contents/MacOS/ComputerMCPHelper" "$SERVICE_TEST/helper.plist"
grep -Fq -- "--serve" "$SERVICE_TEST/helper.plist"

ICON_BYTES="$(stat -f %z "$APP/Contents/Resources/ComputerMCPRuntime.icns")"
ZIP_BYTES="$(stat -f %z "$ZIP")"

ISOLATED_BOOT_TEST="skipped-cross-arch"
if [[ "$CAN_EXECUTE_PACKAGE" == "true" ]]; then
  PORT="${VERIFY_MACOS_DISTRIBUTION_PORT:-8792}"
  STATE="$TMP/state"
  mkdir -p "$STATE"
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  PORT="$PORT" \
  AGENTOS_RUNTIME_MODE=production \
  AGENTOS_STATE_ROOT="$STATE" \
  ALLOWED_DIRECTORIES="$TMP" \
  MACOS_HELPER_MODE=disabled \
  COMPUTER_MCP_RUNTIME_BACKEND=legacy \
  "$NODE" "$SERVER/dist/server.js" >"$TMP/stdout.log" 2>"$TMP/stderr.log" &
  SERVER_PID=$!

  cleanup_server() {
    kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  }
  trap 'cleanup_server; rm -rf "$TMP"' EXIT

  HEALTH_OK=false
  for _ in {1..40}; do
    if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$PORT/health" >"$TMP/health.json" 2>/dev/null; then
      HEALTH_OK=true
      break
    fi
    sleep 0.25
  done

  if [[ "$HEALTH_OK" != "true" ]]; then
    cat "$TMP/stdout.log" >&2 || true
    cat "$TMP/stderr.log" >&2 || true
    exit 1
  fi

  HEALTH_VERSION="$(python3 - <<'PY' "$TMP/health.json"
import json,sys
print(json.load(open(sys.argv[1]))["version"])
PY
)"
  [[ "$HEALTH_VERSION" == "$VERSION" ]]
  ISOLATED_BOOT_TEST="passed"

  cleanup_server
  trap 'rm -rf "$TMP"' EXIT
fi

printf '{\n'
printf '  "ok": true,\n'
printf '  "computerMcpVersion": "%s",\n' "$VERSION"
printf '  "architecture": "%s",\n' "$ARCH"
printf '  "runtimeHostBundleId": "%s",\n' "$BUNDLE_ID"
printf '  "runtimeHostVersion": "%s",\n' "$HOST_VERSION"
printf '  "helperBundleId": "%s",\n' "$HELPER_ID"
printf '  "helperVersion": "%s",\n' "$HELPER_VERSION"
printf '  "bundledNodeVersion": "%s",\n' "$NODE_VERSION"
printf '  "bundledTunnelVersion": "%s",\n' "$TUNNEL_VERSION"
printf '  "openAITunnelLicenseIncluded": true,\n'
printf '  "openAITunnelNoticeIncluded": true,\n'
printf '  "openAITunnelSourceProvenanceIncluded": true,\n'
printf '  "noTunnelCredentialsPackaged": true,\n'
printf '  "tunnelApiKeyUsesFileReference": true,\n'
printf '  "helperLaunchdConfigVerified": true,\n'
printf '  "tunnelLaunchdConfigVerified": true,\n'
printf '  "productionDependenciesPackaged": true,\n'
printf '  "devDependenciesExcluded": true,\n'
printf '  "noSystemNodeRequired": true,\n'
printf '  "noSeparateTunnelDownloadRequired": true,\n'
printf '  "runtimeExecutionTest": "%s",\n' "$RUNTIME_EXECUTION_TEST"
printf '  "isolatedBundledRuntimeBoot": "%s",\n' "$ISOLATED_BOOT_TEST"
printf '  "iconPackaged": true,\n'
printf '  "iconBytes": %s,\n' "$ICON_BYTES"
printf '  "zipBytes": %s,\n' "$ZIP_BYTES"
printf '  "checksumVerified": true,\n'
printf '  "codeSignaturesVerified": true\n'
printf '}\n'
