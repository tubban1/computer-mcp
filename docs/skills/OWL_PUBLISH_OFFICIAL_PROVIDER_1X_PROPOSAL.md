# OWL Publish official Provider ABI v1 — Runtime 1.x proposal

Date: 2026-10-14
Status: PROPOSED ONLY / NOT IMPLEMENTED / NOT ENABLED.
Requester: local socialMedia/app/owl_publish. Owner: owl-runtime 1.x.
The frozen Runtime 1.0.0-rc.4 code/ABI must remain unchanged.

## Canonical topology

ChatGPT -> OWL LAB MCP -> LOCAL OWL Runtime durable Task (permission, approval, leases, replay) -> approved local OWL Publish Provider -> official social API.

Cloud is optional for Publish and is not an execution/scheduling authority. Existing device enrollment/lease controls remain independently enforced. Publish cannot introduce a second scheduler or hide platform calls behind sys.exec or fs.read.

## Current implementation evidence

- src/providers/registry.ts statically enumerates filesystem/shell/git/transaction/browser/desktop; it currently exposes no installable Publish Provider.
- src/skills/userSkillRuntime.ts forbids sys.exec in a User Skill.
- src/policy/approvalPolicy.ts binds approvals to exact-argument fingerprints and session/task/step identity. Current OWL_APPROVAL_MODE default compat is **not acceptable** for consequential Publish. Required: enforce mode plus specifically configured Publish action coverage, or equivalent always-enforced new capability.
- The M2 read-only Publish Candidate was validated in isolation, but not promoted and has no publishing capability.

## Proposed action catalog (feature-detected under extensions.officialPublishProvider.version=1)

| Action | Effect | Required gate |
| --- | --- | --- |
| publish.account.inspect | read | local account OAuth and binding |
| publish.youtube.upload.initiate_private | write / possible video creation | human-approved immutable target + actual Runtime approval |
| publish.youtube.upload.probe | read | bound upload session and quota |
| publish.youtube.upload.continue | write bytes | prior approval and immutable upload identity |
| publish.youtube.video.inspect | read | channel+video receipt verification |
| publish.instagram.container.create | write | bounded signed video URL and exact approval |
| publish.instagram.container.inspect | read | bound container, never infer public |
| publish.instagram.reel.publish | PUBLIC side effect | fresh exact public-post approval; container FINISHED |
| publish.instagram.media.inspect | read | verify media ID/account/link, independent public visibility |

Each action declares typed args, risk, sideEffects, honest idempotency and retryPolicy, requiresVerification, and exclusive resource lease per brand/account/publishTarget. Treat YouTube session initiation and Instagram container creation as consequential even if content remains private.

## Stable effect identity and approvals

Exact action identity must include:
- org/profile + brand, bound account vault reference, platform and route
- immutable media SHA256, caption/thumbnail SHA256, rights+synthetic label proof
- approved target revision SHA256, schedule, intended visibility, policy revision
- stable effectKey, canonical Runtime taskId and stepId
- capability/tariff/quota evidence digest + one-time Runtime action approval ID

Two **independent** authorizations are required: (1) user reviews/approves exact content/account/visibility; (2) Runtime one-time **enforced** approval bound to the action fingerprint and task/step. A `fake_runtime_review` in socialMedia tests is not authorization. Approval expiry, changes or revocation block execution. No credential/token/session URL in task args, logs, Git or Cloud telemetry.

## Free-only cost control

FREE_LEGAL_ONLY, API maximum incremental charge $0, monthly defensive USD $1 per local brand, never license to spend $1. Verify current official grant, tariff, quota and no overage auto-billing; reject unknown price, unsupported account or action, closed quota and stale policy. Require provider-side charge limits; local SQLite alone cannot prevent third-party billing. Keep quotas and money separate.

## Crash/recovery semantics

1. Persist immutable intent/effectKey and acquire Runtime exclusive lease BEFORE any network side effect. Atomically bind local business claim and Runtime task identity where the public contract allows it; no second scheduler.
2. YouTube: store resumable session URI in encrypted local vault only. On network loss probe previous session with PUT `Content-Range: bytes */N`; interpret HTTP 308 Range; 404 or unknown => UNCERTAIN/human reconciliation, never blindly start a second video. Real `videos.list` must match authenticated channel, processing and privacy.
3. Instagram: preserve creation/container ID, poll until FINISHED, then require separate exact public-post approval for `media_publish`. Loss of media_publish response => UNCERTAIN and reconciliation; no automatic replay. Readback existence does not guarantee public visibility.
4. All provider URLs are HTTPS pinned to exact official hosts/paths; DNS rebinding, redirects, private/loopback/link-local/metadata IPs, credential leaks and signed media URLs must be blocked in **actual transport**.
5. Human-assisted UI is not equivalent to self-driving browser automation. Only automate Browser/Computer actions explicitly permitted by the specific platform. No CAPTCHA/2FA bypass.

## Multi-repo ownership

- owl-runtime 1.x: Provider/Action and policy/approval/verification/leases/durable tasks
- owl-desktop: vault and user-aware OAuth/permission UI, no scheduler
- socialMedia: adapter protocol, brand-level policy, local ledger and content receipts
- motion-lab: assets and QC; no publish credential
- owl-cloud: optional mirror/analytics, never required for local Publish operations

## Release gates and user testing

G0: Pure protocol parser + request builder tests (YouTube+Instagram). No network.
G1: Dedicated Provider registered under feature-detected Runtime 1.x extension, all effects gated by enforce mode; crash/duplicate delivery/approval denial tested with fake transport and ephemeral state.
G2: OS-vault OAuth and per-account permissions authorized on local device; no API token supplied in ChatGPT.
G3: **User-approved YouTube private test video** first; obtain video ID, verify channel/privacy and no duplicated upload. Do not test public by default.
G4: Instagram eligible professional test account; **media_publish may be public**, so obtain separate per-post user confirmation before attempting it.
G5: Fault matrix (timeout-after-effect, upload resume, expired session, duplicate MCP request, revoked token, provider moderation, wrong account and quota). Only then enable a particular real brand/platform route.

Until G1-G5 pass, new Provider actions and automatic publishing default DISABLED. Production rc.4 remains untouched.

Sources checked Oct 2026:
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
