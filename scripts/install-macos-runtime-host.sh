#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
SRC="$ROOT/macos-runtime-host/ComputerMCPRuntime.swift"
PLIST="$ROOT/macos-runtime-host/Info.plist"
ICON_PNG="$ROOT/macos-runtime-host/ComputerMCPRuntime.png"
BUILD="$ROOT/build/macos-runtime-host"
APP="$BUILD/Computer MCP Runtime.app"
INSTALL_APP="$HOME/Applications/Computer MCP Runtime.app"
SIGN_IDENTITY="${COMPUTER_MCP_RUNTIME_HOST_SIGN_IDENTITY:--}"
ALLOW_UNVERSIONED_UPDATE="${ALLOW_UNVERSIONED_RUNTIME_HOST_UPDATE:-false}"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")
BUILD_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST")
SOURCE_FINGERPRINT=$(
  {
    shasum -a 256 "$SRC" | awk '{print $1}'
    shasum -a 256 "$PLIST" | awk '{print $1}'
    [[ -f "$ICON_PNG" ]] && shasum -a 256 "$ICON_PNG" | awk '{print $1}'
  } | shasum -a 256 | awk '{print $1}'
)
INSTALLED_FINGERPRINT_FILE="$INSTALL_APP/Contents/Resources/source.sha256"

installed_version() {
  [[ -f "$INSTALL_APP/Contents/Info.plist" ]] || return 1
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INSTALL_APP/Contents/Info.plist" 2>/dev/null
}

installed_fingerprint() {
  [[ -f "$INSTALLED_FINGERPRINT_FILE" ]] || return 1
  tr -d '[:space:]' < "$INSTALLED_FINGERPRINT_FILE"
}

if [[ -d "$INSTALL_APP" ]]; then
  EXISTING_FINGERPRINT="$(installed_fingerprint || true)"
  EXISTING_VERSION="$(installed_version || true)"

  if [[ "$EXISTING_FINGERPRINT" == "$SOURCE_FINGERPRINT" ]]; then
    echo "Computer MCP Runtime Host is unchanged; preserving its stable macOS permission identity."
    echo "  app:     $INSTALL_APP"
    echo "  version: ${EXISTING_VERSION:-unknown}"
    exit 0
  fi

  if [[ "$EXISTING_VERSION" == "$VERSION" && "$ALLOW_UNVERSIONED_UPDATE" != "true" ]]; then
    echo "Refusing to replace Computer MCP Runtime Host $VERSION with changed source."
    echo "Bump the independent Runtime Host version before replacing a permission-bearing app."
    echo "For an intentional development override only:"
    echo "  ALLOW_UNVERSIONED_RUNTIME_HOST_UPDATE=true scripts/install-macos-runtime-host.sh"
    exit 1
  fi

  if [[ "$ALLOW_UNVERSIONED_UPDATE" != "true" ]]; then
    echo "A different Computer MCP Runtime Host is already installed."
    echo "Server releases never replace this permission-bearing app automatically."
    echo "Run an explicit Runtime Host upgrade only when you intend to revalidate macOS permissions."
    exit 1
  fi
fi

echo "Installing Computer MCP Runtime Host $VERSION ($BUILD_VERSION)"
echo "  stable path: $INSTALL_APP"
echo "  bundle id:   $(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST")"
echo "  signer:      $SIGN_IDENTITY"

rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

xcrun swiftc -O "$SRC" -o "$APP/Contents/MacOS/ComputerMCPRuntime"
cp "$PLIST" "$APP/Contents/Info.plist"

if [[ -f "$ICON_PNG" ]]; then
  ICONSET="$BUILD/ComputerMCPRuntime.iconset"
  mkdir -p "$ICONSET"
  for SIZE in 16 32 128 256 512; do
    sips -z "$SIZE" "$SIZE" "$ICON_PNG" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
    DOUBLE=$((SIZE * 2))
    sips -z "$DOUBLE" "$DOUBLE" "$ICON_PNG" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/ComputerMCPRuntime.icns"
fi

printf '%s\n' "$SOURCE_FINGERPRINT" > "$APP/Contents/Resources/source.sha256"
chmod 755 "$APP/Contents/MacOS/ComputerMCPRuntime"

codesign --force --deep --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

mkdir -p "$HOME/Applications"
rm -rf "$INSTALL_APP"
ditto "$APP" "$INSTALL_APP"
codesign --force --deep --sign "$SIGN_IDENTITY" "$INSTALL_APP"
codesign --verify --deep --strict "$INSTALL_APP"

echo "Installed:"
echo "  $INSTALL_APP"
echo
echo "Grant Full Disk Access once to 'Computer MCP Runtime' in:"
echo "  System Settings → Privacy & Security → Full Disk Access"
echo
echo "The Runtime Host has an independent version and is not replaced by ordinary 1.x Server promotions."
