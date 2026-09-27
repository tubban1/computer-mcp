# Tunnel client setup

Computer MCP keeps tunnel credentials and service lifecycle separate from Server promotion. Configuring or restarting the tunnel must not rebuild, reinstall, or promote the Computer MCP Server or stable permission-bearing apps.

## Packaged macOS install

Computer MCP 1.0.4+ bundles the official OpenAI Tunnel Client runtime. A normal end-user install does not require a separate Tunnel Client download.

The first install reuses existing saved credentials when present. Otherwise it asks once for the Tunnel ID and control-plane API key, saves them locally, and installs the tunnel as a launchd background service. Runtime Server, Tunnel Client, and Helper are then configured to start automatically.

The bundled upstream LICENSE, NOTICE, third-party license report, SPDX metadata, source URL, and SHA-256 provenance are retained in the distribution.

## Source/development one-time setup

Run:

```bash
npm run tunnel:setup
```

The setup flow asks for the Tunnel ID and, when needed, the control-plane API key. API-key input is hidden.

If an older `~/tunnel-client-runtime-v*-darwin-*/start-tunnel.sh` exists, setup can reuse its Tunnel ID. If `~/.computer-mcp/secrets/openai-api-key` already exists, the existing key can be kept without re-entering it.

## Persistent files

Setup stores non-repository state under:

```text
~/.computer-mcp/tunnel/tunnel-id
~/.computer-mcp/tunnel/runtime-path
~/.computer-mcp/tunnel/mcp-server-url
~/.computer-mcp/secrets/openai-api-key
```

The directories are mode `0700`; saved values, including the API-key file, are mode `0600`.

The API key is never written into `package.json`, a Git-tracked file, or the tunnel process command line. The runtime receives only a `file:/...` reference to the secret.

## Normal use

After setup, interactive development can still use:

```bash
npm run tunnel:status
npm run tunnel:run
```

For normal daily use, prefer the independent background service:

```bash
npm run tunnel:service:install
npm run tunnel:service:status
```

`tunnel:status` reports whether the key exists but never prints it. `tunnel:run` reuses the saved Tunnel ID, runtime path, MCP target, and secret file. The background service uses the same saved configuration and a `file:` secret reference, so normal starts require no credential input.

The default MCP target is the standalone production listener:

```text
http://127.0.0.1:8787/mcp
```

For development, override `MCP_SERVER_URL` rather than rewriting the saved production configuration.

## Automation overrides

Non-interactive setup and controlled automation may provide:

```text
CONTROL_PLANE_TUNNEL_ID
CONTROL_PLANE_API_KEY
CONTROL_PLANE_API_KEY_FILE
TUNNEL_CLIENT_RUNTIME_BIN
MCP_SERVER_URL
COMPUTER_MCP_TUNNEL_HOME
```

Do not put real credentials into Git-tracked environment files. For normal interactive use, prefer the saved `0600` secret file.
