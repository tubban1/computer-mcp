# computer-mcp

A personal Computer MCP runtime for ChatGPT with pluggable providers for filesystem, shell, Git, transactions, browser automation, and macOS desktop control.

## v0.5 — Provider architecture

v0.5 introduces a provider layer so computer-mcp can grow beyond file/terminal tools without turning the server into one monolithic implementation.

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

The browser provider uses `playwright-core` with an existing Chromium-based browser. On macOS it auto-detects Google Chrome, Chromium, or Microsoft Edge.

Tools:

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

Set `BROWSER_PROFILE_DIR` if you want a persistent login/profile across computer-mcp restarts.

Web page content is treated as untrusted data. Browser click/type tools are marked destructive/open-world because they may trigger external side effects.

## Desktop provider

The desktop provider currently targets macOS and uses native `osascript` / `screencapture`.

Tools:

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

macOS may ask for:
- Accessibility permission for click/keyboard automation
- Screen Recording permission for screenshots

## Existing providers

The previous capabilities remain available:

- filesystem read/search/write
- shell and managed processes
- Git
- audit log
- Git-backed task transactions and rollback

## Tool count

v0.5 exposes **51 MCP tools** with annotations.

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
npm install
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

## Provider roadmap

The provider boundary is intended to support future implementations such as:

- alternate browser engines
- Windows/Linux desktop providers
- Docker/container execution providers
- remote SSH providers
- cloud VM providers
- specialized app providers
