# Computer MCP 1.0.4 — New Mac Installation

This is the canonical end-to-end installation flow for a new Mac.

## What the package already contains

The macOS release package is self-contained for the Computer MCP core:

- Computer MCP Runtime.app
- Computer MCP Helper.app
- official Node.js runtime
- OpenAI Tunnel Client runtime
- compiled Computer MCP Server
- production npm dependencies
- automatic launchd services

The target Mac does not need Node.js, npm, TypeScript, Homebrew, or a source checkout.

## 1. Download the correct package

Use the Computer MCP v1.0.4 GitHub Release.

- Apple Silicon (M1/M2/M3/M4/...): `Computer-MCP-1.0.4-macOS-arm64.zip`
- Intel Mac: `Computer-MCP-1.0.4-macOS-x64.zip`

Verify the matching SHA-256 sidecar when desired.

## 2. Prepare OpenAI Secure MCP Tunnel credentials

A fresh machine needs two values once:

1. **Tunnel ID** — format like `tunnel_...`
2. **Runtime API key** — used by the long-running Tunnel Client

Create or inspect the Tunnel ID in OpenAI Tunnels management:

`https://platform.openai.com/settings/organization/tunnels`

Create the Runtime API key in:

`https://platform.openai.com/settings/organization/api-keys`

The runtime user/key needs the tunnel permissions required by OpenAI Tunnel Client, including Tunnels Read + Use.

Do not use an OpenAI admin key as the long-running Tunnel Client credential.

## 3. Run the installer

Unzip the release package and run:

`Install Computer MCP.command`

On a clean machine, the installer asks once for:

- Tunnel ID
- Runtime API key

API-key input is hidden.

If existing Computer MCP Tunnel credentials are already present, the installer reuses them without prompting.

The installer stores state under:

- `~/.computer-mcp/tunnel/tunnel-id`
- `~/.computer-mcp/secrets/openai-api-key`

The secret file is mode 0600. The API key is not written into the launchd plist or process command line; Tunnel Client receives a `file:/path` reference.

## 4. Grant macOS permissions

Three permissions are required once.

### Computer MCP Runtime

System Settings → Privacy & Security → Full Disk Access

Enable:

**Computer MCP Runtime**

This is the stable permission identity for Desktop, Documents, Downloads, and other protected file access.

### Computer MCP Helper

System Settings → Privacy & Security → Accessibility

Enable:

**Computer MCP Helper**

Then:

System Settings → Privacy & Security → Screen & System Audio Recording

Enable:

**Computer MCP Helper**

Helper is the stable native provider for GUI, pointer, keyboard, screen, window, and related macOS capabilities.

After changing permissions, macOS may ask to quit/reopen the app. Allow that, then restart the Computer MCP services if needed.

## 5. Automatic background services

After install, these services are supervised by launchd and automatically start after login:

- Computer MCP Runtime Server
- OpenAI Tunnel Client
- Computer MCP Helper

Normal daily use does not require Terminal, `npm run dev`, Homebrew Node, or manually starting Tunnel/Helper.

## 6. Verify local status

From a source checkout, operators can use:

```bash
npm run status:production
npm run tunnel:service:status
npm run helper:service:status
```

Expected state:

- Computer MCP Server health: healthy
- Tunnel launchd: loaded
- Tunnel readiness: ready
- Helper launchd: loaded
- Helper socket: ready

The Computer MCP Server is not a separate macOS app. It runs under Computer MCP Runtime.app and exposes its own runtime health/status at the MCP server layer.

## 7. Connect it to ChatGPT

ChatGPT cannot connect directly to a localhost MCP server. Secure MCP Tunnel provides the remote bridge.

For a custom MCP app, enable the applicable ChatGPT developer/custom-app controls, then create the app/connector in ChatGPT settings using the secure tunnel-backed MCP endpoint. Scan the tools and create/enable the app.

OpenAI currently documents custom MCP app setup under ChatGPT Settings / Workspace Settings → Apps → Create, followed by endpoint configuration and Scan Tools.

The ChatGPT-side app authorization is account/workspace state and is intentionally not silently bypassed by the local Computer MCP installer.

OpenAI Tunnel Client also documents the ChatGPT connector settings entry point:

`https://chatgpt.com/#settings/Connectors`

Keep the local Tunnel Client healthy while creating/scanning the connector.

## 8. Where the components live

Typical installed layout:

```text
~/Applications/
  Computer MCP Runtime.app
  Computer MCP Helper.app

~/.agentos/
  current -> immutable Computer MCP Server release
  releases/
  node/
  tunnel/

~/.computer-mcp/
  tunnel/
  secrets/
  logs/
  helper.sock
```

## 9. Permission ownership model

```text
ChatGPT
   ↓
OpenAI Tunnel Client
   ↓
Computer MCP Server
   ↓
Computer MCP Runtime.app
   ├─ bundled Node / Server
   ├─ filesystem / shell / Git / process domains
   └─ Computer MCP Helper.app
        └─ GUI / screen / pointer / keyboard / native macOS domains
```

- Runtime.app carries Full Disk Access.
- Helper.app carries Accessibility and Screen Recording.
- Server code, Node, and Tunnel can be updated independently without intentionally replacing the stable permission-bearing app identities.

## 10. Reinstall / upgrade behavior

Existing stable Runtime Host and Helper apps are preserved where possible so macOS permission grants survive ordinary Computer MCP 1.x Server updates.

Existing Tunnel ID/API key are reused.

A Server update should not require the user to re-enter credentials or re-grant macOS permissions unless a permission-bearing app identity itself is intentionally changed.
