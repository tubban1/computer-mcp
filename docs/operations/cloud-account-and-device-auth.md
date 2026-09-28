# Cloud account and Computer MCP device authorization

Status: **1.x opt-in foundation**.

Computer MCP can be bound to an OWL cloud account without replacing local macOS permissions, Runtime policy, or the Secure MCP Tunnel. Cloud authorization is an additional gate: it can remove authority, but it never grants filesystem, shell, browser, Accessibility, Screen Recording, delete, Git push, or other local permissions that the machine has not already granted.

## Account and device flow

```text
OWL cloud account login
        ↓
Computer MCP requests one-time device code
        ↓
User reviews + approves device in OWL Worker
        ↓
Cloud creates device grant
        ↓
Computer MCP receives opaque device token
        ↓
Token stored locally with mode 0600
        ↓
MCP tool execution can require active cloud grant
```

The cloud stores only the SHA-256 hash of the opaque device token. Revoking a device invalidates its grant and active tokens. Computer MCP revalidates authorization periodically, so revocation is detected without changing macOS permissions.

## Commands

```bash
npm run cloud:login
npm run cloud:status
npm run cloud:heartbeat
npm run cloud:logout
```

For production OWL Worker, configure its public application URL:

```text
AGENTOS_CLOUD_APP_URL=https://<your-owl-worker-domain>
```

The default development approval URL is `http://localhost:3000/device`.

## Runtime gates

Legacy behavior remains unchanged unless cloud gates are explicitly enabled.

```text
AGENTOS_CLOUD_AUTH_REQUIRED=false
AGENTOS_CLOUD_SYNC=false
AGENTOS_CLOUD_SYNC_REQUIRED=false
AGENTOS_CLOUD_AUTH_CACHE_MS=30000
```

When `AGENTOS_CLOUD_AUTH_REQUIRED=true`, every MCP tool call must have a currently authorized device grant containing `computer.control`. Cloud failure or revocation fails closed.

When `AGENTOS_CLOUD_SYNC=true`, Session Endpoint communication receipts are mirrored to the cloud communication store. With `AGENTOS_CLOUD_SYNC_REQUIRED=true`, a communication operation does not report complete success if the cloud record cannot be committed.

## Communication data

The cloud schema separates:

- threads / channel identity;
- normalized incoming, outgoing, and system messages;
- message receipts and verification evidence;
- runtime/device events;
- user-owned Worker product state;
- devices, grants, and command queue state.

Session adapters remain transport-neutral. WeChat can use UI/OCR, a browser agent can use DOM automation, and a future official provider can use an API while all of them emit the same cloud communication record.

## Security boundary

Cloud device authorization and local capability policy intersect:

```text
effective authority
  = cloud device grant
  ∩ local ALLOW_* gates
  ∩ macOS TCC permissions
  ∩ Runtime action/approval policy
```

A cloud account cannot silently grant Full Disk Access, Accessibility, Screen Recording, delete permission, Git push, or shell permission.
