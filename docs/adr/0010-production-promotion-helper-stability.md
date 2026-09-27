# ADR-0010: Production Promotion and Native Helper Stability

Status: Accepted

## Context

`computer-mcp` is a production personal tool, not merely a development Runtime.

The development repository changes frequently. Production must not inherit those changes merely because source code, dependencies, OWL Runtime, or another ChatGPT session changed.

macOS native permissions are especially sensitive to executable identity. Rebuilding/replacing the helper unnecessarily risks repeated Accessibility and Screen Recording permission friction.

## Decision

### 1. Development never auto-promotes to production

These actions must never replace the active production release:

- Git pull/fetch/checkout/commit;
- `npm run dev`;
- build/typecheck/test/CI;
- changes in `owl-runtime`;
- changes in `computer-mcp` source;
- creation of a release candidate;
- successful conformance tests.

Production changes only after an explicit human-initiated **Promote to Production** operation.

The canonical command is:

```bash
npm run promote:production
```

`upgrade:production` remains a compatibility alias for the same explicit promotion mechanism.

### 2. Computer MCP 1.x production stays standalone

Computer MCP 1.0 is a stable standalone personal MCP Server.

During 1.x:

- production uses the local/legacy standalone backend;
- RuntimeClient/OWL integration may be developed and dogfooded in development/test;
- no 1.x patch or minor release may silently convert production to an OWL Runtime dependency;
- the first planned production backend architecture switch is a major release, currently targeted at 2.0.

The production RuntimeClient selector fails closed if an OWL backend is configured in 1.x production.

### 3. Major-version architecture policy

Target policy:

| Version line | Production architecture |
|---|---|
| 0.9.16 | current immutable standalone production |
| 1.0.0 | stable standalone Computer MCP |
| 1.x | compatibility, performance, reliability, bug fixes; no backend architecture switch |
| 2.0.0 | candidate first Runtime-backed production major release |
| 2.x | Runtime-backed stabilization |
| 3.0.0+ | only for another deliberate major architecture boundary |

A major version does not automatically authorize a migration. It only provides the compatibility boundary where such a migration may be promoted after evidence.

### 4. OWL Runtime development is isolated from Computer MCP production

Even after Runtime-backed production exists, source development must remain isolated:

```text
owl-runtime source/dev
      ↓
tests + release
      ↓
computer-mcp compatibility
      ↓
soak + dogfood
      ↓
explicit promotion
      ↓
OWL Runtime production
```

Both Computer MCP production and OWL Runtime production are immutable promoted artifacts. Neither follows a Git working tree.

### 5. Native Helper has an independent lifecycle

The macOS Helper is not part of ordinary Server rollout.

The production helper has:

- stable install path: `~/Applications/Computer MCP Helper.app`;
- stable Bundle ID: `fan.fde.computermcp.helper`;
- independent `CFBundleShortVersionString` / `CFBundleVersion`;
- a signing identity independent from the TypeScript Server release.

Production Server install/upgrade scripts must not build, install, replace, or re-sign the helper.

The Helper is updated only when native Accessibility, Screen Capture/OCR, input, or other Helper code actually changes.

### 6. Unchanged Helper means no replacement

`scripts/install-macos-helper.sh` fingerprints the Helper source and Info.plist.

If the installed fingerprint matches:

- the App bundle is preserved;
- no replacement/re-sign occurs;
- the existing macOS permission identity is preserved as much as possible.

If source changes after a fingerprinted install while the Helper version is unchanged, installation fails and requires an independent Helper version bump.

### 7. Signing

Ad-hoc signing remains usable for development.

Stable production should use a consistent configured signing identity:

```text
COMPUTER_MCP_HELPER_SIGN_IDENTITY=<stable code-signing identity>
```

A future packaged macOS application should keep stable Bundle ID, Team ID, signing identity, and install path under `/Applications` or another stable application location.

## Production priority order

For personal use, optimize in this order:

1. production availability/stability;
2. macOS permissions remain valid;
3. low latency;
4. no development-triggered restarts;
5. multi-session isolation;
6. background process durability;
7. architectural elegance.

Architecture must not degrade the first six.

## Promotion gate for 1.0

Before promoting 1.0.0 over 0.9.16 production:

- full regression green;
- multi-session stability green;
- no permission regression;
- stable Helper identity verified;
- Helper unchanged unless intentionally version-bumped;
- 24-hour soak passed;
- rollback verified;
- production backend confirmed standalone;
- personal dogfood complete;
- promotion performed explicitly.

## Consequences

Development can move quickly without destabilizing daily use.

RuntimeClient development can continue in parallel with OWL Runtime while Computer MCP 1.x production remains independent.

Helper updates become rarer and intentional, reducing unnecessary macOS permission churn.
