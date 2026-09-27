# ADR-0009: Personal MCP Stability Boundary

Status: Accepted

## Context

`computer-mcp` is first a personal MCP server. A visible ChatGPT conversation can
outlive one Streamable HTTP transport session: reconnects, stream recovery,
client retries, and network faults can all rotate the MCP session ID.

Treating the transport session as the durable owner caused several concrete
failure modes:

- a reconnect could lose control of a process started moments earlier
- stale sessions accumulated in memory and looked permanently active
- session-only workspace ownership could block later work
- a Git transaction could block the same creator from making the edits it was
  meant to protect
- timeout/cancellation killed only the shell PID, allowing child processes to
  survive as orphans

These are reliability defects for daily personal use and take priority over new
capabilities.

## Decision

### 1. Transport session and logical owner are different identities

`sessionId` remains the concrete MCP transport identity for tracing and
cleanup. Long-lived ownership may additionally use a logical `ownerId`.

A trusted client/ingress can provide:

```text
x-computer-mcp-owner-id: <stable opaque client/conversation id>
```

The Runtime stores only a deterministic SHA-256-derived identifier, never the
raw header value.

There is deliberately no identity guessing from User-Agent, IP address, timing,
or other heuristics. If the explicit hint is absent, ownership falls back to the
MCP transport session.

### 2. Session lifecycle is bounded

Inactive transport sessions are marked disconnected after
`RUNTIME_SESSION_STALE_MS` (default 15 minutes) and forgotten after
`RUNTIME_SESSION_RETENTION_MS` (default 24 hours).

This keeps diagnostic/session state bounded even when a client disappears
without a clean transport close.

### 3. Processes belong to a logical owner

Managed process records keep both:

- `ownerSessionId` for transport-level audit
- `ownerIdentity` for stable control across reconnects

A different transport carrying the same explicit logical owner can control the
process without an unsafe takeover. A different owner is still rejected.

A live process whose non-Task owner has no active transport is marked
`orphanedAt`. It is not automatically killed. It can be explicitly claimed,
which avoids surprising destruction of intentional long-running work.

### 4. Process termination targets the process group

On POSIX systems, synchronous shell commands and managed background processes
run in their own process group. Timeout, cancellation, and `kill_process`
signal the group first and fall back to the direct PID when necessary.

This prevents the common case where killing a wrapper shell leaves
`node`, `npm`, `python`, `sleep`, or another child running.

### 5. MCP cancellation is execution cancellation

Each in-flight `tools/call` has an AbortController. It is aborted when:

- the HTTP request is aborted
- the response closes before completion
- the configured `MCP_REQUEST_TIMEOUT_MS` expires
- the client sends MCP `notifications/cancelled` for the JSON-RPC request

The signal is part of the execution context. Shell execution cooperatively
terminates its process group when cancellation is observed.

The default MCP request timeout is 10 minutes and can be configured between
5 seconds and 30 minutes.

### 6. Transaction ownership is re-entrant for its creator

A `transaction:<id>` lease protects a repository from competing owners, but it
does not block ordinary tools from the same logical owner. This makes
`begin_transaction -> edit/test -> complete_transaction` usable while
preserving exclusion against another session/owner.

Task and Process leases remain non-re-entrant across unrelated durable owners.

## Compatibility

Existing process and workspace records remain readable. Records created before
logical owner identity existed fall back to `ownerSessionId`.

On transport close, legacy session-only leases are still reclaimed. New
logical-owner session leases are reclaimed only when the logical owner has no
remaining active transport.

## Verification

The stability gate is:

```bash
npm run typecheck
npm run verify:stability-core
npm run verify:transport-stability
npm run verify:concurrency
npm run verify:fault-recovery
npm run verify:drain-handoff
npm run verify:production-runtime
git diff --check
```

`verify:transport-stability` is an end-to-end MCP test. It starts an isolated
HTTP/MCP server, rotates the real Streamable HTTP transport while preserving the
logical owner, cancels an in-flight shell command through the MCP client
AbortSignal, and verifies that the child process is gone.

## OWL Runtime boundary

This ADR does not move Runtime implementation into or out of `owl-runtime`.
The repositories are intentionally changed independently.

OWL Runtime now exposes candidate Public API v0.1 over loopback HTTP.
`computer-mcp` consumes it through a thin RuntimeClient adapter and must not
import OWL source files or duplicate a second copy of Runtime internals.

The first migration is intentionally metadata-only: capability manifest,
Primitive catalog, and Skill catalog can use the OWL HTTP backend when explicitly
enabled. Side-effecting Primitive/Skill execution, process control, file writes,
Tasks, Scheduler, Browser/Desktop, and high-risk external effects stay on the
legacy path until each capability passes its own consumer conformance and
dogfood gate.

The default remains `COMPUTER_MCP_RUNTIME_BACKEND=legacy`. During Computer MCP 1.x, production is locked to this standalone backend; `owl-http` is development/test dogfood only. Selecting `owl-http` outside production is explicit and has no silent fallback, because silently executing a failed Runtime request through another backend would make ownership and side effects ambiguous.

The first planned production Runtime-backed architecture boundary is Computer MCP 2.0, subject to full-system compatibility, soak, rollback, and personal dogfood evidence.
