# L1 Primitive ISA Review

Status: **draft for AgentOS Runtime v1.0**

This document reviews the 24 v0.9 Primitive families before the L1 ISA is frozen for 1.x compatibility.

The goal is not to minimize the count at all costs. The goal is to make the ISA:

- orthogonal
- stable
- composable
- small enough for reliable planning
- independent from individual apps/providers where practical
- explicit about privileged escape hatches
- free of duplicate ways to express the same operation

## Review summary

The current v0.9 ISA is already a strong base, but it still contains several transitional artifacts from the earlier direct-tool architecture.

The most important issues are:

1. `ui.query` and `app.lifecycle` both expose frontmost/window-bounds operations.
2. `web.query.tabs` and `web.session.tabs` duplicate the same capability.
3. `web.transfer.screenshot` is not a transfer operation.
4. Helper permission/bootstrap operations currently leak into `app.lifecycle`.
5. `fs.query` is effectively a one-op stat primitive and should be named explicitly.
6. `sys.exec` is an escape hatch, not a normal capability family, and should be marked privileged.
7. `tx.manage` belongs to runtime control rather than environment interaction, but is still useful as an L1 runtime primitive.

## Primitive-by-primitive decision

| Current primitive | Decision | v1 direction |
| --- | --- | --- |
| `provider.status` | KEEP | Provider health/capability introspection only |
| `vision.capture` | KEEP / EXPAND | Own all visual capture: desktop screen/region and browser page |
| `ui.query` | KEEP / NARROW | UI tree/find only; remove app frontmost/bounds |
| `pointer.click` | KEEP / GENERALIZE LATER | Keep now; future pointer action may add scroll/drag/move |
| `keyboard.type` | KEEP | Text insertion |
| `keyboard.press` | KEEP | Keys/shortcuts |
| `clipboard` | KEEP | Strong perception + interaction channel |
| `app.lifecycle` | KEEP / CLEAN | launch/frontmost/bounds; remove helper permission admin ops |
| `web.open` | KEEP | Navigation |
| `web.query` | KEEP / NARROW | snapshot/find; remove tabs |
| `web.act` | KEEP | click/type/use_tab for now |
| `web.transfer` | KEEP / NARROW | upload/download only; remove screenshot |
| `web.session` | KEEP | tabs/close/session state |
| `fs.read` | KEEP | one/many |
| `fs.write` | KEEP | write/append/edit/batch_edit |
| `fs.list` | KEEP | directory/tree |
| `fs.query` | RENAME BEFORE 1.0 | candidate: `fs.stat` |
| `fs.manage` | KEEP | mkdir/move/copy/delete |
| `fs.search` | KEEP / EXPAND CAREFULLY | names now; content search may become an op |
| `process.manage` | KEEP | start/list/input/output/kill |
| `sys.exec` | KEEP AS PRIVILEGED EXTENSION | explicit escape hatch; not preferred by planner |
| `git.query` | KEEP | status/diff/log |
| `git.mutate` | KEEP | add/commit/pull/push/patch |
| `tx.manage` | KEEP AS RUNTIME PRIMITIVE | checkpoint lifecycle |

## Proposed v1 core ISA

### Perception

```text
provider.status
vision.capture
ui.query
clipboard
app.lifecycle
web.query
web.session
fs.read
fs.list
fs.stat
fs.search
git.query
```

### Interaction

```text
pointer.click
keyboard.type
keyboard.press
web.open
web.act
web.transfer
fs.write
fs.manage
process.manage
git.mutate
```

### Runtime control

```text
tx.manage
```

### Privileged extension

```text
sys.exec
```

The privileged extension remains available, but Capability Manifest guidance should prefer a typed Primitive or Skill whenever one exists.

## Specific cleanup before freeze

### 1. Remove duplicate app-state queries

Current duplication:

```text
ui.query(frontmost)
ui.query(bounds)

app.lifecycle(frontmost)
app.lifecycle(bounds)
```

Target:

```text
ui.query(tree)
ui.query(find)

app.lifecycle(launch)
app.lifecycle(frontmost)
app.lifecycle(bounds)
```

This gives one canonical path for application/window state.

### 2. Remove duplicate web tabs

Current:

```text
web.query(tabs)
web.session(tabs)
```

Target:

```text
web.query(snapshot)
web.query(find)

web.session(tabs)
web.session(close)
```

### 3. Move screenshots into vision.capture

Current:

```text
vision.capture(screen)
vision.capture(region)
web.transfer(screenshot)
```

Target:

```text
vision.capture(screen)
vision.capture(region)
vision.capture(page)
```

Then `web.transfer` is strictly file transfer.

### 4. Remove setup/admin operations from app.lifecycle

Current transitional ops:

```text
app.lifecycle(helper_status)
app.lifecycle(request_permissions)
```

These exist for setup and diagnostics, but they are not application lifecycle primitives.

They should remain reachable through provider/admin diagnostics rather than the frozen L1 ISA.

### 5. Rename fs.query → fs.stat

`fs.query(info)` is semantically vague.

Candidate v1 form:

```text
fs.stat(get)
```

This rename should happen before the 1.0 compatibility promise.

### 6. Mark sys.exec as privileged

`sys.exec` can bypass typed abstractions and therefore should be treated differently from normal primitives.

Suggested manifest metadata:

```json
{
  "tier": "privileged",
  "preferTypedAlternative": true
}
```

It remains essential as an escape hatch, bootstrap mechanism, and developer tool.

## What should NOT be in L1

L1 should not contain app-specific workflows such as:

```text
wechat.read_points
wechat.send
xhs.publish
email.compose
```

Those belong in L2 Skills.

L1 should also not expose individual provider actions such as:

```text
desktop.clipboard_copy_selection
browser.upload
shell.exec
git.push
```

Those are L0.5 Actions.

## ABI versioning proposal

Add an explicit Primitive ABI version:

```text
agentos.primitive_abi = 1
```

Each catalog entry should eventually expose:

```text
id
abiVersion
domain
description
ops
stability
tier
deprecated
replacement
```

Suggested stability values:

```text
experimental
candidate
stable
deprecated
```

During v0.9.x, all primitives remain `candidate`.

At v1.0, the selected set becomes `stable`.

## Compatibility policy for 1.x

After v1.0:

- stable Primitive IDs are not renamed within 1.x
- existing stable ops are not removed within 1.x
- new optional ops may be added only when semantics remain coherent
- breaking changes require ABI v2
- deprecated entries remain routable for at least one major ABI generation
- Skills should depend on Primitive ABI, not provider-specific actions, whenever practical

## Next implementation steps

1. Add Primitive metadata: ABI version, stability, tier, deprecation/replacement.
2. Apply the four non-breaking/low-risk cleanup changes where possible.
3. Introduce aliases for any renamed Primitive during the v0.9 transition.
4. Migrate built-in Skills away from direct routed Actions toward Primitive calls.
5. Add conformance tests for every Primitive family.
6. Freeze the L1 candidate set before AgentOS Runtime v1.0.
