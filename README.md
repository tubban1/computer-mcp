# computer-mcp

A personal Computer MCP runtime for ChatGPT with pluggable providers for filesystem, shell, Git, transactions, browser automation, and macOS desktop control.

## v0.6 — Provider Router + Batch Orchestrator

v0.6 adds a compact routing layer on top of the existing provider tools so an agent does not have to choose among dozens of low-level MCP tools for every step.

New tools:

- `router_catalog`
- `computer_action`
- `computer_batch`

The existing provider-specific tools remain available for compatibility and precise control.

## Why the router exists

The provider layer in v0.5 made capabilities modular, but a multi-step task could still require many MCP round trips:

```text
browser_open
→ browser_snapshot
→ browser_screenshot
→ desktop_frontmost_app
```

With v0.6 the same work can be sent in one call:

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
      "args": { "max_chars": 4000 }
    },
    {
      "id": "shot",
      "action": "browser.screenshot",
      "args": { "path": "/allowed/path/example.png" }
    },
    {
      "id": "front",
      "action": "desktop.frontmost_app"
    }
  ]
}
```

This reduces model/tool orchestration latency and keeps provider routing inside computer-mcp.

## Routed providers

The router currently covers:

- Provider registry
- Filesystem
- Shell and managed processes
- Git
- Transactions
- Browser
- macOS Desktop

Call:

```text
router_catalog
```

to discover supported routed action names and their side-effect metadata.

## References between batch steps

Later steps can reuse results from earlier steps with:

```json
{ "$ref": "stepId.field" }
```

Example:

```json
{
  "steps": [
    {
      "id": "tx",
      "action": "tx.begin",
      "args": {
        "cwd": "/allowed/repo",
        "label": "safe edit"
      }
    },
    {
      "id": "status",
      "action": "tx.status",
      "args": {
        "transaction_id": { "$ref": "tx.id" }
      }
    }
  ]
}
```

## Dry run

Both routing entry points support validation before execution.

For one action:

```text
computer_action(..., dry_run=true)
```

For a batch:

```text
computer_batch(..., dry_run=true)
```

Dry-run mode validates action names, provider routing, argument schemas, and batch references without executing side effects.

## Error behavior

`computer_batch` defaults to:

```text
stop_on_error=true
```

If one step fails, later steps do not run. Set it to false only when independent steps should continue.

This batch mechanism is an orchestration layer, not an automatic transaction boundary. For recoverable code changes, continue to use the transaction provider:

```text
tx.begin
...
tx.rollback
tx.complete
```

## Provider architecture

Built-in providers:

- `filesystem`
- `shell`
- `git`
- `transaction`
- `browser`
- `desktop`

Use:

```text
provider_status
```

to see availability, enablement, and provider details.

## Browser provider

The browser provider uses `playwright-core` with an existing Chromium-based browser. On Apple Silicon Macs it detects when computer-mcp itself is running under Rosetta and launches Chrome natively as arm64 for more reliable CDP automation.

Tools include:

- `browser_open`
- `browser_list_tabs`
- `browser_use_tab`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_screenshot`
- `browser_close`

Enable it with:

```env
ALLOW_BROWSER=true
BROWSER_HEADLESS=false
```

By default, the managed browser uses an isolated runtime profile under:

```text
~/.computer-mcp/browser-profiles/runtime-<pid>
```

Set `BROWSER_PROFILE_DIR` if you want persistent browser login state.

Web page content is untrusted input. Browser interaction tools are marked open-world and potentially destructive where appropriate.

## Desktop provider

The desktop provider currently targets macOS and uses native `osascript` / `screencapture`.

Tools include:

- `desktop_frontmost_app`
- `desktop_open_app`
- `desktop_click`
- `desktop_type`
- `desktop_key`
- `desktop_screenshot`

Enable it with:

```env
ALLOW_GUI=true
```

macOS may require Accessibility permission for keyboard/mouse actions and Screen Recording permission for screenshots.

## Tool count

v0.6 exposes **54 MCP tools**, all with MCP annotations.

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

The provider/router boundary is intended to support:

- task-level rollback policies
- higher-level workflow templates
- SSH and Docker providers
- Windows/Linux desktop providers
- remote VM providers
- app-specific providers
