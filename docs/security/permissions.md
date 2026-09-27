# Permissions

AgentOS uses explicit capability gates and OS permissions.

## Filesystem scope

Filesystem operations are limited by configured allowed directories. Runtime-owned staging/state paths are handled separately.

Computer MCP 1.0 provides persistent production access profiles so this scope is configured once rather than rediscovered during normal use:

```bash
npm run permissions:status
npm run permissions:standard
npm run permissions:full-home
```

`standard` covers the normal macOS user folders (Desktop, Documents, Downloads, Pictures, Movies, Music, Public). `full-home` grants filesystem scope to the current user's entire home directory and is intended only for an explicitly trusted personal-worker installation. Profile changes are written to `~/.agentos/runtime.env`, backed up first, kept mode `0600`, and applied by restarting the same immutable Production release.

## High-impact capabilities

Shell execution, deletion, Git push, rollback, browser automation, and GUI automation are independently governed.

## macOS Helper

Desktop and WeChat capabilities may require:

- Accessibility
- Screen & System Audio Recording

The Runtime should report missing permissions rather than pretending background automation succeeded.

The Helper identity is deliberately independent from normal Server releases: stable path `~/Applications/Computer MCP Helper.app`, stable Bundle ID `fan.fde.computermcp.helper`, and no ordinary 1.x Server promotion may rebuild or replace it. On first use the user grants Accessibility and Screen Recording once. The desktop provider can relaunch the same installed Helper on demand without changing its binary identity.

## Production self-protection

Production mode blocks writes to the active Runtime release by default. Upgrades go through immutable release installation and health verification.
