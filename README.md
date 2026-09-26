# computer-mcp

A personal Computer MCP runtime for ChatGPT with pluggable providers for filesystem, shell, Git, transactions, browser automation, and macOS desktop control.

## v0.7 — Dependency Graph + Parallel Orchestration

v0.7 adds a dependency-aware scheduler on top of the v0.6 Provider Router.

New tool:

- `computer_graph`

The existing `computer_action`, `computer_batch`, and all provider-specific tools remain available.

## Why a graph scheduler

v0.6 batches actions into one MCP call, but executes them sequentially:

```text
A → B → C → D
```

v0.7 can express dependencies and run independent, parallel-safe work concurrently:

```text
             ┌→ browser.snapshot ─────┐
browser.open ├→ browser.screenshot ───┼→ browser.close
             └→ desktop.frontmost_app ┘
```

The agent still sends one MCP call, while computer-mcp schedules the internal work.

## computer_graph

Example:

```json
{
  "steps": [
    {
      "id": "open",
      "action": "browser.open",
      "args": { "url": "https://example.com" }
    },
    {
      "id": "read",
      "action": "browser.snapshot",
      "depends_on": ["open"],
      "args": { "max_chars": 4000 }
    },
    {
      "id": "shot",
      "action": "browser.screenshot",
      "depends_on": ["open"],
      "args": { "path": "/allowed/path/example.png" }
    },
    {
      "id": "front",
      "action": "desktop.frontmost_app",
      "depends_on": ["open"]
    },
    {
      "id": "close",
      "action": "browser.close",
      "depends_on": ["read", "shot", "front"]
    }
  ],
  "max_concurrency": 4
}
```

After `open`, the `read`, `shot`, and `front` branches are eligible to run in the same wave.

## Automatic dependencies from references

A `$ref` automatically creates a dependency, so this:

```json
{
  "id": "status",
  "action": "tx.status",
  "args": {
    "transaction_id": { "$ref": "tx.id" }
  }
}
```

implicitly depends on the `tx` step. You do not have to repeat `depends_on: ["tx"]`.

## Safety-aware parallelism

Not every action is parallelized.

Examples marked parallel-safe include:

- filesystem reads/searches
- Git status/diff/log
- process output reads
- transaction status/list
- browser snapshot/screenshot/tab listing
- desktop frontmost-app and screenshot reads

State-changing actions are serialized, including:

- file writes/deletes
- shell execution
- Git add/commit/pull/push
- transaction begin/rollback/complete
- browser navigation/click/type/close
- desktop click/type/key/app activation

This favors deterministic behavior over maximum concurrency.

## Failure behavior

Each graph step ends in one of:

```text
succeeded
failed
skipped
```

A step whose dependency fails is skipped automatically.

With:

```text
fail_fast=true
```

the scheduler stops starting new work after the first failure.

With:

```text
fail_fast=false
```

independent branches can continue, while descendants of the failed branch are skipped.

## Concurrency

`max_concurrency` is bounded from 1 to 8 and defaults to 4.

Unsafe actions always execute alone. A wave contains multiple actions only when all selected actions are marked parallel-safe.

## Dry run

Use:

```text
computer_graph(..., dry_run=true)
```

to validate:

- step IDs
- routed action names
- explicit dependencies
- implicit `$ref` dependencies
- dependency cycles
- literal argument schemas
- parallel-safety classification

Arguments containing runtime `$ref` values are schema-validated after the references resolve during real execution.

## Execution metrics

The graph response includes:

- wall-clock duration
- summed step duration
- execution waves
- per-step duration
- parallel vs serial waves
- a `parallelEfficiency` ratio

A ratio above 1 means work overlapped in time.

## v0.6 routing layer

The compact routing tools remain:

- `router_catalog`
- `computer_action`
- `computer_batch`

Use `computer_batch` for simple ordered workflows and `computer_graph` when branches can run independently.

## Providers

Built-in providers:

- `filesystem`
- `shell`
- `git`
- `transaction`
- `browser`
- `desktop`

Use `provider_status` to inspect provider availability.

## Browser provider

The browser provider uses `playwright-core` with an existing Chromium-based browser. On Apple Silicon Macs, it detects Rosetta and launches Chrome natively as arm64.

Enable:

```env
ALLOW_BROWSER=true
BROWSER_HEADLESS=false
```

Web page content is untrusted input. Browser interactions remain subject to the user's intent and permission boundaries.

## Desktop provider

The current desktop provider targets macOS with native `osascript` and `screencapture`.

Enable:

```env
ALLOW_GUI=true
```

macOS may require Accessibility and Screen Recording permissions.

## Tool count

v0.7 exposes **55 MCP tools**, all with MCP annotations.

## Example configuration

```env
PORT=8787
ALLOWED_DIRECTORIES=/Users/wahaha/Documents/Me/Project/cursor

ALLOW_WRITE=true
ALLOW_DELETE=true
ALLOW_SHELL=true
ALLOW_GIT_PUSH=true
ALLOW_ROLLBACK=true

ALLOW_BROWSER=true
ALLOW_GUI=true
BROWSER_HEADLESS=false

AUDIT_LOG_ENABLED=true
```

## Run

```bash
npm ci
npm run dev
```

Health:

```bash
curl http://127.0.0.1:8787/health
```

MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

After changing tool definitions, restart the local server and tunnel client, then refresh/reconnect the ChatGPT app so it rescans the tool catalog.

## Roadmap

The provider/router/graph boundary is intended to support:

- workflow templates
- persistent task state and resumability
- per-provider resource locks
- SSH and Docker providers
- Windows/Linux desktop providers
- remote VM providers
- app-specific providers
