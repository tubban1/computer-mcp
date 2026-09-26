# AgentOS Runtime Global Episodic Recall

Status: **v0.9.9 foundation**

v0.9.9 adds a global encrypted M2 index across terminal Persistent Tasks and a unified recall path across M2 Episodic and M3 Semantic Memory.

```text
Persistent Tasks
  completed / failed / blocked / cancelled
                 |
                 v
       Global Episodic Index (M2)
                 |
        hybrid / lexical / vector
                 |
                 +------------------+
                                    |
M3 Semantic Memory ----------------+
                                    |
                                    v
                           runtime.recall
```

## Global M2 index

Terminal tasks are indexed automatically. Unlike M3 promotion, the M2 index intentionally retains failed, blocked and cancelled experiences because an Agent must be able to recall what went wrong without treating the failure as learned truth.

Default encrypted storage:

```text
~/.computer-mcp/episodes/
~/.computer-mcp/episode.key
```

Each episode retains task identity, terminal status, step summaries, errors/recovery notes, event types/messages, timestamps, a content digest and a retrieval vector.

Existing task history can be backfilled with:

```text
skill_run("runtime.recall", { op: "rebuild" })
```

## Unified recall

`runtime.recall` supports:

- scope: `episodic | semantic | both`
- mode: `hybrid | lexical | vector`
- terminal status filters for M2
- kind/tag filters for M3
- bounded result limits

This lets the Planner ask both “what happened in similar tasks?” and “what reusable knowledge did we promote from those tasks?” through one interface.

## Local vector retrieval

v0.9.9 uses `feature-hash-v1`, a deterministic local 256-dimensional feature-hash vectorizer with word tokens plus character trigrams. It has zero cloud dependency and works with CJK text.

It is **not** a neural embedding model. The retrieval contract deliberately separates vector generation from storage/search so a future local or hosted neural embedding provider can replace it without changing the L1 Primitive ISA, M2 record provenance, or `runtime.recall` API.

Hybrid ranking currently combines lexical and vector scores.

## Verification

`npm run verify:recall` creates both a successful and a failed task, proves both enter the global M2 index, promotes reusable knowledge from the successful task to M3, and verifies unified hybrid/vector recall across both memory layers.
