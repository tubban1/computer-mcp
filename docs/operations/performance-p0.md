# Computer MCP 1.0 Performance P0

Status: **1.0 production blocker**

Computer MCP 1.0 must be fast enough for daily interactive use, but performance work must target the real bottleneck rather than bypassing architecture without evidence.

## What the current measurement says

On the development machine, direct filesystem operations and the routed filesystem path are both millisecond-scale.

Representative warm local measurements:

```text
read_file direct      P50 ≈ 1.0 ms
read_file routed      P50 ≈ 1.2 ms
list_directory direct P50 < 1 ms
list_directory routed P50 < 1 ms
```

The Router overhead is therefore not a credible explanation for multi-second ChatGPT tool latency.

If the ChatGPT-visible call takes several seconds while server-side MCP latency remains low, investigate:

```text
ChatGPT
  ↓
Remote MCP gateway / tunnel
  ↓
connection/session recovery
  ↓
computer-mcp HTTP transport
  ↓
local execution
  ↓
response path
```

Do not fork a second filesystem execution path merely to save sub-millisecond routing overhead.

## 1.0 performance requirements

### Warm local MCP latency

For ordinary read-only local calls over a warm loopback MCP session:

```text
P50 < 500 ms
P95 < 1500 ms
```

The gate covers at least:

- `read_file`
- `list_directory`
- `get_capabilities`

These intentionally include MCP SDK/HTTP/server handling rather than benchmarking only `fs.readFile()`.

### Session bootstrap

A healthy local Runtime must establish a fresh MCP session in:

```text
< 3 seconds
```

This is a local/server requirement. Remote gateway/session establishment is measured separately.

### Round-trip minimization

A known multi-step local workflow should prefer:

- `read_multiple_files` for multiple independent file reads;
- `computer_batch` for sequential provider actions;
- `computer_graph` for dependency graphs and bounded local concurrency;
- Persistent Tasks for durable workflows.

Ten locally composable steps must be executable as one MCP `computer_batch` request. Model ↔ MCP round trips must not grow linearly when local composition is already known.

## Server-side latency telemetry

`/health` exposes bounded in-memory MCP tool latency telemetry:

```text
performance.overall
performance.byTool[]
```

The timing scope begins when computer-mcp receives a `tools/call` HTTP request and ends when the local Streamable HTTP handler completes.

It explicitly **does not include** time before the request arrives from ChatGPT/gateway/network.

This distinction is required for diagnosis:

```text
ChatGPT-visible 8 s
server-side     15 ms

=> do not optimize filesystem/Router;
   investigate gateway/transport/recovery.
```

## Connection and recovery

Computer MCP 1.0 owns:

- bounded session lifecycle, including repeated reconnect churn without active-session accumulation;
- stale transport cleanup;
- cancellation propagation;
- cancellation-aware resource queues;
- interactive MCP resource waits bounded to 3 seconds by default (`MCP_RESOURCE_WAIT_TIMEOUT_MS`);
- orphan process cleanup/claim semantics;
- natural process-exit reconciliation and workspace-lease release;
- local health endpoint with active/pending resource diagnostics;
- server-side latency diagnostics.

For commands likely to run longer than an interactive MCP response window, prefer `start_process` + short output polls instead of one long synchronous `execute_command`. A client-stream timeout must not destroy or orphan the underlying durable job.

The external Secure MCP Tunnel / ChatGPT gateway owns part of reconnect timing that the local MCP server cannot retry after a request never reaches it.

For read-only/idempotent operations, MCP annotations remain accurate so a capable client/gateway can safely implement bounded retries.

A 30-second silent wait followed by a generic connection failure is not an acceptable product experience, but the fix must be placed at the layer that actually owns that wait.

## Fast Path policy

1.0 does **not** introduce a second generic execution architecture for ordinary filesystem calls. The Router, path guard, audit, and Action Contract remain authoritative.

The production finding was contention rather than CPU overhead: read-only filesystem actions were also acquiring a coarse workspace shared lock. A long-running workspace writer could therefore stall unrelated `read_file` / `list_directory` calls for seconds even though the underlying filesystem operation took milliseconds.

The 1.0 observation fast path is therefore a **lock-scope correction**:

- read-only filesystem actions keep exact-path `fs:<path>` resource protection;
- they do not acquire a repository-wide workspace lock;
- direct read/write of the same exact file still conflicts;
- unrelated workspace mutation no longer freezes observation;
- filesystem pathGuard, permission policy, Router contract, and audit remain unchanged.

This fixes the measured production bottleneck without creating duplicate execution semantics.

## Streaming

Incremental streaming/search results are valuable, but are **not a 1.0 blocker**.

Why:

- it expands transport/protocol state;
- cancellation/session recovery must remain correct during partial delivery;
- current 1.0 priority is production stability and latency diagnosis.

Target it for 1.x after the production baseline is stable.

Long-running operations in 1.0 must still be cancellable or use managed process/task surfaces where incremental output already exists.

## Verification

Run:

```bash
npm run verify:performance-p0
```

For an already running production service, use:

```bash
npm run benchmark:production
COMPUTER_MCP_BENCH_ROOT=/path/to/repo npm run benchmark:production
COMPUTER_MCP_BENCH_FILE=/path/to/file npm run benchmark:production
```

This operational benchmark helps distinguish a healthy local production MCP from remote gateway latency or workspace contention.

The verifier:

1. starts the compiled server on loopback;
2. creates one persistent MCP client/session;
3. warms the session;
4. samples ordinary read-only calls;
5. enforces P50/P95 targets;
6. verifies 10 local actions via one `computer_batch` MCP call;
7. checks server latency telemetry.

This is a release gate, not an informal benchmark.
