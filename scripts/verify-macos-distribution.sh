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
SERVER="$PAYLOAD/server-release"
PLIST="$APP/Contents/Info.plist"
HELPER_PLIST="$HELPER/Contents/Info.plist"

[[ -x "$APP/Contents/MacOS/ComputerMCPRuntime" ]]
[[ -f "$APP/Contents/Resources/ComputerMCPRuntime.icns" ]]
[[ -x "$HELPER/Contents/MacOS/ComputerMCPHelper" ]]
[[ -x "$NODE" ]]
[[ -f "$NODE_ROOT/LICENSE" ]]
[[ -f "$NODE_ROOT/VERSION" ]]
[[ -f "$SERVER/dist/server.js" ]]
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

[[ "$BUNDLE_ID" == "fan.fde.computermcp.runtime" ]]
[[ "$HOST_VERSION" == "1.0.0" ]]
[[ "$ICON_FILE" == "ComputerMCPRuntime" ]]
[[ "$HELPER_ID" == "fan.fde.computermcp.helper" ]]
[[ "$HELPER_VERSION" == "0.2.0" ]]
file "$NODE" | grep -q "$EXPECTED_ARCH"
[[ "$("$NODE" -v)" == "$NODE_VERSION" ]]
codesign --verify --deep --strict "$APP"
codesign --verify --deep --strict "$HELPER"

ICON_BYTES="$(stat -f %z "$APP/Contents/Resources/ComputerMCPRuntime.icns")"
ZIP_BYTES="$(stat -f %z "$ZIP")"

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

cleanup_server
trap 'rm -rf "$TMP"' EXIT

printf '{\n'
printf '  "ok": true,\n'
printf '  "computerMcpVersion": "%s",\n' "$VERSION"
printf '  "architecture": "%s",\n' "$ARCH"
printf '  "runtimeHostBundleId": "%s",\n' "$BUNDLE_ID"
printf '  "runtimeHostVersion": "%s",\n' "$HOST_VERSION"
printf '  "helperBundleId": "%s",\n' "$HELPER_ID"
printf '  "helperVersion": "%s",\n' "$HELPER_VERSION"
printf '  "bundledNodeVersion": "%s",\n' "$NODE_VERSION"
printf '  "productionDependenciesPackaged": true,\n'
printf '  "devDependenciesExcluded": true,\n'
printf '  "noSystemNodeRequired": true,\n'
printf '  "isolatedBundledRuntimeBoot": true,\n'
printf '  "iconPackaged": true,\n'
printf '  "iconBytes": %s,\n' "$ICON_BYTES"
printf '  "zipBytes": %s,\n' "$ZIP_BYTES"
printf '  "checksumVerified": true,\n'
printf '  "codeSignaturesVerified": true\n'
printf '}\n'
