# Post-1.0 Directions

These are intentionally not release blockers for Computer MCP 1.0.

## Major-version architecture policy

- **1.x** — standalone production; compatibility/performance/reliability fixes only at the backend-architecture level.
- **2.0 candidate** — first deliberate production cutover to OWL Runtime, only after full compatibility, soak, rollback, and personal dogfood.
- **2.x** — Runtime-backed stabilization if 2.0 is promoted.
- **3.0+** — reserve for another deliberate architecture boundary if needed.

Per-capability Runtime integration may proceed during 1.x development, but it does not independently change production.

- event-driven adapters beyond polling
- additional desktop messaging adapters
- richer local neural embedding providers and reranking
- multi-machine Runtime federation
- remote worker pools
- richer scheduler triggers
- artifact retention/compaction policies
- semantic-memory consolidation and contradiction handling
- UI for Runtime tasks, leases, processes, memory, and audit
- organization/multi-user policy layers
- sandboxed execution backends
- pluggable secret managers
- distributed tracing and metrics exporters

New ideas should be evaluated against the 1.0 stability boundary before expanding the Primitive ABI.
