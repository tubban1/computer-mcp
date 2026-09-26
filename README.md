# computer-mcp

A personal Computer MCP runtime for ChatGPT with filesystem, shell, Git, transaction, browser, macOS desktop, provider routing, dependency graphs, and persistent resumable tasks.

## v0.8 — Persistent Task / Resume

v0.8 adds durable task state so a long-running job can continue after a new ChatGPT conversation, tunnel restart, computer-mcp restart, or Mac restart.

New tools:

- `task_create`
- `task_list`
- `task_delete`
- `task_status`
- `task_run`
- `task_pause`
- `task_cancel`
- `task_resolve_step`

Tool count: **63**

## Persistent execution model

Create a dependency graph once, then run it in resumable waves:

```text
task_create
   ↓
task_run
   ↓
durable checkpoint after each wave
   ↓
pause / tunnel restart / server restart
   ↓
task_run
   ↓
resume only unfinished work
```

Each step stores its action, dependencies, state, attempt count, timestamps, duration, output needed by later `$ref` steps, and any error or recovery note.

## Encryption at rest

Persistent task files are encrypted locally with **AES-256-GCM**.

Default locations:

```text
~/.computer-mcp/tasks/
~/.computer-mcp/task.key
```

Permissions are tightened to task directory `700`, task files `600`, and encryption key `600`. The key is created automatically the first time a persistent task is saved.

Task arguments and outputs may contain sensitive local or web data. Encryption protects them at rest from accidental disclosure, but anyone with access to both your macOS account and task key can decrypt them. Back up `task.key` if you expect to migrate persistent tasks to another machine; losing the key makes saved tasks unreadable.

## Crash / restart recovery

Before a wave starts, selected steps are durably saved as `running`. After completion, results are saved again.

For interrupted parallel-safe/read-oriented work such as `fs.read`, `git.status`, `browser.snapshot`, or `desktop.frontmost_app`, v0.8 resets the step to `pending` after server restart so it may run again.

For interrupted state-changing work such as `fs.write`, `shell.exec`, `git.push`, `browser.click`, `desktop.type`, or `tx.rollback`, v0.8 changes the step to `needs_review` instead of automatically retrying it. This avoids accidental duplicate side effects.

Resolve such a step with `task_resolve_step`: use `retry` only after checking whether the prior attempt took effect, or use `mark_succeeded` after manual verification and optionally provide the result later `$ref` steps need.

## Time slicing

`task_run` supports `max_waves`, `time_budget_ms`, `max_concurrency`, and `fail_fast`. This lets ChatGPT intentionally yield and resume later rather than keeping one tool call open indefinitely.

Example:

```text
task_run(task_id, max_waves=2)
```

The task pauses after two durable waves, and another `task_run` resumes from the next unfinished step.

## Pause and cancel

`task_pause` requests a pause after the current wave. `task_cancel` requests cancellation after the current wave; cancelled tasks are terminal.

## Choosing the right orchestration layer

- Use `computer_batch` for simple ordered workflows.
- Use `computer_graph` for one-shot dependency-aware parallel execution.
- Use `task_create` + `task_run` when work must survive restarts.

## Provider stack

```text
ChatGPT
   ↓
Persistent Task Runtime     ← v0.8
   ↓
Computer Graph              ← v0.7
   ↓
Provider Router             ← v0.6
   ↓
Providers                   ← v0.5
   ├─ Filesystem
   ├─ Shell
   ├─ Git
   ├─ Transaction
   ├─ Browser
   └─ macOS Desktop
```

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

# Optional overrides:
# TASK_DIR=/Users/wahaha/.computer-mcp/tasks
# TASK_KEY_PATH=/Users/wahaha/.computer-mcp/task.key
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

After tool-definition changes, restart the tunnel client and refresh/reconnect the ChatGPT app so it rescans the catalog.
