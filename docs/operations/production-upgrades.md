# Production Upgrades

AgentOS Runtime v0.9.13 adds a graceful production upgrade coordinator.

Use the normal installer for the first production installation:

```bash
npm run install:production
```

For an already installed Runtime that advertises `gracefulDrain`, use:

```bash
npm run upgrade:production
```

## Upgrade sequence

The coordinator uses the existing Runtime contracts instead of an out-of-band admin API.

```text
build immutable release
        ↓
start candidate on alternate localhost port
        ↓
candidate loads same production state
in DRAINING mode
(no Scheduler / Loop / Process Monitor)
        ↓
candidate health + compatibility check
        ↓
old Runtime: runtime.control drain
        ↓
old Runtime: runtime.control wait
        ↓
stop candidate
        ↓
switch ~/.agentos/current
        ↓
launchd kickstart
        ↓
new production health check
        ↓
success
```

If post-cutover health fails, the coordinator switches `current` back to the previous release, restarts launchd, and verifies rollback health.

## Candidate mode

Candidate mode is enabled internally with:

```text
AGENTOS_CANDIDATE_MODE=true
```

A candidate:

- runs on an alternate loopback port
- uses the same production state root
- starts in `DRAINING`
- does not start Persistent Scheduler
- does not start Persistent Loop Controller
- does not start Process Monitor
- exposes normal health/capability metadata
- does not receive production traffic

This lets a new release prove that it can boot against the current production state without competing with the active Runtime for background side effects.

Candidate mode is an upgrade implementation detail, not a normal user operating mode.

## Graceful drain

The coordinator talks to the old Runtime through the normal MCP transport:

```text
skill_run
  → runtime.control drain
  → runtime.control wait
```

There is no separate unauthenticated admin HTTP endpoint.

Drain prevents new side-effecting work and waits for already admitted mutation scopes and managed write processes to reach a safe boundary.

The default drain timeout is 120 seconds. Override it with:

```text
AGENTOS_UPGRADE_DRAIN_TIMEOUT_MS=120000
```

The Runtime itself bounds a single wait to ten minutes.

If drain fails or times out before the release switch, the coordinator calls `runtime.control resume` and leaves the current release unchanged.

## Release entry point

Every immutable release now owns a self-contained `run.sh` that resolves `dist/server.js` relative to the release directory itself.

This is important for rollback: a previous release must never accidentally execute code through the mutable `current` symlink.

## Failure behavior

Before cutover:

- candidate failure → old Runtime remains untouched
- drain rejection → old Runtime remains active
- drain timeout → old Runtime is resumed
- no symlink switch occurs

After cutover:

- launchd kickstart failure → rollback path
- new health failure → rollback path
- rollback health failure → launchd service is stopped rather than pretending production is healthy

The previous immutable release is retained.

## Availability

This protocol substantially reduces unsafe upgrade behavior, but it is not a zero-downtime traffic proxy. The launchd replacement creates a short MCP reconnection window.

Long-lived Task/process state survives because it is stored outside the process. Interactive transport sessions reconnect after replacement.

## State migrations

v0.9.13 candidate preflight verifies that the new code can load the current state safely. It does **not** perform incompatible persistent-state migration.

A versioned state schema and migration registry are a separate 1.0 hardening milestone.

## Verification

```bash
npm run verify:upgrade-runtime
```

The verifier starts two isolated Production-mode Runtime processes on alternate ports, sharing one test state root, then verifies:

- normal Runtime starts RUNNING with background controllers
- candidate starts DRAINING without background controllers
- candidate health uses the same state root
- MCP `runtime.control` status/drain/wait/resume
- upgrade/install shell syntax
