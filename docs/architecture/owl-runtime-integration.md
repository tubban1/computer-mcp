# OWL Runtime Integration and Parallel Development

This repo is the **personal MCP Server / compatibility product**. Its primary goal is reliable daily use. It is no longer the source of truth for generic Runtime behavior.

## What this Session owns

Own here:
- MCP protocol/server behavior;
- MCP session/transport stability;
- ChatGPT/Cursor-facing tool schemas and compatibility aliases;
- personal-use configuration;
- RuntimeClient adapter;
- compatibility tests between legacy behavior and OWL Runtime;
- graceful migration/fallback controls during the split.

Do NOT implement here:
- a second scheduler;
- a second persistent task engine;
- a second process ownership model;
- a second Observation/Verifier system;
- a second approval/policy engine;
- a second generic provider/runtime kernel.

Those belong to `owl-runtime`.

## You do NOT need to wait for OWL Runtime 1.0

Proceed now on:
1. stable logical session identity independent of individual MCP transport reconnects;
2. process ownership/reclaim based on durable logical session/task identity;
3. transport timeout + cancellation propagation;
4. orphan child cleanup/reconciliation;
5. workspace lease ergonomics, especially read-only long processes;
6. a `RuntimeClient` abstraction;
7. a temporary legacy backend so daily personal use remains stable;
8. compatibility/conformance tests.

## Runtime migration strategy

Use a strangler pattern:

```text
MCP tools
   ↓
RuntimeClient
   ├── Legacy backend       ← temporary safety path
   └── OWL Runtime backend  ← migrate capability by capability
```

Do NOT directly import `owl-runtime/src/**`.

A migrated capability should use a public, versioned OWL Runtime contract.

## What must wait

Do not switch a capability to OWL Runtime until that specific capability has:
- a RuntimeClient/public contract;
- Runtime conformance tests;
- restart/recovery semantics where relevant;
- cancellation/ownership semantics where relevant;
- legacy-vs-runtime compatibility evidence.

This is per capability. Do not wait for the whole Runtime to be 1.0.

## Migration priority

Recommended order:
1. capability/status/health;
2. read-only file operations;
3. process observe/wait;
4. file writes with postcondition verification;
5. task lifecycle;
6. scheduler;
7. browser;
8. desktop;
9. high-risk external side effects.

Personal-use stability wins over architectural purity.

## Current P0 dogfood bugs

Treat these as immediate priorities:
- transport/session id changes across consecutive calls;
- process started by one call cannot be controlled after reconnect/session drift;
- long process default write lease locks the repo unnecessarily;
- MCP/transport timeout can leave `tsc` or other child processes alive;
- orphan claim rejects some real reconnect cases;
- cancellation must reach the OS process, not only the MCP request.

## Contract requests to OWL Runtime

If a needed generic capability is absent, do not implement it here. Record:

```text
CONTRACT REQUEST
Consumer: computer-mcp
Capability:
Why:
Blocking: Yes | No
Legacy fallback:
Required semantics:
Acceptance tests:
```

Then continue non-blocking work using the legacy backend where safe.

## Definition of successful decoupling

This repo is decoupled when:
- Runtime behaviors are reached through RuntimeClient/public API;
- MCP schemas can evolve independently of Runtime internals;
- computer-mcp can update without modifying Runtime source;
- OWL Runtime can run/test without MCP;
- deleting a duplicated Runtime implementation from computer-mcp does not remove the capability because OWL Runtime owns it.


## Current fast-path available now

OWL Runtime now exposes a candidate `RuntimeClient v0.1` **and a real local cross-process HTTP transport**.

Preferred decoupled path:

```text
computer-mcp
   ↓
OwlRuntimeClient
   ↓ HTTP loopback
HttpRuntimeClient
   ↓
OWL Runtime daemon
```

Public endpoints:
- `GET /runtime/v0.1/info`
- `POST /runtime/v0.1/rpc`

Every RPC call must send a **stable logical** `x-owl-session-id`. Do not reuse the ephemeral MCP transport/session id as the durable owner identity.

OWL Runtime's conformance test already proves:
- logical session identity survives separate HTTP requests;
- the same logical session can continue controlling its process;
- another session is rejected with structured `PROCESS_OWNED`;
- a process-scoped control capability can safely authorize control after reconnect/session drift;
- the raw process control token is never persisted and is redacted from audit;
- File Observation/Verification receipts survive the HTTP boundary.

For package/type work, import only the package root/public export; do **not** import `owl-runtime/src/**`.

Recommended computer-mcp sequence:
1. define `RuntimeClient` / `LegacyRuntimeClient` / `OwlRuntimeClient`;
2. make `OwlRuntimeClient` use OWL Runtime's local HTTP contract, not Runtime internals;
3. keep `LegacyRuntimeClient` as the default personal-use safety backend initially;
4. migrate capability/status/health and read-only filesystem first;
5. migrate process observe/wait after your MCP logical-session mapping is stable;
6. migrate writes/tasks/scheduler incrementally with conformance tests;
7. remove each legacy implementation only after real dogfood.

### Runtime cancellation handoff is available now

OWL Runtime now provides:
- request-scoped cancellation context;
- explicit `POST /runtime/v0.1/cancel`;
- `HttpRuntimeClient.invoke(..., { signal, requestId })`;
- `HttpRuntimeClient.cancelRequest(requestId)`;
- same-session cancel ownership;
- `REQUEST_OWNED` protection against another session cancelling your request;
- shell process-group termination, verified against nested parent/child processes.

So **do not reimplement cancellation in computer-mcp**.

What this repo still owns is the adapter wiring:
1. capture MCP/ChatGPT cancellation or transport-abort signal;
2. preserve the Runtime request id;
3. pass the signal into `HttpRuntimeClient.invoke` or call `cancelRequest`;
4. verify no orphan process remains after an MCP-side timeout.

### Still WAIT selectively

Keep browser/desktop and high-risk side effects on legacy/selective paths until their Observation/Verifier, cancellation, and approval semantics pass consumer compatibility tests.

Do not make all MCP tools depend on OWL Runtime at once.


## Runtime daemon status

OWL Runtime production is now a standalone daemon. `npm start` in `owl-runtime` no longer boots the transitional MCP adapter.

Use the Runtime public boundary:

```text
computer-mcp
   ↓ OwlRuntimeClient
http://127.0.0.1:<runtime-port>/runtime/v0.1/*
   ↓
OWL Runtime daemon
```

Do **not** point the new Runtime backend at `/mcp`.

The transitional OWL in-repo MCP adapter is now an explicit compatibility entrypoint only. Production install/upgrade/drain/state migration are verified without `/mcp`.

This means computer-mcp can proceed with real decoupling now; it does not need to wait for Runtime 1.0. Keep the legacy backend only as a per-capability safety path during migration.
