#!/bin/zsh
set -euo pipefail

AGENTOS_HOME="${AGENTOS_HOME:-$HOME/.agentos}"
ENV_FILE="${AGENTOS_RUNTIME_ENV:-$AGENTOS_HOME/runtime.env}"
LABEL="com.agentos.runtime"

PORT_VALUE="$(
  /bin/zsh -c '
    set -a
    [[ -f "$1" ]] && source "$1"
    set +a
    print -r -- "${PORT:-8787}"
  ' _ "$ENV_FILE"
)"

echo "AgentOS production status"
echo "  current: $(readlink "$AGENTOS_HOME/current" 2>/dev/null || echo "(not installed)")"
echo "  env:     $ENV_FILE"
echo "  launchd:"
launchctl print "gui/$UID/$LABEL" 2>/dev/null | sed -n '1,32p' || echo "    not loaded"
echo "  health:"
HEALTH_URL="http://127.0.0.1:$PORT_VALUE/health"
HEALTH_TMP="$(mktemp -t computer-mcp-health.XXXXXX)"
trap 'rm -f "$HEALTH_TMP"' EXIT
if HEALTH_TIMING="$(/usr/bin/curl -fsS --connect-timeout 1 --max-time 3 -o "$HEALTH_TMP" -w 'connect=%{time_connect}s total=%{time_total}s' "$HEALTH_URL" 2>/dev/null)"; then
  cat "$HEALTH_TMP"
  echo
  echo "  health latency: $HEALTH_TIMING"
else
  echo "    unavailable (failed within 3s local health budget)"
fi
echo
