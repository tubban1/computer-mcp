# Production Promotion Policy

This document defines the operational rule for the Computer MCP instance used every day.

## Core rule

**Source development never changes production automatically.**

The following are development actions only:

```text
git pull / checkout / commit
npm run dev
npm run build
tests / CI
RuntimeClient changes
owl-runtime changes
release-candidate creation
```

None of them may alter the running production service.

The only normal transition is:

```text
development/release candidate
        ↓
release gates
        ↓
personal dogfood
        ↓
explicit Promote to Production
        ↓
immutable production release
```

Canonical command:

```bash
npm run promote:production
```

## 1.x production architecture lock

Computer MCP 1.x production is standalone.

`COMPUTER_MCP_RUNTIME_BACKEND=owl-http` is valid only for development/test dogfood during the 1.x line. Production fails closed if it is configured.

OWL Runtime is a 2.0 production architecture candidate, not a rolling dependency of 1.x.

## Production and development isolation

```text
computer-mcp production
  immutable release
  launchd supervised
  production state
  stable helper
          │
          X  no automatic source coupling
          │
computer-mcp development
  source checkout
  dev state
  RuntimeClient experiments

owl-runtime development
  separate source/release/state
```

## Native Helper lifecycle

Server promotion does not imply Helper promotion.

Stable Helper identity:

```text
Path:      ~/Applications/Computer MCP Helper.app
Bundle ID: fan.fde.computermcp.helper
Version:   independent from computer-mcp Server
Signing:   stable identity for production
```

Ordinary TypeScript/MCP/browser/scheduler fixes must not reinstall the Helper.

Run `scripts/install-macos-helper.sh` only for an intentional native Helper update. The installer skips replacement when its source fingerprint is unchanged and rejects changed source without a Helper version bump after the fingerprint baseline exists.

## Promotion evidence

For 1.0.0:

- full regression;
- multi-session tests;
- session identity/process ownership/cancellation/orphan tests;
- production verifier;
- rollback verifier;
- 24-hour soak;
- no Helper/TCC permission regression;
- standalone backend verified;
- personal dogfood.

For patch/minor 1.x releases, apply the same safety principle with scope-appropriate regression evidence, while preserving the production backend architecture and Helper identity.

## Rollback

Production code is an immutable release selected by a stable current pointer.

Rollback switches the selected release; it does not mutate a working tree and does not reinstall the Helper.

A future Runtime-backed major release must use the same rule independently for both Computer MCP and OWL Runtime production artifacts.
