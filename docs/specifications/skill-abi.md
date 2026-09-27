# AgentOS Runtime Skill ABI

Status: **Contract v1 Stable for AgentOS Runtime 1.x**

A Skill is an L2 runtime unit above the L1 Primitive ISA.

    Skill = Primitive Graph
          + State Logic
          + Governance Metadata
          + Memory Policy

## Required metadata

Every built-in Skill declares:

    skillVersion
    requiredPrimitiveAbi
    requiredPrimitives
    executionMode
    memoryPolicy

### skillVersion

Version of the Skill contract and workflow semantics.

Skill versions are independent from the AgentOS Runtime version.

### requiredPrimitiveAbi

Minimum Primitive ABI version required by the Skill.

The runtime refuses execution when a Skill requires a newer Primitive ABI than the current runtime supports.

### requiredPrimitives

Canonical Primitive families the Skill depends on.

The catalog validates these dependencies before execution.

### executionMode

Current values:

    inline
    durable

inline means the Skill executes in the current request.

durable means the Skill compiles work into a Persistent Primitive Task that can be paused, resumed, recovered after restart, and supplied with task memory/staging.

### memoryPolicy

Current policy fields:

    working
    staging
    episodic
    semanticPromotion

The v1 defaults are intentionally conservative:

    working            = runtime
    staging            = available_when_durable
    episodic           = task_events_when_durable
    semanticPromotion  = manual

Semantic promotion is never implicit.

## Complex Skill compilation

The Runtime provides the generic durable Skill:

    runtime.compile_task

Input is a Primitive graph:

    {
      "label": "research to publish",
      "steps": [
        {
          "id": "research",
          "primitive": "web.query",
          "op": "snapshot",
          "args": {}
        },
        {
          "id": "write",
          "primitive": "fs.write",
          "op": "write",
          "depends_on": ["research"],
          "args": {
            "path": "...",
            "content": {
              "$ref": "research"
            }
          }
        }
      ]
    }

The compiler creates a Persistent Primitive Task. Execution remains under the existing task runtime.

This means a future app-specific complex Skill can choose between:

    inline Skill
        -> execute Primitive graph now

or

    durable Skill
        -> compile Primitive graph
        -> Persistent Task
        -> pause/resume/recovery/staging

No new top-level MCP tool is required.

## 1.x compatibility rules

With Skill ABI v1 stable:

- New Skill IDs may be added in 1.x; an existing Skill ID is not silently repurposed.
- skillVersion must change when workflow semantics or input contracts change materially.
- requiredPrimitiveAbi must never exceed the runtime ABI silently.
- requiredPrimitives must refer to canonical Primitive IDs, not deprecated aliases.
- L2 Skills should not call L0.5 Actions directly.
- durable Skills should compile to Primitive steps, not provider-specific Actions.
- risk, sideEffects, retryPolicy, and resources are part of the Skill execution contract and must be declared before execution.
- memory promotion must remain explicit and auditable.

These rules are frozen independently from the individual Skill catalog. See [Compatibility Policy](compatibility-policy.md).
