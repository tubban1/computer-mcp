#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZIP="$ROOT/dist-packages/Computer-MCP-$VERSION-macOS.zip"
SHA="$ZIP.sha256"
TMP="$ROOT/.tmp-verify-macos-distribution"

if [[ "${VERIFY_MACOS_DISTRIBUTION_REBUILD:-false}" == "true" || ! -f "$ZIP" || ! -f "$SHA" ]]; then
  "$ROOT/scripts/build-macos-distribution.sh" >/dev/null
fi

[[ -f "$ZIP" ]]
[[ -f "$SHA" ]]
shasum -a 256 -c "$SHA" >/dev/null

rm -rf "$TMP"
mkdir -p "$TMP"
ditto -x -k "$ZIP" "$TMP"

PAYLOAD="$TMP/Computer-MCP-$VERSION-macOS"
APP="$PAYLOAD/Computer MCP Runtime.app"
PLIST="$APP/Contents/Info.plist"

[[ -x "$APP/Contents/MacOS/ComputerMCPRuntime" ]]
[[ -f "$APP/Contents/Resources/ComputerMCPRuntime.icns" ]]
[[ -x "$PAYLOAD/Install Computer MCP Runtime.command" ]]
[[ -f "$PAYLOAD/README.txt" ]]

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")"
HOST_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")"
ICON_FILE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$PLIST")"

[[ "$BUNDLE_ID" == "fan.fde.computermcp.runtime" ]]
[[ "$HOST_VERSION" == "1.0.0" ]]
[[ "$ICON_FILE" == "ComputerMCPRuntime" ]]
codesign --verify --deep --strict "$APP"

ICON_BYTES="$(stat -f %z "$APP/Contents/Resources/ComputerMCPRuntime.icns")"
ZIP_BYTES="$(stat -f %z "$ZIP")"

rm -rf "$TMP"

printf '{\n'
printf '  "ok": true,\n'
printf '  "computerMcpVersion": "%s",\n' "$VERSION"
printf '  "runtimeHostBundleId": "%s",\n' "$BUNDLE_ID"
printf '  "runtimeHostVersion": "%s",\n' "$HOST_VERSION"
printf '  "iconPackaged": true,\n'
printf '  "iconBytes": %s,\n' "$ICON_BYTES"
printf '  "zipBytes": %s,\n' "$ZIP_BYTES"
printf '  "checksumVerified": true,\n'
printf '  "codeSignatureVerified": true\n'
printf '}\n'
