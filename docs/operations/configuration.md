# Configuration

AgentOS Runtime reads environment variables from the process environment. Production installation stores them in:

```text
~/.agentos/runtime.env
```

Development normally uses the project `.env` and defaults to port `8788`, keeping it separate from the production service on `8787`.

## Runtime mode

```text
AGENTOS_RUNTIME_MODE=development|production|test
AGENTOS_STATE_ROOT=/custom/path
```

Default state roots:

```text
development -> ~/.computer-mcp-dev
production  -> ~/.computer-mcp
test        -> ~/.computer-mcp-test
```

## Core capability gates

Common gates include filesystem scope, shell, browser, GUI, Git push, rollback, and delete permissions. Keep `ALLOWED_DIRECTORIES` as narrow as practical.

## Identity

```text
AGENTOS_NAME=AgentOS Runtime
AGENTOS_WAKE_NAME=Jarvis
AGENTOS_ALIASES=AgentOS,OWL,Jarvis
```

## Browser startup

Chrome startup can vary significantly by macOS/Chrome version and machine load. The Runtime waits up to 60 seconds for the local DevTools endpoint by default. Override with:

```text
BROWSER_STARTUP_TIMEOUT_MS=60000
BROWSER_CONNECT_TIMEOUT_MS=30000
```

The startup timeout covers waiting for Chrome's local DevTools endpoint. The connect timeout covers Playwright's subsequent CDP/WebSocket handshake. Both values are bounded between 5 and 120 seconds.

## Embeddings

See [Embedding Provider Contract](../specifications/embedding-provider.md). Remote endpoints require explicit remote opt-in.

## Production

Do not run production through `tsx watch`. Use [Production Runtime](production-runtime.md).
