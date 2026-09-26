# AgentOS Runtime Architecture

AgentOS Runtime is the post-v0.8 evolution of `computer-mcp`: a stable execution runtime beneath an external planner such as ChatGPT.

The runtime does **not** embed a second general-purpose LLM planner. ChatGPT remains L3.

## Layer model

```text
L3  Planner
    ChatGPT
      ↓
L2  Skills
    reusable workflows + state logic + governance metadata
      ↓
L1  Primitive ISA
    small, stable, orthogonal capability surface
      ↓
L0.5 Actions
    provider-specific routed operations with contracts
      ↓
L0  Providers / Drivers
    macOS Helper, browser/CDP, filesystem, shell, Git, transactions
      ↓
Environment
    macOS apps, web apps, files, repositories, processes, services
```

## Current mapping

### L3 — Planner

- ChatGPT
- goal decomposition
- capability selection
- novel composition
- user interaction

### L2 — Skills

Examples:

- `wechat.read`
- `wechat.copy_at`
- `wechat.read_points`
- `wechat.send`
- `xhs.publish`
- `email.compose`
- `media.transcode`

Definition:

```text
Skill = Primitive Graph + State Logic + Governance Metadata
```

Skills may change and grow frequently. Adding a Skill should not require changing the L1 ISA.

### L1 — Primitive ISA

Current Primitive families:

- `provider.status`
- `vision.capture`
- `ui.query`
- `pointer.click`
- `keyboard.type`
- `keyboard.press`
- `clipboard`
- `app.lifecycle`
- `web.open`
- `web.query`
- `web.act`
- `web.transfer`
- `web.session`
- `fs.read`
- `fs.write`
- `fs.list`
- `fs.stat`
- `fs.manage`
- `fs.search`
- `process.manage`
- `git.query`
- `git.mutate`
- `tx.manage`

Non-core extensions:

- `sys.exec` — privileged escape hatch; use typed Primitives/Skills when available.
- `admin.permission` — experimental administrative extension for native Helper permission diagnostics and prompts.

Compatibility alias during v0.9:

- `fs.query` → `fs.stat` (deprecated)

The L1 ISA should be:

- small
- stable
- orthogonal
- composable
- provider-independent where practical
- explicit about side effects
- versionable without forcing Skill rewrites

### L0.5 — Actions

Examples:

- `desktop.ui_tree`
- `desktop.click`
- `desktop.clipboard_copy_selection`
- `browser.click`
- `browser.upload`
- `shell.exec`
- `git.push`

Every action has an Action Contract:

```text
riskLevel
idempotent
sideEffects
retryPolicy
requiresVerification
parallelSafe
resources
```

Actions are implementation-facing and may evolve faster than the Primitive ISA.

### L0 — Providers / Drivers

Current providers:

- Filesystem
- Shell / managed processes
- Git
- Transaction
- Browser / Chrome CDP
- macOS Desktop
- Computer MCP Helper.app

Providers translate Actions into real platform behavior.

## Control plane

The stable model-facing control surface should converge on:

```text
capability_manifest

skill_catalog
skill_run

primitive_catalog
primitive_call

computer_graph

task_create
task_run
task_status
task_pause
task_cancel
task_resolve_step
task_delete
```

Legacy direct tools can remain temporarily for compatibility/debugging, but new capability growth should happen behind Skills, Primitives, Actions, and Providers.

## Version boundary

### v0.8.0

Stable pre-AgentOS release.

Characteristics:

- direct MCP-tool architecture
- persistent encrypted tasks
- graph execution
- browser + desktop providers
- 63 annotated tools
- simpler mental model
- preserved as a public GitHub Release

### v0.9.x

AgentOS Runtime transition.

Introduces:

- Primitive ISA
- Skill Runtime
- Capability Manifest
- Action Contracts
- Resource Arbiter
- native macOS Helper
- richer perception channels
- visual + clipboard WeChat perception

v0.9.4 tightens the architecture boundary:

- Primitive ABI version is explicit (`abiVersion=1`).
- Primitive catalog exposes stability/tier/deprecation metadata.
- `fs.stat` becomes canonical while `fs.query` remains a deprecated alias.
- duplicate transitional ops remain accepted but advertise replacements.
- `sys.exec` is classified as privileged.
- built-in Skills execute through the L1 Primitive ISA rather than directly invoking L0.5 Actions.
- `npm run verify:isa` checks the L2→L1 dependency boundary and catalog invariants.


v0.9.5 adds the durable-memory foundation:

- persistent tasks can be represented internally as Primitive graphs
- Task Working Memory persists step outputs and $ref state
- task-local Staging preserves intermediate file artifacts with hashes and provenance
- downstream Primitive steps can consume staged copies through $ref
- task event history forms task-local Episodic Memory
- Skill metadata declares version, Primitive ABI requirements, execution mode, and memory policy
- Semantic Memory uses explicit gated promotion rather than implicit auto-learning; v0.9.9 adds unified recall across global M2 and M3.

Memory architecture: MEMORY_AND_STAGING.md

Skill ABI: SKILL_ABI.md

v0.9.6 adds the persistent wake/scheduler foundation:

- schedules are encrypted durable Runtime state, separate from the L1 ISA
- `runtime.schedule` creates once, interval, or daily wake plans through the existing `skill_run` surface
- each occurrence creates/resumes a Persistent Primitive Task
- yielded tasks resume on a later wake instead of requiring one multi-hour MCP request
- result-based `stop_when`, `max_runs`, and `end_at` bound monitoring loops
- due schedules are picked up again after Runtime restart
- no new top-level MCP tool or schema refresh is required

Scheduler architecture: SCHEDULER_AND_WAKE.md

### v1.0 readiness

AgentOS Runtime should not be called 1.0 until these are stable:

1. L1 Primitive ISA reviewed and frozen for 1.x compatibility.
2. Skill schema/versioning rules defined.
3. Action Contract semantics stable.
4. Resource arbitration supports leases/timeouts and deadlock-safe composition.
5. Durable Skills can compile into persistent task graphs.
6. Persistent scheduler/wake semantics are stable; event triggers and stateful Loop Controller semantics are defined.
7. Capability discovery is dynamic and does not require MCP schema refresh for ordinary new Skills.
8. Provider diagnostics and permission reporting are standardized.
9. End-to-end conformance tests exist for each Primitive family.
10. Security boundaries and side-effect verification are documented.

## Naming

Public product/runtime name:

```text
AgentOS Runtime
```

Compatibility identifiers remain unchanged for now:

```text
GitHub repository: tubban1/computer-mcp
npm package:       computer-mcp
MCP server name:   computer-mcp
```

This avoids breaking existing tunnels, plugin connections, scripts, documentation links, and local installations while the architecture stabilizes.

A repository/package rename can be evaluated at the 1.0 boundary.


### v0.9.8 — Semantic Promotion Pipeline

v0.9.8 closes the first executable M2 Episodic → M3 Semantic path.

- completed task episodes become promotion evidence
- Quality Gate rejects incomplete or unresolved task evidence
- Privacy / Secret Gate blocks obvious credential-bearing candidates
- promotion requires an explicit confirm=true operation
- M3 records are AES-256-GCM encrypted in runtime-owned storage
- every record keeps source task/evidence hashes and gate receipts
- the source task receives a semantic_promoted episodic event
- semantic memory supports status/search/list/get/delete through runtime.memory

No new L1 Primitive or top-level MCP tool is required.

Architecture: SEMANTIC_MEMORY.md


### v0.9.9 — Global Recall, Durable Agent Sessions & Runtime Identity

v0.9.9 adds three Runtime surfaces without adding new top-level MCP tools:

- `runtime.recall` — unified global M2 Episodic + M3 Semantic retrieval
- `runtime.session` — durable ChatGPT/Antigravity/generic browser session bindings
- `runtime.identity` — product identity, wake name and aliases

Terminal Persistent Tasks are automatically indexed into encrypted global M2 memory, including failed/blocked/cancelled tasks so failure experience remains recallable without being promoted as semantic truth.

Recall supports lexical, local-vector and hybrid modes. The current 256-dimensional `feature-hash-v1` vectorizer is deterministic and zero-dependency, not a neural embedding model.

Session adapters bind exact conversation URLs/fingerprints, capture the last assistant message, persist turn receipts, and freeze automatic replay if a send is interrupted in an uncertain state.

Persistent Loop phases can now execute either Primitive graphs or Session Adapter operations. This closes the Runtime-level ChatGPT ↔ Antigravity relay path.

The managed browser uses a stable Runtime-owned profile across restarts. `web.session` is the canonical tab/session Primitive family with `tabs`, `use_tab`, `new_tab`, and `close`.

The formal name remains AgentOS Runtime. A configurable wake name such as `Jarvis` is exposed through MCP metadata and capabilities for chats where computer-mcp is connected.
