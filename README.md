# computer-mcp

A personal Computer MCP server for connecting ChatGPT (or another MCP client) to a controlled set of folders on your Mac.

## v0.2 capabilities

### Filesystem
- `list_directory`
- `read_file`
- `file_info`
- `search_files`
- `create_directory`
- `write_file`
- `append_file`
- `edit_file`
- `move_path`
- `copy_path`
- `delete_path`

### Shell / processes
- `execute_command`
- `start_process`
- `list_processes`
- `get_process_output`
- `send_process_input`
- `kill_process`

### Git
- `git_status`
- `git_diff`
- `git_log`
- `git_add`
- `git_commit`
- `git_pull`
- `git_push`
- `apply_patch`

## Security model

Filesystem tools are constrained to `ALLOWED_DIRECTORIES` and real paths are checked to reduce symlink escapes.

Write operations are controlled by:
- `ALLOW_WRITE` — defaults to enabled
- `ALLOW_DELETE` — defaults to disabled
- `ALLOW_SHELL` — defaults to disabled
- `ALLOW_GIT_PUSH` — defaults to disabled

**Important:** `ALLOW_SHELL=true` grants arbitrary shell execution under your macOS user account. `ALLOWED_DIRECTORIES` does not sandbox shell commands. Only enable it for a trusted personal MCP.

Git operations disable repository hooks for MCP-issued Git commands.

## Install

```bash
git clone https://github.com/tubban1/computer-mcp.git
cd computer-mcp
npm install
cp .env.example .env
```

Edit `.env`:

```env
PORT=8787
ALLOWED_DIRECTORIES=/Users/YOUR_MAC_USERNAME/Documents/Me/Project/cursor
ALLOW_WRITE=true
ALLOW_DELETE=true
ALLOW_SHELL=true
ALLOW_GIT_PUSH=true
```

For a narrower setup, keep destructive/shell flags false until needed.

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

## ChatGPT + Secure MCP Tunnel

Keep two processes running:

```bash
# Terminal 1
npm run dev
```

```bash
# Terminal 2
./tunnel-client-runtime run
```

After upgrading the MCP server, restart `npm run dev` and refresh/reconnect the ChatGPT app so it rescans the tool list.

## Recommended permission boundary

Prefer a project root such as:

```text
/Users/wahaha/Documents/Me/Project/cursor
```

instead of your whole home directory.

For high-risk operations such as deletion, shell execution, and remote Git push, use ChatGPT's plugin permission controls so the app asks before making changes.
