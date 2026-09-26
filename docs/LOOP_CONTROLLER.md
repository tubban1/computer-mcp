# AgentOS Runtime Persistent Loop Controller

Status: **v0.9.7 foundation**

The Loop Controller is an orchestration layer above Persistent Tasks and the L1 Primitive ISA.

```text
L3 Planner
   |
L2 runtime.loop
   |
Persistent Loop State
   |
phase -> Primitive Task -> L1 ISA
   |          |
   +-- carry <-+
   |
next phase / wait-for-change / next cycle
```

It is deliberately not a new Primitive. L1 remains a small stateless capability boundary.

## Persistent state

Loop records are AES-256-GCM encrypted by default under:

```text
~/.computer-mcp/loops/
~/.computer-mcp/loop.key
```
The loop store is runtime-owned and is not added to the general filesystem allowlist.

Each loop persists current phase, cycle/transition counters, last output, per-phase outputs and hashes, active/last task id, next wake time, and stop/error state.

## Cross-phase carry

Step arguments may use `{{loop.lastOutput}}` or `{{loop.phase.<phaseId>}}`.

An exact placeholder preserves the underlying value. Embedded placeholders are stringified.

## Change detection

A phase can declare `output_ref` plus `wait_for_change: true`. If the output hash is unchanged from the previous successful execution of that phase, the controller stays on that phase and polls again later.

This is the basis for waiting on another agent, CI job, browser page, or UI response without replaying the next side effect prematurely.

## ChatGPT <-> another agent

```text
capture_chatgpt
  -> send_antigravity({{loop.lastOutput}})
  -> capture_antigravity [wait_for_change]
  -> send_chatgpt({{loop.lastOutput}})
  -> capture_chatgpt [wait_for_change]
  -> ...
```

The Loop Controller owns turn state and deduplication. App-specific adapters own the mechanics of reading and sending.
Adapters should verify the expected app/tab/session, input focus, generation completion, captured-turn identity, and restart-safe send deduplication.

## Lifecycle

The controller starts with computer-mcp and scans persisted loops. A loop can continue after the creating MCP request ends, the ChatGPT response ends, tunnel reconnects, or computer-mcp restarts.

If the Mac is powered off, execution pauses. Due loops are picked up after Runtime startup.

Each phase executes as an ordinary Persistent Primitive Task and inherits Working Memory, Staging, Episodic events, retry safety, and resource arbitration.

## Control

No new top-level MCP tool is added. Control remains through `skill_run("runtime.loop", ...)` with create/list/status/cancel/delete.

Creation supports 2-16 phases plus `poll_interval_ms`, `max_cycles`, `end_at`, `max_concurrency`, `max_waves`, and `time_budget_ms`.

## Safety boundary

The Loop Controller is classified as high risk because it can repeatedly cause external interactions. Loops should be bounded with max_cycles, end_at, explicit cancel, and/or phase-level completion/change conditions.

## Verification

`npm run verify:loop` creates a real two-phase loop, proves cross-phase carry, proves unchanged content does not advance, then verifies changed content and max-cycle termination.
