# Troubleshooting

## Jarvis is not reachable

Check:

```bash
npm run status:production
```

Production should report a running `com.agentos.runtime` LaunchAgent and a healthy `/health` endpoint.

## Do I need `npm run dev`?

No for normal use.

Production runs from `~/.agentos/current/dist/server.js` under launchd.

Use `npm run dev` only while developing AgentOS itself. It defaults to port `8788` and a separate development state root, so it does not collide with the production service on `8787`.

## WORKSPACE_BUSY

Another durable Task, Process, Transaction, or explicit lease owns an overlapping workspace.

Inspect with `runtime.workspace status/list`. Prefer wait/handoff rather than forcing release unless you have verified the owner is stale.

## PROCESS_NOT_ORPHANED

A process claim was attempted while the original owner is still active. Claim is only for recovered/disconnected ownership cases.

## RUNTIME_SELF_IMMUTABLE

Production Runtime refused to mutate its own active release. Build and install a new release instead.

## WeChat background OCR fails

Check macOS permissions for Computer MCP Helper:

- Accessibility
- Screen & System Audio Recording

## Development changes keep restarting tools

Do not run the active service from `tsx watch`. Keep production on launchd and, when needed, run an isolated development instance on a different port.
