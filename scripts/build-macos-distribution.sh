#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
VERSION="$(node -p "require('$ROOT/package.json').version")"
HOST_DIR="$ROOT/macos-runtime-host"
BUILD_ROOT="$ROOT/build/macos-distribution"
PAYLOAD="$BUILD_ROOT/Computer-MCP-$VERSION-macOS"
APP="$PAYLOAD/Computer MCP Runtime.app"
OUT_DIR="$ROOT/dist-packages"
ZIP="$OUT_DIR/Computer-MCP-$VERSION-macOS.zip"

rm -rf "$BUILD_ROOT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$OUT_DIR"

xcrun swiftc -O "$HOST_DIR/ComputerMCPRuntime.swift" -o "$APP/Contents/MacOS/ComputerMCPRuntime"
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

cat > "$PAYLOAD/Install Computer MCP Runtime.command" <<'EOF'
#!/bin/zsh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$HERE/Computer MCP Runtime.app"
DEST="$HOME/Applications/Computer MCP Runtime.app"
mkdir -p "$HOME/Applications"
if [[ -d "$DEST" ]]; then
  echo "Computer MCP Runtime is already installed."
  echo "For permission stability, this installer will not overwrite it automatically."
  echo "Remove/replace it only during an explicit Runtime Host upgrade."
  exit 2
fi
ditto "$SOURCE" "$DEST"
codesign --verify --deep --strict "$DEST"
echo "Installed: $DEST"
echo
echo "Next: System Settings -> Privacy & Security -> Full Disk Access"
echo "Enable: Computer MCP Runtime"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" >/dev/null 2>&1 || true
EOF
chmod 755 "$PAYLOAD/Install Computer MCP Runtime.command"

cat > "$PAYLOAD/README.txt" <<EOF
Computer MCP $VERSION - macOS Runtime Host

1. Open "Install Computer MCP Runtime.command".
2. In System Settings > Privacy & Security > Full Disk Access,
   enable "Computer MCP Runtime".
3. The stable app lives at:
   ~/Applications/Computer MCP Runtime.app

The Runtime Host carries protected-file permissions.
Computer MCP Helper separately carries Accessibility and Screen Recording permissions.
Ordinary Computer MCP 1.x server updates do not replace either permission-bearing app.
EOF

rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$PAYLOAD" "$ZIP"
shasum -a 256 "$ZIP" > "$ZIP.sha256"

echo "$ZIP"
echo "$ZIP.sha256"
