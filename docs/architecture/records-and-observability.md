# Records, audit, and observability

Computer MCP records enough durable state to recover work and explain important actions, but it should not become a surveillance system. The default principle is **local-first, purpose-limited, redacted, and user-inspectable**.

## Records already implemented

### Tool audit log

`audit.jsonl` records tool name, timestamp, success/error, duration, sanitized arguments, and error text. Sensitive argument classes such as command, content, text, patches, URLs, step payloads, and results are stored as redacted byte counts plus SHA-256 digests instead of raw values.

### Persistent task history

Encrypted task records contain task status, step states, dependencies, attempts, timing, retry policy, risk level, side effects, verification requirements, resources, results/errors, recovery notes, and lifecycle events. Task staging records intermediate artifacts and manifests.

### Managed process history

Encrypted process records track command execution ownership and lifecycle: PID, workspace, read/write mode, owner session/logical owner/task, runtime instance, status, exit information, orphan/recovery state, and log paths. Process stdout/stderr are retained separately for inspection.

### Transactions and workspace coordination

Transactions persist checkpoint/patch metadata. Workspace leases record durable ownership; workspace handoff receipts record requested, releasing, released, completed, or cancelled ownership transfer states.

### Scheduler and loop state

Encrypted schedule records preserve triggers, next runs, task linkage, stop conditions, and execution state. Encrypted loop records preserve phases, cycle/transition counters, next run, task linkage, outputs, hashes, stop reason, and last errors.

### Session-adapter state

Encrypted ChatGPT/Antigravity/browser session bindings can preserve locator metadata, fingerprints, snapshots, last captured replies, sent-message receipts, pending sends, and turn counters. WeChat session bindings similarly preserve contact binding, observed/delivered digests, visible text/replies, send receipts, probe/capture timing, and focus-hold information.

### Memory records

M2 episodic memory stores encrypted summaries of terminal task evidence. M3 semantic memory stores encrypted promoted facts, preferences, procedures, patterns, or decisions together with promotion-gate receipts and sensitivity classification. Promotion is explicit and gated rather than automatic.

### Runtime and release state

Versioned runtime state supports migrations and recovery. Production release directories, the `current` symlink, launchd state, Helper identity/fingerprint rules, tunnel configuration, and onboarding receipts provide operational provenance.

### Performance and health observations

Warm MCP latency samples and health/concurrency/session/resource diagnostics are currently bounded in-memory observations rather than a permanent user-history database. Soak tests and verification scripts can emit separate evidence artifacts during release work.

## Important current gaps

There is not yet one unified event ledger that correlates a ChatGPT request with every task, skill, primitive, process, file mutation, approval, and external side effect. Approval is enforced through `confirm=true`, action contracts, and verification rules, but there is not yet a centralized durable Approval Ledger. Performance telemetry is mostly ephemeral. Retention and cleanup are subsystem-specific rather than governed by one user-facing policy.

## Recommended future records

### Unified Run Ledger

Create one append-only logical run history with correlation IDs for owner, transport session, ChatGPT turn/request, skill, primitive, task, schedule/loop, process, and resulting artifacts. Store outcome and timing by default; store raw content only when explicitly required.

### Approval Ledger

Record what consequential action was proposed, its sanitized argument digest, risk/policy version, whether the user approved/denied/expired it, approval scope, and the final side-effect receipt. This becomes the source for a user-facing **Approval History**.

### Artifact provenance

For files, Git changes, generated documents, uploads, and external objects, record source IDs, before/after hashes, producing task/skill, validation evidence, destination, and rollback reference. This makes “what changed my computer?” answerable.

### Recovery and incident ledger

Record crashes, reconnects, stream interruptions, request timeouts, orphaned/reclaimed processes, stale-session reclamation, lease contention, automatic restart, rollback, and recovery outcome with causal correlation IDs.

### Permission and security history

Record permission checks and changes, privileged escape-hatch use, Native Helper identity/version, capability policy changes, denied path accesses, secret-configuration changes without secret values, and suspicious repeated failures.

### Product-quality telemetry

Opt-in, content-free metrics can measure task success rate, retries, latency, cancellation, approval friction, background completion, fallback frequency, time saved, and top failing capabilities. These are useful for improving the product without uploading conversation or file contents.

### Cost and resource accounting

Record per-run CPU/runtime duration, model/API cost when known, bytes transferred, storage growth, browser/process runtime, and tunnel activity summaries. This supports quotas, pricing, and identifying expensive automation.

### Capability evidence instead of rigid UI trajectories

Do not treat one successful click-by-click UI path as a permanent universal Skill. Record reusable evidence at a higher level: intent, application/version, observed UI anchors, successful primitive pattern, fallbacks, verifier result, and confidence. UI-specific click sequences should expire or be revalidated when the app version/layout changes.

### Retention, export, and deletion receipts

Add one policy surface that defines TTL by record class, user pinning, automatic compaction, secure deletion, key rotation, export, and a deletion receipt. Sensitive process output and session text should have shorter defaults than non-content operational metadata.

## Product surfaces these records enable

A future Computer MCP/OWL Worker UI can expose **Run History**, **Needs Attention**, **Approvals**, **Artifacts Changed**, **Why did this happen?**, **Recovery History**, **Device Health**, and **Time/Cost Saved** from the same correlated record model rather than maintaining separate ad-hoc logs.
