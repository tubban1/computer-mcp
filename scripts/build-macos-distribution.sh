#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
VERSION="$(node -p "require('$ROOT/package.json').version")"
GIT_SHA="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo source)"
NODE_VERSION="${COMPUTER_MCP_BUNDLED_NODE_VERSION:-v24.21.0}"
if [[ -n "${MACOS_ARCH:-}" ]]; then
  ARCH="$MACOS_ARCH"
elif [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == "1" ]]; then
  ARCH="arm64"
else
  ARCH="$(uname -m)"
fi

case "$ARCH" in
  arm64) NODE_ARCH="arm64"; SWIFT_TARGET="arm64-apple-macos13"; SWIFT_EXEC_ARCH="arm64" ;;
  x86_64|x64) ARCH="x64"; NODE_ARCH="x64"; SWIFT_TARGET="x86_64-apple-macos13"; SWIFT_EXEC_ARCH="x86_64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 2 ;;
esac

HOST_DIR="$ROOT/macos-runtime-host"
BUILD_ROOT="$ROOT/build/macos-distribution-$ARCH"
PAYLOAD="$BUILD_ROOT/Computer-MCP-$VERSION-macOS-$ARCH"
APP="$PAYLOAD/Computer MCP Runtime.app"
HELPER_APP="$PAYLOAD/Computer MCP Helper.app"
NODE_PAYLOAD="$PAYLOAD/node-runtime"
SERVER_PAYLOAD="$PAYLOAD/server-release"
OUT_DIR="$ROOT/dist-packages"
ZIP="$OUT_DIR/Computer-MCP-$VERSION-macOS-$ARCH.zip"
CACHE_DIR="$ROOT/build/download-cache"
NODE_TARBALL="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_TARBALL"
NODE_SHASUM_URL="https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
NODE_ARCHIVE="$CACHE_DIR/$NODE_TARBALL"

rm -rf "$BUILD_ROOT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$HELPER_APP/Contents/MacOS" "$HELPER_APP/Contents/Resources" "$NODE_PAYLOAD/bin" "$SERVER_PAYLOAD" "$OUT_DIR" "$CACHE_DIR"

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
printf '%s\n' "$VERSION" > "$SERVER_PAYLOAD/VERSION"
printf '%s\n' "$GIT_SHA" > "$SERVER_PAYLOAD/GIT_SHA"

cat > "$PAYLOAD/Install Computer MCP.command" <<'EOF'
#!/bin/zsh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$HERE/Computer MCP Runtime.app"
HELPER_SOURCE="$HERE/Computer MCP Helper.app"
NODE_SOURCE="$HERE/node-runtime"
SERVER_SOURCE="$HERE/server-release"
APP_DEST="$HOME/Applications/Computer MCP Runtime.app"
HELPER_DEST="$HOME/Applications/Computer MCP Helper.app"
AGENTOS_HOME="$HOME/.agentos"
RELEASES="$AGENTOS_HOME/releases"
CURRENT="$AGENTOS_HOME/current"
ENV_FILE="$AGENTOS_HOME/runtime.env"
PLIST="$HOME/Library/LaunchAgents/com.agentos.runtime.plist"
LABEL="com.agentos.runtime"

VERSION="$(cat "$SERVER_SOURCE/VERSION")"
SHA="$(cat "$SERVER_SOURCE/GIT_SHA")"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) EXPECTED_NODE="arm64" ;;
  x86_64) EXPECTED_NODE="x86_64" ;;
  *) echo "Unsupported Mac architecture: $ARCH" >&2; exit 2 ;;
esac

NODE_VERSION="$(cat "$NODE_SOURCE/VERSION")"
NODE_BIN="$NODE_SOURCE/bin/node"
ACTUAL_NODE="$(file "$NODE_BIN")"
if [[ "$ACTUAL_NODE" != *"$EXPECTED_NODE"* ]]; then
  echo "This package does not match this Mac architecture."
  echo "  Mac: $ARCH"
  echo "  bundled Node: $ACTUAL_NODE"
  exit 2
fi

mkdir -p "$HOME/Applications" "$RELEASES" "$AGENTOS_HOME/logs" "$AGENTOS_HOME/node" "$(dirname "$PLIST")"

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
    mkdir -p "$HOME/.computer-mcp"
    chmod 700 "$HOME/.computer-mcp"
    open -gj "$HELPER_DEST" --args --serve >/dev/null 2>&1 || true
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

This package is self-contained for the Computer MCP core:
- Computer MCP Runtime.app (stable file-permission identity)
- Computer MCP Helper.app (stable Accessibility/Screen Recording identity)
- bundled official Node.js $NODE_VERSION
- compiled Computer MCP server
- production npm dependencies
- installer and checksum

Target Mac does NOT need Node.js, npm, TypeScript, Homebrew, or the source repository.

One-time macOS permissions after install:
- Full Disk Access -> Computer MCP Runtime
- Accessibility -> Computer MCP Helper
- Screen & System Audio Recording -> Computer MCP Helper

Secure MCP Tunnel for ChatGPT remote connectivity is a separate external component and is not redistributed in this package.
EOF

rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$PAYLOAD" "$ZIP"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

echo "$ZIP"
echo "$ZIP.sha256"
