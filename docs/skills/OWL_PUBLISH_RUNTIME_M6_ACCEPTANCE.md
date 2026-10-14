# OWL Publish Runtime M6 — scoped signed approval gate

Date: 2026-10-14. Branch: feat/owl-publish-runtime-authz-m6.
Status: ISOLATED FEATURE; NOT INSTALLED OR DEPLOYED.

Canonical flow: ChatGPT -> OWL LAB MCP -> LOCAL Runtime Task -> exact action -> verified signed human approval -> temporary scoped capability -> local Publish Provider -> future official API.

Delivered:
- Ed25519 public-only Runtime signature verification for approval ID, argument fingerprint, originating session, task, step and expiry; generic RPC/Skill approval without signature fails closed when M6 is enabled.
- Whitelisted safe review fields; Publish brand/account/visibility/revision visible. Shell raw command hidden; incomplete preview cannot be signed by Desktop.
- Optional proof routed through RuntimeClient, HTTP and Runtime RPC. Public DTO omits proof signature.
- AsyncLocalStorage grants one-action, one-task/step capability within 60s after verified one-time approval. Only actions explicitly named in OWL_SCOPED_ACTION_ALLOWLIST may receive temporary privilege. Blocked actions not selected for Review stay blocked. Runtime process.env is never modified.
- OWL Publish M5 local MOCK_ONLY provider remains offline. No credentials or social posting.

Activation: requires OWL_HUMAN_APPROVAL_ENFORCE=1, OWL_SCOPED_CAPABILITIES=1, OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64 and explicit OWL_SCOPED_ACTION_ALLOWLIST. Default OFF. The private key must remain in the Desktop OS secure store, not Runtime, MCP or Cloud.

Verified:
- Runtime build PASSED.
- Legacy approval-policy PASSED.
- Publish M5 and M6 task suites PASSED: prior approval blocks effect, signed approval resumes same task, 12 replay attempts create one fake receipt, denial creates nothing, unauthenticated self-approval fails, temporary file deletion works with ALLOW_DELETE=false only under signed scoped action, afterwards still denied.
- Cross-repo Desktop signature verified, changing Step rejects signature, incomplete Shell review rejected.

Release blockers:
1. Runtime branch source version is still frozen rc.4 for development; DO NOT relabel rc.4 as 1.x. A separately packaged and verified Runtime 1.x artifact must include humanApprovalSignatureV1 and scopedCapabilityV1 capabilities in component metadata. Desktop refuses to activate Review against rc.4.
2. Electron native user confirmation and safeStorage software key exist on the separate Desktop M6 branch, but OS-secure hardware-backed presence/anti-GUI-automation has not been formally proven. Do not auto-public-post with it until that risk is addressed.
3. No official live YouTube/Instagram Provider, OAuth account grants, resumable transport/reconciliation or audience visibility proof yet. OWL Publish route remains FREE_LEGAL_ONLY: no automatic paid API use, defensive $1/month/brand ceiling.
4. No merge, push, deployment, account authorization, platform post or production restart. No user test needed now.

Next mainline: implement dedicated offline-injected Runtime official API Provider and secure OAuth vault connection; then a user-authorized PRIVATE YouTube pilot; separate explicit Instagram public-publish approval.
