# AgentOS Runtime 1.x Compatibility Policy

Status: **Stable for 1.x**

AgentOS Runtime 1.0 freezes a small set of public Runtime contracts independently from the implementation details behind them.

## Stable contracts

The following contracts are version 1 and stable:

| Contract | Version | Compatibility |
| --- | ---: | --- |
| Primitive ABI | 1 | additive within 1.x |
| Skill ABI | 1 | additive within 1.x |
| Session Adapter Contract | 1 | additive within 1.x |
| Embedding Provider Contract | 1 | additive within 1.x |
| Workspace Lease Contract | 1 | additive within 1.x |

The Runtime exposes the same versions through `get_capabilities` and `/health`.

## SemVer rules

For Runtime 1.x:

- patch releases may fix bugs and tighten implementation correctness without removing stable contract surface
- minor releases may add new Primitives, operations, optional fields, Skills, providers, adapters, or capabilities
- stable IDs and operations are not removed, renamed, or repurposed in 1.x
- a required input cannot silently become more restrictive in a way that breaks valid 1.x callers
- additive optional fields are allowed; consumers should ignore unknown fields
- a breaking stable-contract change requires the next major Runtime version

Persistent state schema versions are governed separately by the state migration registry. A code rollback and a state rollback are not assumed to be equivalent.

## Primitive ABI

The frozen v1 manifest is machine-readable in:

```text
src/primitives/primitiveAbiV1Manifest.ts
```

The v1 frozen set contains the stable core/privileged Primitive IDs and their minimum operation sets.

1.x may add:

- a new Primitive
- a new operation to an existing Primitive
- optional input/output fields

1.x may not remove or repurpose a frozen ID or operation.

`admin.permission` remains an **experimental administrative extension** and is intentionally outside the frozen core/privileged manifest.

## Deprecated Primitive paths

Deprecated compatibility paths that exist at the 1.0 freeze remain accepted throughout 1.x. They may be removed in 2.0.

Current compatibility paths include:

- `fs.query` → `fs.stat`
- `ui.query(frontmost)` → `app.lifecycle(frontmost)`
- `ui.query(bounds)` → `app.lifecycle(bounds)`
- `app.lifecycle(helper_status)` → `admin.permission(status)`
- `app.lifecycle(request_permissions)` → `admin.permission(request)`
- `web.query(tabs)` → `web.session(tabs)`
- `web.act(use_tab)` → `web.session(use_tab)`
- `web.transfer(screenshot)` → `vision.capture(page)`
- `fs.stat(info)` → `fs.stat(get)`

Deprecated does not mean unsafe to call during 1.x; it means callers should migrate to the replacement before the next major version.

## Skill ABI

The Skill ABI freezes the metadata and execution-contract shape, not the complete Skill catalog.

Every 1.x Skill continues to declare:

```text
skillVersion
requiredPrimitiveAbi
requiredPrimitives
executionMode
memoryPolicy
contract
```

The execution contract continues to include at least:

```text
riskLevel
idempotent
sideEffects
requiresVerification
retryPolicy
resources
```

New Skills can be added during 1.x. An existing Skill must increment its own `skillVersion` when its workflow/input semantics materially change.

## Session Adapter Contract

Version 1 preserves:

- explicit binding identity
- conversation fingerprint validation
- capture/send receipts
- `pendingSend` crash uncertainty
- explicit `resolve_pending`
- explicit rebind instead of silent conversation switching

New adapters and additive operations are allowed in 1.x. The crash-safe send semantics are not optional implementation details.

## Embedding Provider Contract

Version 1 preserves the stored descriptor fields:

```text
providerId
model
dimensions
normalized
configFingerprint
```

A stored vector is queried against its own descriptor, not blindly against the currently selected provider.

New providers are additive. Remote data egress remains opt-in.

## Workspace Lease Contract

Version 1 preserves:

- durable Task/Process/Transaction ownership
- hierarchical workspace conflicts
- read-while-write-owned behavior
- explicit wait/handoff/takeover
- no silent normal-path lease stealing
- process pinning
- conservative session-only stale lease reclamation

MCP transport session IDs remain attribution identities, not durable workflow identities.

## Experimental surface

A contract or operation explicitly marked `experimental` is not covered by the same 1.x no-breaking-change guarantee until promoted to stable.

Experimental status must be visible in machine-readable metadata.

## Deprecation policy

For stable surface:

1. a replacement is identified before deprecation
2. deprecation is visible in machine-readable metadata and documentation
3. stable IDs are never repurposed
4. removal requires a major version
5. new callers should use the replacement immediately

## Conformance

Run:

```bash
npm run verify:isa
npm run verify:contracts
npm run verify:skill-abi
```

`verify:isa` compares the live Primitive catalog with the frozen v1 manifest.

`verify:contracts` verifies all five contract versions and the minimum stable semantics required for 1.x compatibility.
