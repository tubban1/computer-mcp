# OWL Publish M7 - official protocol offline acceptance

Date: 2026-10-14
Branch: feat/owl-publish-official-local-m7
Status: OFFLINE TEST ONLY. NO LIVE API, OAUTH, DEPLOYMENT OR SOCIAL PUBLISHING.

Local Runtime actions:
- publish.official_upload_test: requires M6 exact human-signed Task approval and injected fake HTTP/OAuth/budget ports. No network adapter is connected in production.
- publish.official_inspect: inspect local journal, not remote social status.

YouTube: private-only videos.insert resumable POST, safe upload URL, video PUT, privacy GET verification. 308 results UNCERTAIN, never blind retry. Current M7 pilot caps MP4 at 64 MiB.
Instagram: Facebook Login Professional/Page route, container with resumable local upload and GET status; remains READY_TO_PUBLISH, no media_publish. The Instagram Login and Facebook Login scopes are not interchangeable.

Both: free-legal-only, zero incremental paid API calls, per-brand defensive one-dollar monthly budget check, OAuth account+scope matching, digest, HTTPS host pinned, durable write-ahead journal, exact effect fingerprint. Unknown outcome blocks automatic retry.

Acceptance: Runtime real Task waits for approval; unsigned Agent self-approval rejected; signed approval resumes same Task; mocked Google status is private; Meta staging finishes but never posts; duplicate effects blocked. Malicious upload destination, invalid account/scope, cost rejection, invalid file hash and wrong privacy response are rejected.

Incomplete M8: OS-vault OAuth, actual TLS transport and redirect=manual/DNS protection, full video streaming/308 recovery, asynchronous status polling, final Instagram publish separately approved, real platform acceptance, verified packaged Runtime 1.x build. No account was touched, no charges.

User gate: authorize own Google YouTube channel via Desktop and approve PRIVATE test upload. Instagram requires professional account, Page-linked Meta app and separate explicit PUBLIC publication approval.
