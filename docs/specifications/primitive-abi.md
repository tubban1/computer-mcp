# Primitive ABI v1

Status: **Contract v1 Stable for AgentOS Runtime 1.x**

The Primitive ABI is the compact L1 execution vocabulary used by Skills and durable task graphs. New high-level product features should normally be expressed as Skills or Runtime orchestration rather than continuously expanding L1.

## Compatibility

- ABI version is explicit.
- The frozen v1 core/privileged Primitive IDs are stable for 1.x and are enforced by the machine-readable v1 manifest.
- Deprecated aliases may remain accepted for compatibility while advertising replacements.
- Skills declare their required Primitive ABI and required Primitive IDs.
- Provider implementation details are not part of the Primitive ABI.

Current canonical families include perception, UI input, browser, filesystem, process, Git, transaction, provider diagnostics, and privileged/admin extensions.

Run:

```bash
npm run verify:isa
```

The verifier checks catalog invariants and the L2 Skill → L1 Primitive dependency boundary.

Historical design review: [../archive/l1-primitive-isa-review.md](../archive/l1-primitive-isa-review.md).


## Frozen v1 manifest

The normative minimum v1 surface is recorded in `src/primitives/primitiveAbiV1Manifest.ts`.

The manifest freezes the stable core/privileged Primitive IDs, their tiers, and the operations that must remain available throughout Runtime 1.x. New Primitive IDs and additive operations are allowed in 1.x; removal, rename, or repurposing of frozen surface requires a major Runtime version.

`admin.permission` remains an experimental administrative extension outside the frozen core/privileged set.

Deprecated aliases and operations present at the 1.0 freeze remain available through 1.x.

See [AgentOS Runtime 1.x Compatibility Policy](compatibility-policy.md).
