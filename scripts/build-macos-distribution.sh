#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
VERSION="$(node -p "require('$ROOT/package.json').version")"
GIT_SHA="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo source)"
NODE_VERSION="${COMPUTER_MCP_BUNDLED_NODE_VERSION:-v24.21.0}"
TUNNEL_VERSION="${COMPUTER_MCP_BUNDLED_TUNNEL_VERSION:-0.0.15}"
if [[ -n "${MACOS_ARCH:-}" ]]; then
  ARCH="$MACOS_ARCH"
elif [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  ARCH="arm64"
else
  ARCH="$(uname -m)"
fi

case "$ARCH" in
  arm64) NODE_ARCH="arm64"; TUNNEL_ARCH="arm64"; TUNNEL_SHA256="e416ea9ea13e1b8be0d0a355fbd28143cfa55fe5a32b2986fce1a516d7b5e2ad"; SWIFT_TARGET="arm64-apple-macos13"; SWIFT_EXEC_ARCH="arm64" ;;
  x86_64|x64) ARCH="x64"; NODE_ARCH="x64"; TUNNEL_ARCH="amd64"; TUNNEL_SHA256="2d3a2b3a985ad2fcfddc4a82a0caa6624ee9383e7d85e82563bf1fe3ce905794"; SWIFT_TARGET="x86_64-apple-macos13"; SWIFT_EXEC_ARCH="x86_64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 2 ;;
esac

HOST_DIR="$ROOT/macos-runtime-host"
BUILD_ROOT="$ROOT/build/macos-distribution-$ARCH"
PAYLOAD="$BUILD_ROOT/Computer-MCP-$VERSION-macOS-$ARCH"
APP="$PAYLOAD/Computer MCP Runtime.app"
HELPER_APP="$PAYLOAD/Computer MCP Helper.app"
NODE_PAYLOAD="$PAYLOAD/node-runtime"
TUNNEL_PAYLOAD="$PAYLOAD/tunnel-runtime"
SERVER_PAYLOAD="$PAYLOAD/server-release"
OUT_DIR="$ROOT/dist-packages"
ZIP="$OUT_DIR/Computer-MCP-$VERSION-macOS-$ARCH.zip"
CACHE_DIR="$ROOT/build/download-cache"
NODE_TARBALL="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_TARBALL"
NODE_SHASUM_URL="https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
NODE_ARCHIVE="$CACHE_DIR/$NODE_TARBALL"
TUNNEL_ZIP_NAME="tunnel-client-runtime-v$TUNNEL_VERSION-darwin-$TUNNEL_ARCH.zip"
TUNNEL_URL="https://github.com/openai/tunnel-client/releases/download/v$TUNNEL_VERSION/$TUNNEL_ZIP_NAME"
TUNNEL_ARCHIVE="$CACHE_DIR/$TUNNEL_ZIP_NAME"

rm -rf "$BUILD_ROOT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$HELPER_APP/Contents/MacOS" "$HELPER_APP/Contents/Resources" "$NODE_PAYLOAD/bin" "$TUNNEL_PAYLOAD" "$SERVER_PAYLOAD" "$OUT_DIR" "$CACHE_DIR"

echo "Building Computer MCP $VERSION macOS $ARCH distribution"
echo "  bundled Node: $NODE_VERSION ($NODE_ARCH)"

if [[ ! -f "$NODE_ARCHIVE" ]]; then
  curl -fL --retry 3 --connect-timeout 10 "$NODE_URL" -o "$NODE_ARCHIVE"
fi

curl -fsSL "$NODE_SHASUM_URL" -o "$CACHE_DIR/SHASUMS256-$NODE_VERSION.txt"
(
  cd "$CACHE_DIR"
  EXPECTED="$(grep "  $NODE_TARBALL$" "SHASUMS256-$NODE_VERSION.txt" | awk '{print $1}')"
  [[ -n "$EXPECTED" ]] || { echo "Node checksum not found for $NODE_TARBALL" >&2; exit 1; }
  ACTUAL="$(shasum -a 256 "$NODE_TARBALL" | awk '{print $1}')"
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "Node checksum mismatch" >&2; exit 1; }
)

NODE_EXTRACT="$BUILD_ROOT/node-extract"
mkdir -p "$NODE_EXTRACT"
tar -xzf "$NODE_ARCHIVE" -C "$NODE_EXTRACT"
NODE_ROOT="$NODE_EXTRACT/node-$NODE_VERSION-darwin-$NODE_ARCH"
cp "$NODE_ROOT/bin/node" "$NODE_PAYLOAD/bin/node"
chmod 755 "$NODE_PAYLOAD/bin/node"
cp "$NODE_ROOT/LICENSE" "$NODE_PAYLOAD/LICENSE"
printf '%s\n' "$NODE_VERSION" > "$NODE_PAYLOAD/VERSION"

echo "  bundled OpenAI Tunnel Client: v$TUNNEL_VERSION ($TUNNEL_ARCH)"
if [[ ! -f "$TUNNEL_ARCHIVE" ]]; then
  curl -fL --retry 3 --connect-timeout 10 "$TUNNEL_URL" -o "$TUNNEL_ARCHIVE"
fi
ACTUAL_TUNNEL_SHA256="$(shasum -a 256 "$TUNNEL_ARCHIVE" | awk '{print $1}')"
[[ "$ACTUAL_TUNNEL_SHA256" == "$TUNNEL_SHA256" ]] || {
  echo "OpenAI Tunnel Client checksum mismatch." >&2
  echo "expected: $TUNNEL_SHA256" >&2
  echo "actual:   $ACTUAL_TUNNEL_SHA256" >&2
  exit 1
}

TUNNEL_EXTRACT="$BUILD_ROOT/tunnel-extract"
rm -rf "$TUNNEL_EXTRACT"
mkdir -p "$TUNNEL_EXTRACT"
ditto -x -k "$TUNNEL_ARCHIVE" "$TUNNEL_EXTRACT"
TUNNEL_BIN_SOURCE="$(find "$TUNNEL_EXTRACT" -type f -name tunnel-client-runtime -perm -111 | head -n 1)"
[[ -n "$TUNNEL_BIN_SOURCE" ]] || {
  echo "OpenAI Tunnel Client executable was not found in $TUNNEL_ZIP_NAME" >&2
  exit 1
}
TUNNEL_SOURCE_DIR="$(dirname "$TUNNEL_BIN_SOURCE")"
ditto "$TUNNEL_SOURCE_DIR" "$TUNNEL_PAYLOAD"
chmod 755 "$TUNNEL_PAYLOAD/tunnel-client-runtime"
[[ -f "$TUNNEL_PAYLOAD/LICENSE" ]] || {
  echo "OpenAI Tunnel Client LICENSE missing from upstream archive." >&2
  exit 1
}
[[ -f "$TUNNEL_PAYLOAD/NOTICE" ]] || {
  echo "OpenAI Tunnel Client NOTICE missing from upstream archive." >&2
  exit 1
}
printf '%s\n' "$TUNNEL_VERSION" > "$TUNNEL_PAYLOAD/VERSION"
cat > "$TUNNEL_PAYLOAD/SOURCE.txt" <<EOF
OpenAI Tunnel Client
source: $TUNNEL_URL
version: v$TUNNEL_VERSION
sha256: $TUNNEL_SHA256
license: Apache-2.0 (see LICENSE)
EOF

xcrun swiftc -O -target "$SWIFT_TARGET" "$HOST_DIR/ComputerMCPRuntime.swift" -o "$APP/Contents/MacOS/ComputerMCPRuntime"
cp "$HOST_DIR/Info.plist" "$APP/Contents/Info.plist"
chmod 755 "$APP/Contents/MacOS/ComputerMCPRuntime"

ICONSET="$BUILD_ROOT/ComputerMCPRuntime.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$HOST_DIR/ComputerMCPRuntime.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$HOST_DIR/ComputerMCPRuntime.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/ComputerMCPRuntime.icns"

FINGERPRINT="$({
  shasum -a 256 "$HOST_DIR/ComputerMCPRuntime.swift" | awk '{print $1}'
  shasum -a 256 "$HOST_DIR/Info.plist" | awk '{print $1}'
  shasum -a 256 "$HOST_DIR/ComputerMCPRuntime.png" | awk '{print $1}'
} | shasum -a 256 | awk '{print $1}')"
printf '%s\n' "$FINGERPRINT" > "$APP/Contents/Resources/source.sha256"

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "Building stable Computer MCP Helper..."
HELPER_DIR="$ROOT/macos-helper"
xcrun swiftc -O -target "$SWIFT_TARGET" \
  -framework AppKit \
  -framework ApplicationServices \
  -framework CoreGraphics \
  -framework Vision \
  "$HELPER_DIR/ComputerMCPHelper.swift" \
  -o "$HELPER_APP/Contents/MacOS/ComputerMCPHelper"
cp "$HELPER_DIR/Info.plist" "$HELPER_APP/Contents/Info.plist"
HELPER_FINGERPRINT="$({
  shasum -a 256 "$HELPER_DIR/ComputerMCPHelper.swift" | awk '{print $1}'
  shasum -a 256 "$HELPER_DIR/Info.plist" | awk '{print $1}'
} | shasum -a 256 | awk '{print $1}')"
printf '%s\n' "$HELPER_FINGERPRINT" > "$HELPER_APP/Contents/Resources/source.sha256"
chmod 755 "$HELPER_APP/Contents/MacOS/ComputerMCPHelper"
codesign --force --deep --sign - "$HELPER_APP"
codesign --verify --deep --strict "$HELPER_APP"

echo "Building compiled server payload..."
(cd "$ROOT" && npm run build >/dev/null)
cp "$ROOT/package.json" "$SERVER_PAYLOAD/package.json"
cp "$ROOT/package-lock.json" "$SERVER_PAYLOAD/package-lock.json"
ditto "$ROOT/dist" "$SERVER_PAYLOAD/dist"
(
  cd "$SERVER_PAYLOAD"
  npm ci --omit=dev --ignore-scripts >/dev/null
)
rm -rf "$SERVER_PAYLOAD/node_modules/.cache" 2>/dev/null || true
mkdir -p "$SERVER_PAYLOAD/scripts"
cp "$ROOT/scripts/tunnel-client.sh" "$SERVER_PAYLOAD/scripts/tunnel-client.sh"
cp "$ROOT/scripts/tunnel-service.sh" "$SERVER_PAYLOAD/scripts/tunnel-service.sh"
cp "$ROOT/scripts/helper-service.sh" "$SERVER_PAYLOAD/scripts/helper-service.sh"
chmod 755 "$SERVER_PAYLOAD/scripts/tunnel-client.sh" "$SERVER_PAYLOAD/scripts/tunnel-service.sh" "$SERVER_PAYLOAD/scripts/helper-service.sh"
printf '%s\n' "$VERSION" > "$SERVER_PAYLOAD/VERSION"
printf '%s\n' "$GIT_SHA" > "$SERVER_PAYLOAD/GIT_SHA"

cat > "$PAYLOAD/Install Computer MCP.command" <<'EOF'
#!/bin/zsh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$HERE/Computer MCP Runtime.app"
HELPER_SOURCE="$HERE/Computer MCP Helper.app"
NODE_SOURCE="$HERE/node-runtime"
TUNNEL_SOURCE="$HERE/tunnel-runtime"
SERVER_SOURCE="$HERE/server-release"
APP_DEST="$HOME/Applications/Computer MCP Runtime.app"
HELPER_DEST="$HOME/Applications/Computer MCP Helper.app"
AGENTOS_HOME="$HOME/.agentos"
COMPUTER_MCP_HOME="$HOME/.computer-mcp"
RELEASES="$AGENTOS_HOME/releases"
CURRENT="$AGENTOS_HOME/current"
ENV_FILE="$AGENTOS_HOME/runtime.env"
PLIST="$HOME/Library/LaunchAgents/com.agentos.runtime.plist"
LABEL="com.agentos.runtime"

VERSION="$(cat "$SERVER_SOURCE/VERSION")"
SHA="$(cat "$SERVER_SOURCE/GIT_SHA")"
if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  ARCH="arm64"
else
  ARCH="$(uname -m)"
fi
case "$ARCH" in
  arm64) EXPECTED_NODE="arm64" ;;
  x86_64) EXPECTED_NODE="x86_64" ;;
  *) echo "Unsupported Mac architecture: $ARCH" >&2; exit 2 ;;
esac

NODE_VERSION="$(cat "$NODE_SOURCE/VERSION")"
NODE_BIN="$NODE_SOURCE/bin/node"
TUNNEL_VERSION="$(cat "$TUNNEL_SOURCE/VERSION")"
TUNNEL_BIN_SOURCE="$TUNNEL_SOURCE/tunnel-client-runtime"
ACTUAL_NODE="$(file "$NODE_BIN")"
if [[ "$ACTUAL_NODE" != *"$EXPECTED_NODE"* ]]; then
  echo "This package does not match this Mac architecture."
  echo "  Mac: $ARCH"
  echo "  bundled Node: $ACTUAL_NODE"
  exit 2
fi

ACTUAL_TUNNEL="$(file "$TUNNEL_BIN_SOURCE")"
if [[ "$ACTUAL_TUNNEL" != *"$EXPECTED_NODE"* ]]; then
  echo "Bundled OpenAI Tunnel Client does not match this Mac architecture."
  echo "  Mac: $ARCH"
  echo "  tunnel: $ACTUAL_TUNNEL"
  exit 2
fi

mkdir -p "$HOME/Applications" "$RELEASES" "$AGENTOS_HOME/logs" "$AGENTOS_HOME/node" "$AGENTOS_HOME/tunnel" "$COMPUTER_MCP_HOME/tunnel" "$COMPUTER_MCP_HOME/secrets" "$COMPUTER_MCP_HOME/logs" "$(dirname "$PLIST")"
chmod 700 "$COMPUTER_MCP_HOME" "$COMPUTER_MCP_HOME/tunnel" "$COMPUTER_MCP_HOME/secrets" "$COMPUTER_MCP_HOME/logs"

if [[ -d "$APP_DEST" ]]; then
  INSTALLED_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$INSTALLED_ID" != "fan.fde.computermcp.runtime" ]]; then
    echo "Refusing to replace an unrelated app at $APP_DEST" >&2
    exit 2
  fi
  echo "Existing stable Runtime Host found; preserving it to keep macOS permissions stable."
else
  ditto "$APP_SOURCE" "$APP_DEST"
  codesign --verify --deep --strict "$APP_DEST"
  echo "Installed stable Runtime Host: $APP_DEST"
fi

if [[ -d "$HELPER_DEST" ]]; then
  HELPER_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$HELPER_DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$HELPER_ID" != "fan.fde.computermcp.helper" ]]; then
    echo "Refusing to replace an unrelated app at $HELPER_DEST" >&2
    exit 2
  fi
  echo "Existing stable Helper found; preserving it to keep Accessibility/Screen Recording grants stable."
else
  ditto "$HELPER_SOURCE" "$HELPER_DEST"
  codesign --verify --deep --strict "$HELPER_DEST"
  echo "Installed stable Helper: $HELPER_DEST"
fi

NODE_DEST="$AGENTOS_HOME/node/$NODE_VERSION-$ARCH"
rm -rf "$NODE_DEST"
mkdir -p "$NODE_DEST"
ditto "$NODE_SOURCE" "$NODE_DEST"
BUNDLED_NODE="$NODE_DEST/bin/node"
"$BUNDLED_NODE" -v >/dev/null

TUNNEL_DEST="$AGENTOS_HOME/tunnel/v$TUNNEL_VERSION-$ARCH"
rm -rf "$TUNNEL_DEST"
mkdir -p "$TUNNEL_DEST"
ditto "$TUNNEL_SOURCE" "$TUNNEL_DEST"
BUNDLED_TUNNEL="$TUNNEL_DEST/tunnel-client-runtime"
chmod 755 "$BUNDLED_TUNNEL"
"$BUNDLED_TUNNEL" --version >/dev/null

RELEASE="$RELEASES/$VERSION-$SHA"
rm -rf "$RELEASE"
ditto "$SERVER_SOURCE" "$RELEASE"
ln -sfn "$RELEASE" "$CURRENT"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<ENVEOF
PORT=8787
AGENTOS_WAKE_NAME=Jarvis
ALLOWED_DIRECTORIES=$HOME/Desktop,$HOME/Documents,$HOME/Downloads,$HOME/Pictures,$HOME/Movies,$HOME/Music,$HOME/Public
ALLOW_WRITE=true
ALLOW_DELETE=false
ALLOW_SHELL=true
ALLOW_GIT_PUSH=false
ALLOW_ROLLBACK=true
ALLOW_BROWSER=true
ALLOW_GUI=true
MACOS_HELPER_MODE=required
ENVEOF
fi
chmod 600 "$ENV_FILE"

TUNNEL_CONFIG_DIR="$COMPUTER_MCP_HOME/tunnel"
TUNNEL_SECRETS_DIR="$COMPUTER_MCP_HOME/secrets"
TUNNEL_ID_FILE="$TUNNEL_CONFIG_DIR/tunnel-id"
TUNNEL_RUNTIME_FILE="$TUNNEL_CONFIG_DIR/runtime-path"
TUNNEL_MCP_URL_FILE="$TUNNEL_CONFIG_DIR/mcp-server-url"
TUNNEL_API_KEY_FILE="$TUNNEL_SECRETS_DIR/openai-api-key"

umask 077
printf '%s\n' "$BUNDLED_TUNNEL" > "$TUNNEL_RUNTIME_FILE"
printf '%s\n' "http://127.0.0.1:8787/mcp" > "$TUNNEL_MCP_URL_FILE"
chmod 600 "$TUNNEL_RUNTIME_FILE" "$TUNNEL_MCP_URL_FILE"

if [[ ! -s "$TUNNEL_API_KEY_FILE" ]]; then
  legacy_keys=("$HOME"/tunnel-client-runtime-v*-darwin-*/openai-api-key(N))
  if (( ${#legacy_keys[@]} > 0 )) && [[ -s "${legacy_keys[1]}" ]]; then
    cp "${legacy_keys[1]}" "$TUNNEL_API_KEY_FILE"
    chmod 600 "$TUNNEL_API_KEY_FILE"
    echo "Migrated existing OpenAI Tunnel API key into Computer MCP secure config."
  fi
fi

if [[ -s "$TUNNEL_ID_FILE" && -s "$TUNNEL_API_KEY_FILE" ]]; then
  echo "Existing Tunnel ID and API key found; preserving them."
else
  echo
  echo "Configure ChatGPT Secure MCP Tunnel:"
  COMPUTER_MCP_TUNNEL_HOME="$COMPUTER_MCP_HOME" \
  TUNNEL_CLIENT_RUNTIME_BIN="$BUNDLED_TUNNEL" \
  bash "$CURRENT/scripts/tunnel-client.sh" setup
fi

RUNTIME_HOST_BIN="$APP_DEST/Contents/MacOS/ComputerMCPRuntime"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
<string>$RUNTIME_HOST_BIN</string>
<string>--env-file</string>
<string>$ENV_FILE</string>
<string>$BUNDLED_NODE</string>
<string>$CURRENT/dist/server.js</string>
</array>
<key>WorkingDirectory</key><string>$CURRENT</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string>
<key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>$AGENTOS_HOME/logs/runtime.stdout.log</string>
<key>StandardErrorPath</key><string>$AGENTOS_HOME/logs/runtime.stderr.log</string>
</dict></plist>
PLISTEOF
chmod 600 "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
for _ in {1..5}; do
  if launchctl bootstrap "gui/$UID" "$PLIST" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
launchctl kickstart -k "gui/$UID/$LABEL"

for _ in {1..40}; do
  if curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:8787/health >/tmp/computer-mcp-install-health.$$ 2>/dev/null; then
    echo "Computer MCP $VERSION is running."
    rm -f /tmp/computer-mcp-install-health.$$

    COMPUTER_MCP_HOME="$COMPUTER_MCP_HOME" \
      zsh "$CURRENT/scripts/helper-service.sh" install

    COMPUTER_MCP_TUNNEL_HOME="$COMPUTER_MCP_HOME" \
    COMPUTER_MCP_TUNNEL_FORCE_SERVICE=true \
      zsh "$CURRENT/scripts/tunnel-service.sh" install

    echo
    zsh "$CURRENT/scripts/helper-service.sh" status || true
    COMPUTER_MCP_TUNNEL_HOME="$COMPUTER_MCP_HOME" \
      zsh "$CURRENT/scripts/tunnel-service.sh" status || true

    echo
    echo "Computer MCP $VERSION installation is complete."
    echo "Runtime Server, OpenAI Tunnel Client, and Helper are configured to start automatically."
    echo
    echo "One-time macOS permissions:"
    echo "  Full Disk Access -> Computer MCP Runtime"
    echo "  Accessibility -> Computer MCP Helper"
    echo "  Screen & System Audio Recording -> Computer MCP Helper"
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 0.25
done

echo "Computer MCP was installed but health verification failed." >&2
exit 1
EOF
chmod 755 "$PAYLOAD/Install Computer MCP.command"

cat > "$PAYLOAD/README.txt" <<EOF
Computer MCP $VERSION — macOS $ARCH

This package is self-contained for Computer MCP:
- Computer MCP Runtime.app (stable file-permission identity)
- Computer MCP Helper.app (stable Accessibility/Screen Recording identity)
- bundled official Node.js $NODE_VERSION
- bundled OpenAI Tunnel Client v$TUNNEL_VERSION
- compiled Computer MCP server
- production npm dependencies
- installer and checksum

Target Mac does NOT need Node.js, npm, TypeScript, Homebrew, the source repository,
or a separate Tunnel Client download.

First install:
- enter the ChatGPT Tunnel ID
- enter the OpenAI API key (input is hidden)
The API key is stored in a mode-0600 local secret file and passed to the Tunnel Client
through a file reference, not as plaintext in the launchd command.

After install, Runtime Server, Tunnel Client, and Helper start automatically.

One-time macOS permissions:
- Full Disk Access -> Computer MCP Runtime
- Accessibility -> Computer MCP Helper
- Screen & System Audio Recording -> Computer MCP Helper

OpenAI Tunnel Client is redistributed under Apache-2.0. Its LICENSE, NOTICE,
third-party license report, SPDX metadata, source URL, and SHA-256 provenance are
included under tunnel-runtime/.
EOF

rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$PAYLOAD" "$ZIP"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

echo "$ZIP"
echo "$ZIP.sha256"
