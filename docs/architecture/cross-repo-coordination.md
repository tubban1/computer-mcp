# computer-mcp ↔ OWL Runtime Cross-Repo Coordination

Status: **normative for computer-mcp during the OWL split**.

`computer-mcp` is the personal MCP product and compatibility facade. `owl-runtime` is the source of truth for generic execution/runtime behavior.

## Dependency direction

```text
ChatGPT / Cursor / other MCP clients
              │
        computer-mcp
              │
        RuntimeClient
              │
       loopback HTTP
              │
         OWL Runtime
```

Rules:

- computer-mcp may depend on OWL Runtime **public/versioned contracts only**.
- computer-mcp must not import `owl-runtime/src/**`.
- OWL Runtime must not depend on computer-mcp product code.
- Generic Runtime behavior must not be copied into computer-mcp to unblock a migration.
- Personal daily-use reliability wins over architectural purity. A legacy path may remain until the replacement has dogfood evidence.

## Identity boundary

Keep these identities separate:

```text
MCP transport session   ephemeral connection
computer-mcp owner id   stable logical ChatGPT/client identity
OWL logical session     stable Runtime consumer identity
Runtime request id      one cancellable Runtime request
process capability      process-scoped reconnect/control authority
Task id                 durable workflow ownership
```

computer-mcp is responsible for mapping MCP traffic to a stable logical owner. When a trusted client provides `x-computer-mcp-owner-id`, computer-mcp hashes it and uses that stable logical owner across MCP reconnects.

When calling OWL Runtime, the logical owner becomes `x-owl-session-id`. The raw MCP transport session ID must not be used as the durable OWL owner when a stable logical owner is available.

## Current Runtime public boundary

OWL Runtime Public API v0.1 is a **candidate consumer contract**.

Current local daemon endpoints:

- `GET /runtime/v0.1/info`
- `POST /runtime/v0.1/rpc`
- `POST /runtime/v0.1/cancel`

Production calls may require `OWL_RUNTIME_API_TOKEN`.

computer-mcp consumes this through its own thin RuntimeClient adapter. The default backend remains `legacy` until a capability passes the consumer migration gate.

Configuration:

```text
COMPUTER_MCP_RUNTIME_BACKEND=legacy        # default / safest daily-use path
COMPUTER_MCP_RUNTIME_BACKEND=owl-http      # explicit OWL consumer path
OWL_RUNTIME_URL=http://127.0.0.1:8788
OWL_RUNTIME_API_TOKEN=...
OWL_RUNTIME_HTTP_TIMEOUT_MS=60000
```

There is **no silent fallback** from an explicitly selected OWL backend to legacy execution. Silent fallback would make ownership and side effects ambiguous.

## Per-capability migration gate

A capability moves through:

```text
LEGACY_ONLY
  ↓
PUBLIC_CONTRACT
  ↓
CONFORMANCE
  ↓
CONSUMER_COMPATIBILITY
  ↓
DOGFOOD
  ↓
OWL_DEFAULT
  ↓
LEGACY_REMOVED
```

Do not wait for all of OWL Runtime 1.0. Migrate independently per capability.

Required evidence before `OWL_DEFAULT`:

1. public/versioned Runtime contract;
2. Runtime conformance test;
3. ownership semantics where relevant;
4. cancellation semantics where relevant;
5. restart/recovery semantics where relevant;
6. computer-mcp compatibility test;
7. real personal-use dogfood without stability regression.

## Current coordination matrix

| Area | Source of truth | computer-mcp action now | Migration status |
|---|---|---|---|
| MCP transport/session lifecycle | computer-mcp | own and harden | **NOW** |
| logical MCP owner mapping | computer-mcp | own and harden | **NOW** |
| transport timeout → cancellation handoff | computer-mcp adapter | propagate request signal to Runtime | **NOW** |
| Runtime request cancellation | OWL Runtime | consume public cancellation semantics | **candidate / integrate** |
| shell process-group termination | OWL Runtime long-term; legacy temporarily | keep legacy fix until OWL migration proves equivalent | **dogfood both** |
| capability manifest | OWL Runtime | route through RuntimeClient | **first migration** |
| Primitive catalog | OWL Runtime | route through RuntimeClient | **first migration** |
| Skill catalog | OWL Runtime | route through RuntimeClient | **first migration** |
| read-only filesystem primitives | OWL Runtime | next consumer conformance target | **NEXT** |
| process observe/wait | OWL Runtime | keep legacy default until consumer multi-session evidence | **NEXT / gated** |
| process control/claim | OWL Runtime | do not switch heavy multi-session use yet | **WAIT selectively** |
| file writes | OWL Runtime Observation/Verifier | migrate only with postcondition compatibility evidence | **WAIT selectively** |
| Persistent Tasks | OWL Runtime | consumer adapter after current verification wiring settles | **WAIT selectively** |
| Scheduler | OWL Runtime | wait for required pause/resume semantics | **WAIT selectively** |
| Approval/Health | OWL Runtime | safe early Worker-facing integration; computer-mcp as needed | **candidate** |
| Browser/Desktop | OWL Runtime providers | retain legacy until Observation/Verifier + permission semantics settle | **WAIT** |
| high-risk external side effects | OWL Runtime policy/approval/verifier | no early migration | **WAIT** |

## What computer-mcp may implement

computer-mcp owns:

- MCP HTTP/transport behavior;
- MCP cancellation detection;
- logical owner mapping;
- ChatGPT/Cursor-facing tool schemas;
- compatibility aliases;
- RuntimeClient adapter;
- legacy-vs-OWL conformance tests;
- personal-use configuration and safe rollout;
- product-specific diagnostics.

computer-mcp must not create a second generic:

- scheduler;
- persistent Task engine;
- process manager/state machine;
- workspace ownership protocol;
- Observation/Verifier system;
- approval/policy engine;
- Runtime health model;
- generic provider kernel.

Temporary legacy implementations already present in computer-mcp are allowed only as a migration safety path. Do not extend them with new generic Runtime features.

## Contract Requests

When computer-mcp needs missing generic Runtime behavior, add a request under:

```text
docs/contracts/requests/
```

Template:

```text
CONTRACT REQUEST
Consumer: computer-mcp
Capability:
Why:
Blocking: Yes | No
Temporary path: legacy backend | disabled | compatibility alias
Required semantics:
Acceptance tests:
```

A Contract Request is not permission to duplicate Runtime behavior locally.

## Parallel-development rule

Three sessions can work in parallel:

```text
computer-mcp session → edits computer-mcp only
owl-runtime session  → edits owl-runtime only
owl-worker session   → edits owl-worker only
```

Cross-repo source edits require explicit coordination. Reading another repo's public docs/contracts is expected. Documentation may reference the other repo, but source-of-truth implementation stays with its owner.

## Integration cadence

Prefer small migrations:

1. OWL Runtime publishes/stabilizes one public contract.
2. computer-mcp adds/updates its RuntimeClient adapter.
3. consumer conformance test runs against the real daemon boundary.
4. dogfood the capability under explicit opt-in.
5. switch that capability to OWL by default only after stability evidence.
6. remove the corresponding legacy implementation later.

This is a strangler migration, not a big-bang rewrite.
