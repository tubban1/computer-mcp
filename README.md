# AgentOS Runtime

> Repository/package compatibility name: `computer-mcp`

AgentOS Runtime is a personal computer-agent execution runtime for ChatGPT. It exposes safe, resumable control through filesystem, shell, Git, browser, macOS desktop, transactions, dependency graphs, persistent tasks, a stable Primitive ISA, reusable Skills, action contracts, and resource arbitration.

`v0.8.0` is preserved as the last stable **pre-AgentOS** release for users who prefer the simpler direct-MCP-tool architecture. Starting with `v0.9`, the project evolves as **AgentOS Runtime** while keeping the `computer-mcp` repository/package name for compatibility.

Architecture and 1.0 criteria: [`docs/AGENTOS_RUNTIME.md`](docs/AGENTOS_RUNTIME.md)

L1 Primitive ISA review: [`docs/L1_PRIMITIVE_ISA_REVIEW.md`](docs/L1_PRIMITIVE_ISA_REVIEW.md)

## v0.9 — Primitive & Skill Runtime

v0.9 incorporates the strongest architectural ideas from the earlier Owl Lab Agent OS work without adding a second LLM planner.

ChatGPT remains the planner. computer-mcp becomes the execution/runtime layer:

```text
ChatGPT
   ↓
Capability Manifest
   ↓
Skill Runtime              v0.9
   ↓
Primitive ABI              v0.9
   ↓
Action Contracts + Resource Arbiter
   ↓
Persistent Task Runtime    v0.8
Dependency Graph           v0.7
Provider Router            v0.6
Providers                  v0.5
   ├─ Filesystem
   ├─ Shell
   ├─ Git
   ├─ Transaction
   ├─ Browser
   └─ macOS Desktop
```

The design principle is:

```text
Skill = Primitive Graph + State Logic + Governance Metadata
```

The goal is to avoid exposing hundreds of narrowly specialized actions directly to the model.

## What changed in v0.9

### Primitive ABI v1 candidate

v0.9 introduced the compact Primitive layer. By v0.9.4 the catalog is explicitly versioned as **Primitive ABI v1 candidate**.

Core candidates:

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

Extensions:

- `sys.exec` — privileged escape hatch
- `admin.permission` — experimental administrative extension

Compatibility alias:

- `fs.query` → `fs.stat` (deprecated)

Use:

```text
primitive_catalog
primitive_call
```

Example:

```json
{
  "primitive": "web.open",
  "op": "navigate",
  "args": {
    "url": "https://example.com",
    "headless": true
  }
}
```

### Capability Manifest

Use:

```text
capability_manifest
```

with an optional natural-language goal.

The manifest returns:

- matching Skills
- stable Primitive ABI
- provider availability
- architecture metadata
- governance contracts

This is the first step toward keeping the model-facing capability surface small even as the internal runtime grows.

### Skill Runtime

Initial reusable Skills:

- `wechat.read`
- `wechat.copy_selected`
- `wechat.copy_at`
- `wechat.read_points`
- `wechat.send`
- `xhs.publish`
- `email.compose`
- `media.transcode`

Use:

```text
skill_catalog
skill_run
```

Known workflows should prefer Skills. Novel workflows should compose Primitives. Low-level routed actions remain available for precision and backward compatibility.

## Action Contracts

Each routed action now has an internal contract:

```text
riskLevel
idempotent
sideEffects
retryPolicy
requiresVerification
parallelSafe
resources
```

Example:

```json
{
  "riskLevel": "high",
  "idempotent": false,
  "sideEffects": ["remote_git_write"],
  "retryPolicy": "manual",
  "requiresVerification": true,
  "parallelSafe": false,
  "resources": [
    {
      "key": "git:/repo/path",
      "mode": "exclusive"
    }
  ]
}
```

v0.8 persistent tasks now store this contract metadata. Crash recovery uses `retryPolicy` rather than only a hard-coded parallel-safe list:

- `automatic` → interrupted step can return to `pending`
- `manual` / `never` → interrupted step becomes `needs_review`

This prevents accidental duplicate external side effects.

## Resource Arbiter

v0.9 adds shared/exclusive resource locks.

Examples:

```text
browser.session
desktop.focus
desktop.input
desktop.accessibility
desktop.clipboard
shell
git:/repo/path
fs:/path
transaction
```

Read-oriented actions may hold shared locks. State-changing actions use exclusive locks.

This makes v0.7 graph parallelism safer. Two actions can be logically parallel but still serialize automatically if they contend for the same physical resource.

## Desktop Perception

The macOS Desktop Provider now supports:

- frontmost application
- application window bounds
- Accessibility UI tree
- semantic UI element search
- semantic click by UI element
- whole-screen screenshot
- rectangular region screenshot
- clipboard read/write/info
- full-fidelity clipboard snapshot/restore up to 16 MiB
- clipboard change detection and safe copy-selection capture
- Unicode-safe text input through clipboard paste with clipboard preservation

These capabilities are available through the Primitive ABI and routed actions, so they do not need a large number of additional top-level MCP tools.

### macOS permissions

v0.9.2+ uses the standalone `Computer MCP Helper.app` for Accessibility and Screen Recording. Grant permissions to the Helper rather than to whichever IDE or Terminal launched computer-mcp:

```text
System Settings
→ Privacy & Security
→ Accessibility
→ Computer MCP Helper
```

and:

```text
System Settings
→ Privacy & Security
→ Screen & System Audio Recording
→ Computer MCP Helper
```

With `MACOS_HELPER_MODE=required`, GUI operations fail instead of silently falling back to the launcher process when the Helper is unavailable.

The direct `desktop_screenshot` MCP tool now also returns a compressed inline JPEG preview (max dimension 1280) while preserving the full-resolution screenshot at the requested path. This lets a vision-capable model inspect the Mac screen directly without routing the image through a second remote-desktop product.

## Headless browser per task

v0.9 no longer requires changing `.env` just to switch headless mode.

Example:

```json
{
  "primitive": "web.open",
  "op": "navigate",
  "args": {
    "url": "https://example.com",
    "headless": true
  }
}
```

If the current managed browser was launched in a different mode, the Browser Provider safely restarts its managed session in the requested mode.

The global default remains:

```env
BROWSER_HEADLESS=false
```

## Browser semantic find and upload

New routed browser capabilities:

- `browser.find`
- `browser.upload`

Primitive mappings:

```text
web.query(find)
web.transfer(upload)
```

Uploads use Playwright `setInputFiles` and only accept files inside `ALLOWED_DIRECTORIES`.

Example:

```json
{
  "primitive": "web.transfer",
  "op": "upload",
  "args": {
    "selector": "input[type=file]",
    "files": ["/allowed/path/image.png"]
  }
}
```

## WeChat Skill

### Read

`wechat.read` uses a clipboard-first fast path. It focuses WeChat by bundle identifier, tries Cmd+C on the current selection, captures copied text, restores the previous full pasteboard, then falls back to Accessibility and optional screenshot perception when no selection is copied.

`wechat.copy_selected` is the explicit fast path when text is already selected.

`wechat.copy_at` is designed for visual-model workflows: inspect a recent desktop screenshot, choose a visible text-message coordinate, triple-click it, copy the exact message text through the clipboard, and restore the prior clipboard.

`wechat.read_points` batches the same pattern for up to 20 screenshot-derived points, deduplicates repeated captures, and returns exact clipboard text for each point.

On current WeChat for macOS, the main message list is mostly custom-rendered and exposes very little through Accessibility. The working perception order is therefore:

```text
Screenshot / vision → choose message coordinates
                  ↓
            triple-click
                  ↓
             Clipboard
                  ↓
          exact message text
```

### Send

`wechat.send` is conservative by default.

It:

1. focuses WeChat
2. returns to the chat tab
3. opens search
4. searches the requested contact
5. verifies an exact accessible contact-name match
6. stops unless `send=true`
7. only then focuses the message region, pastes text, and presses Return

If exact verification fails, it refuses to send.

Example preparation-only call:

```json
{
  "skill": "wechat.send",
  "args": {
    "contact_name": "文件传输助手",
    "message": "hello",
    "send": false
  }
}
```

## Xiaohongshu Skill

`xhs.publish` supports:

- headless browser execution
- title/body entry
- local image upload
- preparation-only mode
- explicit final publish

Final publishing only occurs when:

```json
{
  "publish": true
}
```

Default is `false`.

A persistent browser profile is recommended so login state survives restarts:

```env
BROWSER_PROFILE_DIR=/Users/yourname/.computer-mcp/browser-profile
```

The first login may be easier in headful mode.

## Email Skill

`email.compose` currently uses Gmail Web and supports:

- recipient
- subject
- body
- headless execution
- draft/preparation mode
- explicit final Send

Final sending only occurs when:

```json
{
  "send": true
}
```

Default is `false`.

A future dedicated Mail Provider can replace browser automation with Gmail API / IMAP / SMTP while keeping the same Skill interface.

## Media Skill

`media.transcode` uses local FFmpeg.

Modes:

- `copy`
- `compress`
- `vertical` — 1080×1920
- `square` — 1080×1080
- `audio`

Optional:

- `start_seconds`
- `duration_seconds`

Example:

```json
{
  "skill": "media.transcode",
  "args": {
    "input_path": "/allowed/input.mp4",
    "output_path": "/allowed/output-square.mp4",
    "mode": "square"
  }
}
```

## Persistent Tasks — v0.8

Long tasks remain resumable across:

- new ChatGPT conversations
- tunnel restarts
- computer-mcp restarts
- Mac restarts

Tools:

- `task_create`
- `task_list`
- `task_status`
- `task_run`
- `task_pause`
- `task_cancel`
- `task_resolve_step`
- `task_delete`

Task state and step outputs are encrypted locally using AES-256-GCM.

Default storage:

```text
~/.computer-mcp/tasks/
~/.computer-mcp/task.key
```

Task directory permissions: `700`

Task/key permissions: `600`

## Dependency Graph — v0.7

`computer_graph` executes dependency-aware DAGs with bounded parallelism.

v0.9 derives `parallelSafe` from Action Contracts rather than maintaining a separate hard-coded list.

Resource Arbiter locks provide a second safety layer when nominally parallel steps touch the same physical resource.

## Provider Router — v0.6

Low-level routed APIs remain available:

- `router_catalog`
- `computer_action`
- `computer_batch`
- `computer_graph`

The router catalog now includes Action Contract metadata.

## Providers — v0.5

Built-in providers:

- Filesystem
- Shell / managed processes
- Git
- Transaction
- Browser
- macOS Desktop

Use:

```text
provider_status
```

to inspect runtime availability.

## Tool count

v0.9 exposes **68 MCP tools**, all annotated.

The internal action surface is larger, but new v0.9 capabilities deliberately prefer `primitive_call` and `skill_run` instead of adding every internal action as another top-level MCP tool.

## Recommended selection order

For an agent:

```text
1. capability_manifest(goal)
2. matching skill_run(...)
3. otherwise primitive_call(...)
4. use computer_graph/task_* for complex or durable composition
5. use low-level routed actions only when precision requires them
```

## Example configuration

```env
PORT=8787
ALLOWED_DIRECTORIES=/Users/yourname/Documents/Projects

ALLOW_WRITE=true
ALLOW_DELETE=false
ALLOW_SHELL=false
ALLOW_GIT_PUSH=false
ALLOW_ROLLBACK=false

ALLOW_BROWSER=true
BROWSER_HEADLESS=false
# BROWSER_PROFILE_DIR=/Users/yourname/.computer-mcp/browser-profile

ALLOW_GUI=true

AUDIT_LOG_ENABLED=true
```

High-risk capabilities remain opt-in.

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

## Secure tunnel

If using the OpenAI Secure MCP Tunnel, restart it after changing tool definitions:

```bash
./start-tunnel.sh
```

Then refresh/reconnect the ChatGPT app so it rescans the MCP tool catalog.

A successful v0.9 tunnel probe should report:

```text
server_name=computer-mcp
server_version=0.9.4
```

## Current boundaries

v0.9 intentionally does not embed another LLM planner. ChatGPT is the planner.

Desktop Accessibility is deterministic where apps expose their UI tree, but some apps may hide message/content details. Vision can be layered on top of screenshots when needed.

Xiaohongshu and Gmail browser Skills depend on the current site UI and login state, so they should be treated as adapters rather than permanent protocol contracts.

The Primitive ABI and Skill interfaces are intended to remain much more stable than individual website selectors.

## Roadmap

Likely next steps:

- vision/OCR adapter for Desktop Perception
- dedicated Mail Provider
- stronger WeChat perception and watcher
- persistent Skill workflows built directly on v0.8 tasks
- scheduler / wake-and-resume
- dynamic capability retrieval instead of simple keyword matching
- per-site Skill adapters with verification receipts
- SSH / Docker / remote-machine Providers

## v0.9.1 — Clipboard Perception Fast Path

v0.9.1 promotes the macOS clipboard from a simple input helper to a first-class perception channel.

The stable `clipboard` Primitive now supports:

- `read`
- `write`
- `info`
- `snapshot`
- `restore`
- `wait_change`
- `copy_selection`

Clipboard snapshots are short-lived in-memory tokens. v0.9.1 captures every pasteboard item/type as binary data and restores it with full fidelity up to a 16 MiB safety cap, including rich text, URLs, images, and application-specific clipboard flavors. If a clipboard exceeds the cap, automatic copy/paste mutation refuses to overwrite it.

`desktop.type` now snapshots and restores the full macOS pasteboard by default.

`wechat.read` uses a clipboard-first fast path: it focuses WeChat, attempts to capture the current selected text via Cmd+C, restores the previous clipboard, and then falls back to Accessibility and optional screenshot perception when no text is copied.

A dedicated `wechat.copy_selected` Skill provides the fastest path when text/messages are already selected in WeChat.

## v0.9.2 — Native macOS Helper

v0.9.2 packages desktop control into a standalone macOS app:

```text
~/Applications/Computer MCP Helper.app
```

The helper has a stable bundle identifier:

```text
fan.fde.computermcp.helper
```

It is launched by macOS LaunchServices and runs independently of the IDE or Terminal that started computer-mcp. computer-mcp talks to it through a private Unix-domain socket:

```text
~/.computer-mcp/helper.sock
```

The socket is created with mode `600`; the parent directory is mode `700`.

This means Accessibility and Screen Recording permissions can be granted once to **Computer MCP Helper**, instead of separately to Antigravity, Terminal, Cursor, launchd, or other launchers.

Build/install the helper with:

```bash
./scripts/install-macos-helper.sh
```

The Desktop Provider defaults to:

```env
MACOS_HELPER_MODE=auto
```

Modes:

- `auto` — prefer the helper, fall back to the previous in-process AppleScript path if unavailable.
- `required` — fail instead of falling back when the helper is unavailable or untrusted.
- `disabled` — use the legacy in-process desktop path only.

Use the Primitive ABI to inspect or request permissions:

```text
primitive_call("app.lifecycle", "helper_status")
primitive_call("app.lifecycle", "request_permissions")
```

The helper currently owns native Accessibility actions, keyboard/mouse input, app/window inspection, UI-tree reads, and screenshot execution. Clipboard state remains managed by the v0.9.1 full-fidelity clipboard transaction layer.


## v0.9.3 — Visual + Clipboard WeChat Perception

v0.9.3 closes the loop between vision and exact text extraction on macOS.

The direct `desktop_screenshot` tool now returns two things at once:

- the full-resolution screenshot saved at the requested local path
- a compressed inline JPEG preview (max dimension 1280) that a vision-capable model can inspect directly

For WeChat, this matters because current macOS WeChat exposes very little of the chat body through Accessibility. In testing, the working pattern is:

```text
desktop_screenshot
→ model sees visible message bubbles
→ choose macOS screen coordinates
→ rapid triple-click
→ Cmd+C
→ clipboard.wait_change
→ exact original text
→ restore user's previous clipboard
```

New Skills:

- `wechat.copy_at` — capture one visible text message from a screenshot-derived coordinate
- `wechat.read_points` — capture up to 20 visible message coordinates in one Skill run and deduplicate repeated results

The default click count is 3 because WeChat triple-click selects the whole text message, while a double-click generally selects only one word.

The WeChat Skills now target the stable bundle identifier:

```text
com.tencent.xinWeChat
```

instead of relying on the localized application display name.

Clipboard copy detection is also stricter: a clipboard change containing zero text is no longer reported as a successful text capture.

Finally, `desktop_frontmost_app` now prefers a read-only NSWorkspace query before the AX fallback. This avoids a focused-application edge case in the native Helper while still keeping all consequential desktop input and screenshot operations behind `Computer MCP Helper.app`.


## v0.9.4 — Primitive ABI v1 Candidate Boundary

v0.9.4 hardens the AgentOS Runtime layer boundary without adding new top-level MCP tools.

Primitive catalog entries now expose:

```text
abiVersion
stability
tier
deprecated
replacement
opMetadata
```

Current catalog shape:

```text
23 core candidates
1 privileged candidate   (sys.exec)
1 admin experimental     (admin.permission)
1 deprecated alias       (fs.query → fs.stat)
```

Key changes:

- `fs.stat` is the canonical filesystem metadata Primitive.
- `fs.query` remains routable as a deprecated v0.9 compatibility alias.
- `vision.capture(page)` is the canonical browser page screenshot path.
- transitional duplicates remain accepted but advertise replacements:
  - `ui.query(frontmost|bounds)` → `app.lifecycle(...)`
  - `web.query(tabs)` → `web.session(tabs)`
  - `web.transfer(screenshot)` → `vision.capture(page)`
  - Helper permission ops move toward the non-core `admin.permission` extension
- `sys.exec` is explicitly classified as a privileged escape hatch.
- all built-in L2 Skills now execute through `executePrimitive(...)` rather than invoking L0.5 routed Actions directly.
- `npm run verify:isa` checks Primitive metadata, aliases, tiering, and the L2 Skill → L1 Primitive dependency boundary.

Because the top-level MCP tool schema is unchanged, ordinary v0.9.4 Skill/Primitive updates do not require a ChatGPT **Refresh Tools** step once `primitive_call` / `skill_run` are already connected.
