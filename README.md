# computer-mcp

A personal Computer MCP server for connecting ChatGPT to controlled folders, shell processes, Git, and recoverable coding workflows on your Mac.

## v0.4

v0.4 adds Git-backed task transactions, automatic checkpoints, rollback, and failure recovery.

### Transaction tools

- `begin_transaction`
- `transaction_status`
- `list_transactions`
- `rollback_transaction`
- `complete_transaction`
- `execute_command_transactional`

A transaction checkpoint captures the repository worktree, including tracked and untracked non-ignored files, without changing the real Git index or branch.

Rollback:
- restores the checkpoint worktree;
- restores the original HEAD and staged patch;
- removes new untracked non-ignored files created after the checkpoint;
- creates a hidden safety ref before rewinding commits.

Ignored files and external/network side effects are intentionally not rolled back.

## Tool count

v0.4 exposes **36 tools** across:

- filesystem read/search/write
- shell and managed processes
- Git
- audit/capability introspection
- recoverable transactions

## Recommended coding workflow

For a normal code task:

1. `begin_transaction`
2. `read_multiple_files` / `list_directory_tree`
3. `batch_edit_files` or `apply_patch`
4. `git_diff`
5. run verification
6. `git_add` → `git_commit` → `git_push`
7. `complete_transaction`

If anything goes badly:

```text
rollback_transaction(transaction_id)
```

For commands that may generate or rewrite repository files, use:

```text
execute_command_transactional
```

It automatically creates a checkpoint and rolls repository files back on non-zero exit or timeout.

## Safety model

Filesystem operations are constrained to `ALLOWED_DIRECTORIES` with real-path checks.

Capability flags:

```env
ALLOW_WRITE=true
ALLOW_DELETE=false
ALLOW_SHELL=false
ALLOW_GIT_PUSH=false
ALLOW_ROLLBACK=false
```

`ALLOW_ROLLBACK` is separate because rollback may rewind commits on the current branch. Before doing so, computer-mcp creates a hidden recovery ref under:

```text
refs/computer-mcp/pre-rollback/
```

Shell execution is not sandboxed by `ALLOWED_DIRECTORIES`; shell commands run with the permissions of the macOS user running the server.

## MCP annotations

All tools advertise read-only, destructive, idempotent, and open-world hints where appropriate so compatible clients can make better permission decisions.

## Audit log

Privacy-aware JSONL audit logging is enabled by default:

```text
~/.computer-mcp/audit.jsonl
```

Sensitive payloads such as file contents, patches, shell commands, replacement text, and process input are redacted and hashed.

## Install

```bash
git clone https://github.com/tubban1/computer-mcp.git
cd computer-mcp
npm install
cp .env.example .env
```

Example personal-development configuration:

```env
PORT=8787
ALLOWED_DIRECTORIES=/Users/wahaha/Documents/Me/Project/cursor
ALLOW_WRITE=true
ALLOW_DELETE=true
ALLOW_SHELL=true
ALLOW_GIT_PUSH=true
ALLOW_ROLLBACK=true
AUDIT_LOG_ENABLED=true
```

## Run

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

After changing tool definitions, restart the local server and tunnel client, then refresh/reconnect the ChatGPT app so it rescans the tool catalog.
