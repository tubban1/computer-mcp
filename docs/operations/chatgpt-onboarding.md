# ChatGPT onboarding

Computer MCP should not require new users to understand ports, launchd, tunnel flags, or secret-file paths. The supported first-run entry point is:

```bash
npm run setup
```

`npm run onboard:chatgpt` is an explicit alias for the same flow.

## What the setup does

1. Checks the existing Computer MCP Production Runtime.
2. Reuses a healthy installed Production release without upgrading or replacing it.
3. If Production has never been installed, asks before performing the first install.
4. If the selected Production profile requires cloud authorization, checks the OWL account device grant and launches the visible device-code approval flow when needed.
5. Checks Secure MCP Tunnel configuration and runs the interactive tunnel setup only when values are missing.
6. Reuses an already-running tunnel client without interruption.
7. On a fresh machine, prepares and starts a separate launchd-managed tunnel service.
8. Copies the saved Tunnel ID to the macOS clipboard when `pbcopy` is available.
9. Opens ChatGPT web and prints the minimal handoff instructions.
10. Writes a local onboarding receipt without credentials or the Tunnel ID.

The onboarding receipt is stored at:

```text
~/.computer-mcp/onboarding/chatgpt.json
```

## What the user still does in ChatGPT

OpenAI keeps ChatGPT app creation and workspace authorization as an explicit user action. In ChatGPT web:

1. Open **Plugins** and press **+** to create a developer-mode app.
2. Enter a user-facing name such as `Computer MCP`.
3. Under **Connection**, choose **Tunnel**.
4. Choose the available tunnel or paste the Tunnel ID copied by setup.
5. Create the connection and review the discovered tools.

This is intentionally not browser-automated. The final app/workspace authorization remains visible to the user.

## Tunnel background service

A fresh setup can run the tunnel independently from the Computer MCP server:

```bash
npm run tunnel:service:install
npm run tunnel:service:status
npm run tunnel:service:restart
npm run tunnel:service:stop
```

The service label is `fan.fde.computermcp.tunnel`. Its launchd configuration contains only a `file:` reference to the API-key secret; the raw API key is never written to the plist or process arguments.

If a manually started `tunnel-client-runtime run` process already exists, service installation does not kill it or start a competing client. It prepares the service definition and reuses the running tunnel. This protects active ChatGPT sessions during migration.

## Production boundary

Onboarding is not a production-upgrade mechanism.

- A healthy existing Production release is left untouched.
- An installed-but-unhealthy Production release causes onboarding to stop with a diagnostic instruction.
- Promotion to a newer release still requires the explicit `npm run promote:production` boundary.
- Tunnel lifecycle is independent from Runtime promotion and Native Helper lifecycle.

## OWL account authorization

Cloud authorization is intentionally separate from the ChatGPT Plugin/Tunnel connection. When the Production profile sets:

```text
AGENTOS_CLOUD_AUTH_REQUIRED=true
```

onboarding runs `cloud:status`. If the computer is not already authorized, it runs the device-code flow, opens the configured OWL Worker approval page, and waits for the signed-in user to approve this installation. The opaque device token is stored locally with mode `0600`; only its hash is persisted by the cloud.

This cloud grant can revoke Computer MCP work but cannot grant missing macOS permissions or enable disabled local capabilities. See [Cloud account and device authorization](cloud-account-and-device-auth.md).

## Security properties

- API-key input remains hidden in tunnel setup.
- The API key is stored in a `0600` local secret file.
- Tunnel configuration directories remain local to `~/.computer-mcp`.
- The setup receipt contains no credential and no Tunnel ID.
- Raw HTTP tunnel logging is not enabled by Computer MCP.
- User-visible ChatGPT authorization is preserved instead of automated away.

Run the regression check with:

```bash
npm run verify:onboarding
```
