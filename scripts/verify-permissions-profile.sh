#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP="$(mktemp -d -t computer-mcp-access.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
export AGENTOS_HOME="$HOME/.agentos"
export AGENTOS_RUNTIME_ENV="$AGENTOS_HOME/runtime.env"
export COMPUTER_MCP_ACCESS_NO_RESTART=true
mkdir -p "$HOME/Desktop" "$HOME/Documents" "$HOME/Downloads" "$HOME/Pictures" "$HOME/Movies" "$HOME/Music" "$HOME/Public"

cd "$REPO_ROOT"

zsh scripts/configure-production-access.sh standard >/dev/null
[[ -f "$AGENTOS_RUNTIME_ENV" ]] || { echo 'runtime env missing' >&2; exit 1; }
[[ "$(stat -f '%Lp' "$AGENTOS_RUNTIME_ENV")" == "600" ]] || { echo 'runtime env mode is not 0600' >&2; exit 1; }

STANDARD="$(grep '^ALLOWED_DIRECTORIES=' "$AGENTOS_RUNTIME_ENV" | cut -d= -f2-)"
[[ "$STANDARD" == *"$HOME/Desktop"* ]] || { echo 'standard profile missing Desktop' >&2; exit 1; }
[[ "$STANDARD" == *"$HOME/Documents"* ]] || { echo 'standard profile missing Documents' >&2; exit 1; }
[[ "$STANDARD" == *"$HOME/Downloads"* ]] || { echo 'standard profile missing Downloads' >&2; exit 1; }

grep -q '^ALLOW_WRITE=true$' "$AGENTOS_RUNTIME_ENV" || { echo 'standard profile missing write' >&2; exit 1; }
grep -q '^ALLOW_BROWSER=true$' "$AGENTOS_RUNTIME_ENV" || { echo 'standard profile missing browser' >&2; exit 1; }
grep -q '^ALLOW_GUI=true$' "$AGENTOS_RUNTIME_ENV" || { echo 'standard profile missing gui' >&2; exit 1; }
grep -q '^MACOS_HELPER_MODE=required$' "$AGENTOS_RUNTIME_ENV" || { echo 'helper mode not required' >&2; exit 1; }

zsh scripts/configure-production-access.sh full-home >/dev/null
FULL="$(grep '^ALLOWED_DIRECTORIES=' "$AGENTOS_RUNTIME_ENV" | cut -d= -f2-)"
[[ "$FULL" == "$HOME" ]] || { echo 'full-home profile did not select HOME' >&2; exit 1; }
grep -q '^ALLOW_DELETE=true$' "$AGENTOS_RUNTIME_ENV" || { echo 'full-home missing delete capability' >&2; exit 1; }
grep -q '^ALLOW_GIT_PUSH=true$' "$AGENTOS_RUNTIME_ENV" || { echo 'full-home missing git push capability' >&2; exit 1; }

BACKUPS=("$AGENTOS_RUNTIME_ENV".backup.*)
(( ${#BACKUPS[@]} >= 1 )) || { echo 'no runtime env backup created' >&2; exit 1; }

STATUS="$(zsh scripts/configure-production-access.sh status)"
[[ "$STATUS" == *"filesystem roots: $HOME"* ]] || { echo 'status does not report full-home root' >&2; exit 1; }
[[ "$STATUS" == *"helper:"* ]] || { echo 'status does not report helper state' >&2; exit 1; }

cat <<'EOF'
{
  "ok": true,
  "standardProfile": true,
  "fullHomeProfile": true,
  "runtimeEnvMode": "0600",
  "backupBeforeChange": true,
  "helperStatusIncluded": true,
  "restartIsolationForTests": true
}
EOF
