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

For production, prefer the versioned access-profile commands over repeatedly editing the environment by hand:

```text
npm run permissions:status
npm run permissions:standard
npm run permissions:full-home
```

Fresh installs without a project `.env` receive the `standard` filesystem roots and a usable local-worker baseline. Delete and Git push remain disabled in that fresh-install baseline. The explicit `full-home` profile enables the complete personal-worker capability set and grants the current home directory as the filesystem root.

## Identity

```text
AGENTOS_NAME=AgentOS Runtime
AGENTOS_WAKE_NAME=Jarvis
AGENTOS_ALIASES=AgentOS,OWL,Jarvis
```

## Resource wait budgets

Interactive MCP calls fail bounded local resource contention rather than silently waiting until the outer transport fails:

```text
MCP_RESOURCE_WAIT_TIMEOUT_MS=3000
BACKGROUND_RESOURCE_WAIT_TIMEOUT_MS=60000
```

MCP waits are bounded to at least 250 ms; background waits to at least 1 second; both are capped at 10 minutes. Request cancellation interrupts the Arbiter wait immediately.

These budgets apply after the request reaches computer-mcp. They cannot control time spent before arrival in an external gateway/tunnel.

## Tunnel client credentials

Use the one-time setup flow instead of typing Tunnel ID and API key on every start:

```text
npm run tunnel:setup
npm run tunnel:status
npm run tunnel:run
```

The API key is stored outside Git in a mode `0600` secret file and passed to `tunnel-client-runtime` by `file:` reference, not as a command-line credential. See [Tunnel client setup](tunnel-client.md).

## Cloud account and device authorization

Computer MCP can be paired with an OWL cloud account through a one-time device-code flow.

```text
AGENTOS_CLOUD_URL=https://psnxgftfywpzriseetjg.supabase.co
AGENTOS_CLOUD_APP_URL=http://localhost:3000
AGENTOS_CLOUD_AUTH_REQUIRED=false
AGENTOS_CLOUD_SYNC=false
AGENTOS_CLOUD_SYNC_REQUIRED=false
AGENTOS_CLOUD_AUTH_CACHE_MS=30000
```

Use:

```bash
npm run cloud:login
npm run cloud:status
npm run cloud:heartbeat
npm run cloud:logout
```

`AGENTOS_CLOUD_AUTH_REQUIRED=true` makes an active account-owned device grant a prerequisite for MCP tool calls. This is an additional authorization boundary only: local `ALLOW_*` capability gates, Runtime approval policy, and macOS TCC permissions still apply.

`AGENTOS_CLOUD_SYNC=true` mirrors durable Session Endpoint communication into the account cloud store. With `AGENTOS_CLOUD_SYNC_REQUIRED=true`, communication completion fails closed if its cloud record cannot be committed.

See [Cloud account and device authorization](cloud-account-and-device-auth.md).

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

Do not run production through `tsx watch`. Use [Production Runtime](production-runtime.md) and the [Production promotion policy](production-promotion.md).

Computer MCP 1.x production is backend-architecture locked:

```text
COMPUTER_MCP_RUNTIME_BACKEND=legacy
```

`owl-http` is development/test dogfood only during 1.x. Production fails closed rather than silently changing its backend architecture.

For an existing v0.9.12+ production installation, use the [Production upgrade protocol](production-upgrades.md). The coordinator defaults to a 120-second graceful drain timeout; override it with `AGENTOS_UPGRADE_DRAIN_TIMEOUT_MS` when long-running write processes legitimately need more time. v0.9.14+ also validates the [Runtime Durable State Schema](../specifications/state-schema.md) before cutover.


## Workspace session-lease recovery

MCP transport sessions are not durable workflow identities. Session-only workspace leases can be reclaimed when the owning transport disconnects and, as a conservative fallback, after an apparently active session remains idle.

Defaults:

```text
WORKSPACE_SESSION_RECLAIM_GRACE_MS=5000
WORKSPACE_SESSION_IDLE_RECLAIM_MS=900000
```

The idle fallback applies only to session-only leases with no durable Task owner and no pinned managed process. Task-, Process-, and Transaction-owned leases are not reclaimed merely because the MCP transport is idle.

For work that spans many tool calls, prefer durable Task/Process/Transaction ownership rather than increasing reliance on a raw session lease.
