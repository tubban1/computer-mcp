# Git Push default — solo-developer OWL LAB

Git Push is an ordinary developer operation: ALLOW_GIT_PUSH=true by default, with no routine per-action human approval. Explicit ALLOW_GIT_PUSH=false or Desktop Blocked disables it. Git credentials, user intent, cloud leases and workspace constraints still apply.

Runtime git operations, provider status and API capability status all use default true. git.push is absent from the default approval list and scoped per-action permission gate. Deletion and rollback default off and remain separately governed by approval policy. A test pushes only to a temporary local bare repository to prove no default human approval and verifies an explicit false blocks push; no GitHub network access.

Desktop dev:full defaults true. Managed packaged Runtime migrates an old inherited false runtime.env setting to true unless the user deliberately selected Blocked, removes obsolete auto-generated git.push approval policy, and renders Git Push as Enabled / Blocked, never Review each action.

Saved settings do not mutate the running Runtime. Apply on next deliberate Runtime/development process start. Do not restart unrelated connections or push the real user's repos as part of policy verification.
