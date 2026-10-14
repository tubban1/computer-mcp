# OWL Publish M5 — isolated local Runtime Provider gate

Date: 2026-10-14 · Branch: feat/owl-publish-provider-m5
Status: **Mock Runtime integration tested; real publish disabled.**

## Implemented

- `src/providers/publishMockProvider.ts`: test-only, no HTTP/OAuth/browser/upload. Enabled exclusively when `OWL_RUNTIME_MODE=test`, `OWL_PUBLISH_MOCK_ENABLED=1`, `OWL_APPROVAL_MODE=enforce`. Disabled in production/development. Receipt includes `kind=MOCK_ONLY`, `status=MOCK_NOT_PUBLIC` and `livePublishingEnabled=false`.
- `src/router/actionRouter.ts`: strict typed `publish.mock_effect` and `publish.mock_inspect` actions; validated account/brand/target/content digests, visibility, FREE_LEGAL_ONLY, and incremental API charge exactly $0.
- `src/runtime/actionContracts.ts`: high risk, explicit local mock side-effect, no automatic retry, exclusive per-effect resource lock, verification required.
- `src/policy/approvalPolicy.ts`: mock effect requires approval even under compatibility mode; Provider refuses to run unless enforce mode is active.
- `src/providers/registry.ts` and `types.ts`: publish-mock capability discovery, no live social provider.
- `scripts/verify-publish-provider-m5.ts`: real isolated Runtime Persistent Task and exact step/approval test. Receipt writes are fully flushed then published via atomic link create-if-absent; duplicate effect keys reuse receipt, changed intent conflicts.

## Passing M5 acceptance

1. Real InProcessRuntimeClient task initially `waiting_approval` and no mock receipt.
2. Explicit approved Task+Step resumes the **same** task, completes with one MOCK_ONLY receipt.
3. Twelve repeated effect calls create zero additional receipts; changing the account on the same effect key is rejected.
4. Denying an independent Task prevents any effect.
5. Development/production and compatibility approval mode reject publish-mock even when a caller knows the action ID.
6. TypeScript typecheck and branch build pass.

To verify in this feature worktree: `npm run typecheck` and `npm run verify:publish-m5`. Test creates and cleans its own isolated Runtime state.

## Important limitations

- Real YouTube/Instagram API transport, OAuth token vault, provider-side overage caps, local brand budget ledger binding, actual content approval receipt and external post reconciliation **are not connected**. A provided test boolean `humanContentApproved=true` is not real approval and could not authorize a live operation. Do not misrepresent `MOCK_ONLY` as published media.
- Frozen production rc.4 Runtime, main branch, Cloud and social accounts are unchanged. No live upload/fees.
- Legacy Runtime generic regression scripts may inherit `OWL_STATE_ROOT=$HOME/.owl-runtime-dev` from OWL MCP shells, overriding scripts that only set `AGENTOS_STATE_ROOT`. Old approval tests were observed to fail under mixed/inconsistent isolation, while approval-policy and approval-resume diagnostic reruns passed when properly isolated. Do not claim whole legacy suite passed. Leave existing development task records alone.

## Next stages and user gate

G1: production-safe governed provider transport with official HTTPS host/redirect/DNS controls, secure macOS Keychain OAuth, real Runtime exact-action approval and a durable no-blind-retry effect journal; verify in mock/sandbox before enabling anything.
G2: after G1, ask account holder to approve local Google OAuth for **their** YouTube channel and one PRIVATE sample upload. No password/token sent through ChatGPT.
G3: later eligible Instagram professional OAuth and separately approved Reel media_publish (may be public), then fault recovery and visibility tests.

**No user action or social account testing is required yet.**
