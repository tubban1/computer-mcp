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

### v1.0 readiness

AgentOS Runtime should not be called 1.0 until these are stable:

1. L1 Primitive ISA reviewed and frozen for 1.x compatibility.
2. Skill schema/versioning rules defined.
3. Action Contract semantics stable.
4. Resource arbitration supports leases/timeouts and deadlock-safe composition.
5. Durable Skills can compile into persistent task graphs.
6. Scheduler/event/wake model is defined.
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
