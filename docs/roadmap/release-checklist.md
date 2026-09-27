# Release Checklist

Use this checklist for release candidates and stable releases.

## Build and static checks

- [ ] clean tracked working tree
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] shell installer syntax checks

## Runtime conformance

- [ ] Primitive ISA verifier
- [ ] Stable contract conformance verifier
- [ ] Skill ABI verifier
- [ ] Task/staging verifier
- [ ] Scheduler verifier
- [ ] Loop verifier
- [ ] Semantic-memory verifier
- [ ] Recall verifier
- [ ] Session-adapter verifier
- [ ] Embedding-provider verifier
- [ ] WeChat-session verifier
- [ ] macOS Helper verifier
- [ ] Concurrency verifier
- [ ] Drain/handoff verifier
- [ ] Upgrade Runtime verifier
- [ ] State schema verifier
- [ ] Fault recovery verifier
- [ ] Recovery matrix verifier
- [ ] Soak smoke profile
- [ ] Production Runtime verifier
- [ ] Fresh immutable release verifier (`npm ci --omit=dev`, no source checkout dependency)
- [ ] Production boundary verifier
- [ ] Performance P0 verifier
- [ ] Read-only observation remains responsive under unrelated workspace write load
- [ ] Interactive resource waits cancel promptly and fail with bounded `RESOURCE_WAIT_TIMEOUT`
- [ ] Natural managed-process exit reconciles and releases its workspace lease
- [ ] Reconnect churn returns active MCP session/transport counts to a bounded baseline

## Production

- [ ] promotion was explicitly initiated (`npm run promote:production`)
- [ ] no source/dev/CI action auto-promoted production
- [ ] 1.x backend is standalone/legacy
- [ ] immutable release created
- [ ] launchd service healthy
- [ ] expected version reported
- [ ] production state root correct
- [ ] current release symlink correct
- [ ] rollback path available
- [ ] no `tsx watch` process serving production
- [ ] production Server promotion did not replace macOS Helper
- [ ] Helper path remains `~/Applications/Computer MCP Helper.app`
- [ ] Helper Bundle ID remains `fan.fde.computermcp.helper`
- [ ] no macOS Accessibility/Screen Recording permission regression

## Data safety

- [ ] verifier scratch removed
- [ ] real M2/M3/session stores not polluted by tests
- [ ] no secrets staged in Git
- [ ] production environment permissions remain restricted

## Git

- [ ] intended files staged
- [ ] unrelated artifacts excluded
- [ ] commit created
- [ ] pushed branch matches local HEAD

## 1.0 additional gates

- [ ] state migrations verified
- [ ] drain/handoff verified
- [ ] upgrade/rollback integration verified
- [ ] fault-injection suite green
- [ ] long soak green
- [ ] ABI/contract freeze documented
- [ ] 24-hour soak clean
- [ ] personal dogfood complete
- [ ] Helper identity/version stability verified
- [ ] Native Helper matches the frozen 1.x production baseline or an intentional independently versioned Helper release has passed signing/TCC validation
