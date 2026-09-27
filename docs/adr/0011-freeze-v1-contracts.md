# ADR-0011: Freeze Small Public Contracts for Computer MCP 1.x

Status: Accepted

## Context

AgentOS Runtime reached production-grade execution, recovery, upgrade, state-migration, concurrency, and soak infrastructure during 0.9.x.

A 1.0 release needs a compatibility boundary, but freezing every Skill, provider implementation, UI selector, internal state field, or orchestration detail would prevent safe evolution.

The stable boundary should be small enough to preserve implementation freedom and strong enough that Skills, stored memory, adapters, and external planners do not break unexpectedly during 1.x.

## Decision

Freeze five public contracts at version 1:

1. Primitive ABI
2. Skill ABI
3. Session Adapter Contract
4. Embedding Provider Contract
5. Workspace Lease Contract

All five use additive 1.x compatibility.

The frozen Primitive ABI is represented by an independent machine-readable manifest. Stable core/privileged Primitive IDs and their existing operations cannot be removed, renamed, or repurposed during 1.x.

The complete Skill catalog is **not** frozen. The Skill ABI metadata/execution-contract shape is frozen; individual Skills retain independent `skillVersion` values.

`admin.permission` remains experimental and outside the frozen core/privileged Primitive set.

Deprecated Primitive aliases and operations present at the 1.0 freeze remain accepted through 1.x and may be removed in the next major version.

## Alternatives

- freeze the complete internal implementation
- freeze every current Skill ID and behavior
- rely only on documentation without a machine-readable baseline
- allow breaking changes in minor releases while keeping Runtime major version 1

## Consequences

- external callers get a clear 1.x compatibility promise
- Runtime internals can continue to improve
- new Primitives/operations/Skills/providers/adapters may be added additively
- compatibility regressions fail CI through conformance verification
- experimental administrative surface can evolve without pretending to be stable
- breaking stable-contract changes require the next major Runtime version

The compatibility policy is documented in `docs/specifications/compatibility-policy.md`.
