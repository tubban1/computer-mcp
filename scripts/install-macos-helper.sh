#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}/.."
SRC="$ROOT/macos-helper/ComputerMCPHelper.swift"
PLIST="$ROOT/macos-helper/Info.plist"
BUILD="$ROOT/build/macos-helper"
APP="$BUILD/Computer MCP Helper.app"
INSTALL_APP="$HOME/Applications/Computer MCP Helper.app"
SOCKET="$HOME/.computer-mcp/helper.sock"
SIGN_IDENTITY="${COMPUTER_MCP_HELPER_SIGN_IDENTITY:--}"
ALLOW_UNVERSIONED_UPDATE="${ALLOW_UNVERSIONED_HELPER_UPDATE:-false}"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")
BUILD_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST")
SOURCE_FINGERPRINT=$(
  {
    shasum -a 256 "$SRC"
    shasum -a 256 "$PLIST"
  } | shasum -a 256 | awk '{print $1}'
)
INSTALLED_FINGERPRINT_FILE="$INSTALL_APP/Contents/Resources/source.sha256"

installed_version() {
  if [[ ! -f "$INSTALL_APP/Contents/Info.plist" ]]; then
    return 1
  fi
  /usr/libexec/PlistBuddy     -c "Print :CFBundleShortVersionString"     "$INSTALL_APP/Contents/Info.plist" 2>/dev/null
}

installed_fingerprint() {
  if [[ ! -f "$INSTALLED_FINGERPRINT_FILE" ]]; then
    return 1
  fi
  tr -d '[:space:]' < "$INSTALLED_FINGERPRINT_FILE"
}

launch_helper() {
  mkdir -p "$HOME/.computer-mcp"
  chmod 700 "$HOME/.computer-mcp"
  open -gj "$INSTALL_APP" --args --serve
  for _ in {1..50}; do
    [[ -S "$SOCKET" ]] && break
    sleep 0.1
  done
}

if [[ -d "$INSTALL_APP" ]]; then
  EXISTING_FINGERPRINT="$(installed_fingerprint || true)"
  EXISTING_VERSION="$(installed_version || true)"

  if [[ -n "$EXISTING_FINGERPRINT" && "$EXISTING_FINGERPRINT" == "$SOURCE_FINGERPRINT" ]]; then
    echo "Computer MCP Helper is unchanged; preserving the installed app and macOS permission identity."
    echo "  app:     $INSTALL_APP"
    echo "  version: ${EXISTING_VERSION:-unknown}"
    [[ -S "$SOCKET" ]] || launch_helper
    exit 0
  fi

  if [[ -n "$EXISTING_FINGERPRINT" && "$EXISTING_VERSION" == "$VERSION" && "$ALLOW_UNVERSIONED_UPDATE" != "true" ]]; then
    echo "Refusing to replace Computer MCP Helper $VERSION with changed helper source."
    echo "Bump CFBundleShortVersionString/CFBundleVersion before a real helper update."
    echo "For an intentional one-off development override only:"
    echo "  ALLOW_UNVERSIONED_HELPER_UPDATE=true scripts/install-macos-helper.sh"
    exit 1
  fi
fi

echo "Installing Computer MCP Helper $VERSION ($BUILD_VERSION)"
echo "  stable path: $INSTALL_APP"
echo "  bundle id:   $(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST")"
echo "  signer:      $SIGN_IDENTITY"

pkill -f "$INSTALL_APP/Contents/MacOS/ComputerMCPHelper" 2>/dev/null || true
rm -f "$SOCKET"
rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

xcrun swiftc \
  -O \
  -framework AppKit \
  -framework ApplicationServices \
  -framework CoreGraphics \
  -framework Vision \
  "$SRC" \
  -o "$APP/Contents/MacOS/ComputerMCPHelper"

cp "$PLIST" "$APP/Contents/Info.plist"
printf '%s\n' "$SOURCE_FINGERPRINT" > "$APP/Contents/Resources/source.sha256"
chmod 755 "$APP/Contents/MacOS/ComputerMCPHelper"

codesign --force --deep --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

mkdir -p "$HOME/Applications" "$HOME/.computer-mcp"
chmod 700 "$HOME/.computer-mcp"
rm -rf "$INSTALL_APP"
ditto "$APP" "$INSTALL_APP"
codesign --force --deep --sign "$SIGN_IDENTITY" "$INSTALL_APP"
codesign --verify --deep --strict "$INSTALL_APP"

launch_helper

echo "Installed:"
echo "  $INSTALL_APP"
echo
echo "Unix socket:"
ls -l "$SOCKET" 2>/dev/null || echo "  helper socket not ready"
echo
echo "The helper is launched by macOS LaunchServices, not by your IDE/Terminal."
echo "Grant permissions to 'Computer MCP Helper' in:"
echo "  System Settings → Privacy & Security → Accessibility"
echo "  System Settings → Privacy & Security → Screen & System Audio Recording"
echo
echo "To trigger both permission prompts:"
echo "  open \"$INSTALL_APP\" --args --request-permissions"
