# OWL Publish M9: secure local HTTPS + YouTube upload reconciliation

Date: 2026-10-14. Work directly on main. No live network/OAuth/publication.

Modules: src/providers/publishHttpsTransport.ts validates exact Google/Meta HTTPS hosts/routes, pins a public IPv4 address to TLS, forbids redirects, cookies/proxies and header injection, caps request/response and times out. It is NOT bound to the production Publish Provider. src/providers/publishYoutubeResume.ts sends an empty official PUT Content-Range status query and parses validated 308 Range next offset; does not automatically retransmit media or publish.

Corrections: truncated/hidden/unsafe approval parameters cannot be signed. The M7 fake provider requires actual caption SHA256, OAuth account target ID matching the selected platform channel/Professional account, and YouTube videos.list returned video ID, snippet.channelId and status.privacyStatus=private. Instagram never calls media_publish during staging.

Verification: npm run verify:publish-m9 (no actual network, fake DNS/TLS, negative checks for private IP, redirects, Host/cookie/header injection, incomplete approval preview, invalid 308 ranges/host); build and M5-M8 regression.

Release gates: Real Google/Meta Desktop OS-vault OAuth, verified selected account+provider permissions, signed managed Runtime 1.x, controlled live transport activation, full persisted ranged upload/recovery, processing readback, and distinct Instagram public-post user approval. Free/legal-only, zero paid incremental calls, defensive per-brand $1/month cap stay mandatory.

User-provided Google/Instagram handles are account hints, not proof of OAuth authorization. No API tokens stored here; no uploaded or published video, process restart, push, deployment or fee.
