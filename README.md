# computer-mcp

A personal Computer MCP server for connecting ChatGPT to controlled folders, shell processes, and Git on your Mac.

## v0.3

v0.3 focuses on safer long-term use and faster coding workflows.

### 30 tools

**Read/search**
- `list_directory`, `list_directory_tree`
- `read_file`, `read_multiple_files`
- `file_info`, `search_files`
- `get_capabilities`, `get_audit_log`

**Write/edit**
- `create_directory`, `write_file`, `append_file`
- `edit_file`, `batch_edit_files`
- `move_path`, `copy_path`, `delete_path`

**Shell/process**
- `execute_command`, `start_process`, `list_processes`
- `send_process_input`, `get_process_output`, `kill_process`

**Git**
- `git_status`, `git_diff`, `git_log`
- `git_add`, `git_commit`, `git_pull`, `git_push`
- `apply_patch`

## Safety model

Filesystem operations are constrained to `ALLOWED_DIRECTORIES` with real-path checks to reduce symlink escapes.

Capabilities:
- `ALLOW_WRITE` — defaults to `true`
- `ALLOW_DELETE` — defaults to `false`
- `ALLOW_SHELL` — defaults to `false`
- `ALLOW_GIT_PUSH` — defaults to `false`

**Important:** shell commands are not sandboxed by `ALLOWED_DIRECTORIES`. When `ALLOW_SHELL=true`, commands run with the permissions of the macOS user running computer-mcp.

Every tool now advertises MCP behavior annotations such as read-only/destructive/idempotent/open-world hints so compatible clients can make better permission decisions.

## Audit log

Tool calls are logged as JSONL by default to:

```text
~/.computer-mcp/audit.jsonl
```

The audit log intentionally redacts or hashes sensitive payload fields including:
- file contents
- exact old/new replacement text
- unified patches
- shell commands
- process stdin

Paths, tool names, timestamps, duration, success/error state, and non-sensitive parameters remain visible.

Disable or relocate it with:

```env
AUDIT_LOG_ENABLED=false
AUDIT_LOG_PATH=/custom/path/audit.jsonl
```

## Faster coding workflow

For multi-file changes, prefer:

1. `read_multiple_files`
2. `batch_edit_files`
3. `git_diff`
4. `git_add`
5. `git_commit`
6. `git_push`

This avoids repeated round trips for simple edits across several files.

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
