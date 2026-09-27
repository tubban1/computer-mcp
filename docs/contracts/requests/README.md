# Runtime Contract Requests

This directory records generic OWL Runtime capabilities that `computer-mcp` needs but must not implement as a second Runtime subsystem.

Use one Markdown file per request.

## Template

```text
CONTRACT REQUEST
Consumer: computer-mcp
Capability:
Why:
Blocking: Yes | No
Temporary path: legacy backend | disabled | compatibility alias
Required semantics:
- ...

Acceptance tests:
- ...
```

## Rules

- A request is not permission to copy Runtime logic into computer-mcp.
- Keep the legacy implementation only when needed for personal-use stability.
- Once OWL Runtime publishes a public contract, add a consumer conformance test before switching.
- Remove the legacy implementation only after real dogfood evidence.
