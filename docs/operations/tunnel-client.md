# Tunnel client setup

Computer MCP keeps tunnel setup separate from the production Runtime lifecycle. Configuring or restarting the tunnel must not rebuild, reinstall, or promote the Computer MCP server or Native Helper.

## One-time setup

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

After setup:

```bash
npm run tunnel:status
npm run tunnel:run
```

`tunnel:status` reports whether the key exists but never prints it. `tunnel:run` reuses the saved Tunnel ID, runtime path, MCP target, and secret file, so normal starts require no credential input.

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
