import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listDirectory } from "./tools/listDirectory.js";
import { readFile } from "./tools/readFile.js";
import {
  appendFile,
  batchEditFiles,
  copyPath,
  createDirectory,
  deletePath,
  editFile,
  getFileInfo,
  listDirectoryTree,
  movePath,
  readMultipleFiles,
  searchFiles,
  writeFile,
} from "./tools/fileOps.js";
import {
  executeCommand,
  getProcessOutput,
  killProcess,
  listProcesses,
  sendProcessInput,
  startProcess,
} from "./tools/shellOps.js";
import {
  applyPatch,
  gitAdd,
  gitCommit,
  gitDiff,
  gitLog,
  gitPull,
  gitPush,
  gitStatus,
} from "./tools/gitOps.js";
import {
  beginTransaction,
  completeTransaction,
  getTransactionStatus,
  listTransactions,
  rollbackTransaction,
} from "./tools/transactionOps.js";
import { appendAudit, getAuditLogPath, readAuditLog, sanitizeAuditArgs } from "./audit.js";
import { envFlag } from "./security/capabilities.js";
import { configuredRoots } from "./security/pathGuard.js";

type ToolAuditContext = {
  tool: string;
  args: unknown;
  startedAt: number;
  recorded: boolean;
};

const toolAuditContext = new AsyncLocalStorage<ToolAuditContext>();

function recordAudit(status: "success" | "error", error?: unknown) {
  const context = toolAuditContext.getStore();
  if (!context || context.recorded) return;
  context.recorded = true;

  void appendAudit({
    timestamp: new Date().toISOString(),
    tool: context.tool,
    status,
    durationMs: Date.now() - context.startedAt,
    args: sanitizeAuditArgs(context.args),
    ...(error
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
  }).catch((auditError) => {
    console.error("Failed to write audit log:", auditError);
  });
}

function ok(value: unknown) {
  recordAudit("success");
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function fail(error: unknown) {
  recordAudit("error", error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

function createServer() {
  const server = new McpServer({
    name: "computer-mcp",
    version: "0.4.0",
  });

  server.tool(
    "list_directory",
    "List files and folders inside an allowed local directory. Read-only.",
    { path: z.string().describe("Absolute local directory path") },
    {
      title: "List Directory",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path }) => {
      try {
        return ok(await listDirectory(path));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "read_file",
    "Read a UTF-8 text file inside an allowed local directory. Read-only; max 512 KiB.",
    { path: z.string().describe("Absolute local file path") },
    {
      title: "Read File",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path }) => {
      try {
        return ok(await readFile(path));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "file_info",
    "Get metadata for a file or directory inside an allowed root.",
    { path: z.string() },
    {
      title: "File Info",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path }) => {
      try {
        return ok(await getFileInfo(path));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "search_files",
    "Recursively search file and directory names below an allowed root. Symbolic links are not traversed.",
    {
      root_path: z.string(),
      query: z.string(),
      max_results: z.number().int().min(1).max(1000).optional(),
    },
    {
      title: "Search Files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ root_path, query, max_results }) => {
      try {
        return ok(await searchFiles(root_path, query, max_results));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "create_directory",
    "Create a directory inside an allowed root. Requires ALLOW_WRITE=true (enabled by default).",
    {
      path: z.string(),
      recursive: z.boolean().optional(),
    },
    {
      title: "Create Directory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path, recursive }) => {
      try {
        return ok(await createDirectory(path, recursive ?? true));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "write_file",
    "Create or replace a UTF-8 text file inside an allowed root. Requires ALLOW_WRITE=true.",
    {
      path: z.string(),
      content: z.string(),
      overwrite: z.boolean().optional(),
      create_parents: z.boolean().optional(),
    },
    {
      title: "Write File",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path, content, overwrite, create_parents }) => {
      try {
        return ok(await writeFile(path, content, overwrite ?? true, create_parents ?? true));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "append_file",
    "Append UTF-8 text to a file inside an allowed root. Requires ALLOW_WRITE=true.",
    {
      path: z.string(),
      content: z.string(),
    },
    {
      title: "Append File",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ path, content }) => {
      try {
        return ok(await appendFile(path, content));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "edit_file",
    "Perform an exact text replacement in a UTF-8 file. Safer than replacing the whole file. Requires ALLOW_WRITE=true.",
    {
      path: z.string(),
      old_text: z.string().min(1),
      new_text: z.string(),
      replace_all: z.boolean().optional(),
    },
    {
      title: "Edit File",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ path, old_text, new_text, replace_all }) => {
      try {
        return ok(await editFile(path, old_text, new_text, replace_all ?? false));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "move_path",
    "Move or rename a file/directory between allowed paths. Requires ALLOW_WRITE=true.",
    {
      source_path: z.string(),
      destination_path: z.string(),
    },
    {
      title: "Move or Rename Path",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ source_path, destination_path }) => {
      try {
        return ok(await movePath(source_path, destination_path));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "copy_path",
    "Copy a file or directory between allowed paths. Requires ALLOW_WRITE=true.",
    {
      source_path: z.string(),
      destination_path: z.string(),
      recursive: z.boolean().optional(),
    },
    {
      title: "Copy Path",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ source_path, destination_path, recursive }) => {
      try {
        return ok(await copyPath(source_path, destination_path, recursive ?? true));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "delete_path",
    "Delete a file or directory inside an allowed root. Destructive; requires ALLOW_DELETE=true.",
    {
      path: z.string(),
      recursive: z.boolean().optional(),
    },
    {
      title: "Delete Path",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ path, recursive }) => {
      try {
        return ok(await deletePath(path, recursive ?? false));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "execute_command",
    "Run a shell command with a working directory inside ALLOWED_DIRECTORIES. Powerful and not sandboxed; requires ALLOW_SHELL=true.",
    {
      command: z.string().min(1),
      cwd: z.string(),
      timeout_ms: z.number().int().min(1000).max(600000).optional(),
    },
    {
      title: "Execute Command",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ command, cwd, timeout_ms }) => {
      try {
        return ok(await executeCommand(command, cwd, timeout_ms ?? 60000));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "start_process",
    "Start a long-running shell process in an allowed working directory and return a process ID. Requires ALLOW_SHELL=true.",
    {
      command: z.string().min(1),
      cwd: z.string(),
    },
    {
      title: "Start Process",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ command, cwd }) => {
      try {
        return ok(await startProcess(command, cwd));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "list_processes",
    "List processes started by this computer-mcp instance.",
    {},
    {
      title: "List Managed Processes",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async () => {
      try {
        return ok(listProcesses());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "send_process_input",
    "Send text to stdin of a process started by this computer-mcp instance. Requires ALLOW_SHELL=true.",
    {
      process_id: z.string(),
      input: z.string(),
    },
    {
      title: "Send Process Input",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ process_id, input }) => {
      try {
        return ok(sendProcessInput(process_id, input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_process_output",
    "Read captured stdout/stderr from a process started by this computer-mcp instance.",
    {
      process_id: z.string(),
      tail_chars: z.number().int().min(1000).max(200000).optional(),
    },
    {
      title: "Get Process Output",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ process_id, tail_chars }) => {
      try {
        return ok(getProcessOutput(process_id, tail_chars ?? 20000));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "kill_process",
    "Stop a process started by this computer-mcp instance. Requires ALLOW_SHELL=true.",
    {
      process_id: z.string(),
      signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).optional(),
    },
    {
      title: "Kill Process",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ process_id, signal }) => {
      try {
        return ok(killProcess(process_id, signal ?? "SIGTERM"));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_status",
    "Show Git repository status for an allowed working directory.",
    { cwd: z.string() },
    {
      title: "Git Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ cwd }) => {
      try {
        return ok(await gitStatus(cwd));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_diff",
    "Show Git diff for an allowed repository.",
    {
      cwd: z.string(),
      staged: z.boolean().optional(),
    },
    {
      title: "Git Diff",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ cwd, staged }) => {
      try {
        return ok(await gitDiff(cwd, staged ?? false));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_log",
    "Show recent Git commits for an allowed repository.",
    {
      cwd: z.string(),
      max_count: z.number().int().min(1).max(100).optional(),
    },
    {
      title: "Git Log",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ cwd, max_count }) => {
      try {
        return ok(await gitLog(cwd, max_count ?? 20));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_add",
    "Stage paths in an allowed Git repository. Requires ALLOW_WRITE=true.",
    {
      cwd: z.string(),
      paths: z.array(z.string()).min(1),
    },
    {
      title: "Git Add",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ cwd, paths }) => {
      try {
        return ok(await gitAdd(cwd, paths));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_commit",
    "Create a Git commit in an allowed repository. Requires ALLOW_WRITE=true.",
    {
      cwd: z.string(),
      message: z.string().min(1),
    },
    {
      title: "Git Commit",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ cwd, message }) => {
      try {
        return ok(await gitCommit(cwd, message));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_pull",
    "Pull changes into an allowed Git repository. Requires ALLOW_WRITE=true.",
    {
      cwd: z.string(),
      remote: z.string().optional(),
      branch: z.string().optional(),
    },
    {
      title: "Git Pull",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ cwd, remote, branch }) => {
      try {
        return ok(await gitPull(cwd, remote, branch));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "git_push",
    "Push an allowed Git repository to its remote. Network side effect; requires ALLOW_GIT_PUSH=true.",
    {
      cwd: z.string(),
      remote: z.string().optional(),
      branch: z.string().optional(),
    },
    {
      title: "Git Push",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ cwd, remote, branch }) => {
      try {
        return ok(await gitPush(cwd, remote, branch));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "apply_patch",
    "Validate and apply a unified Git patch inside an allowed repository. Requires ALLOW_WRITE=true.",
    {
      cwd: z.string(),
      patch: z.string().min(1),
    },
    {
      title: "Apply Patch",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ cwd, patch }) => {
      try {
        return ok(await applyPatch(cwd, patch));
      } catch (error) {
        return fail(error);
      }
    },
  );


  server.tool(
    "read_multiple_files",
    "Read up to 50 UTF-8 text files in one call. Each file is limited to 512 KiB.",
    { paths: z.array(z.string()).min(1).max(50) },
    {
      title: "Read Multiple Files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ paths }) => {
      try {
        return ok(await readMultipleFiles(paths));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "list_directory_tree",
    "Return a bounded recursive directory tree for an allowed path.",
    {
      path: z.string(),
      depth: z.number().int().min(1).max(8).optional(),
      max_entries_per_directory: z.number().int().min(1).max(500).optional(),
    },
    {
      title: "List Directory Tree",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path, depth, max_entries_per_directory }) => {
      try {
        return ok(await listDirectoryTree(path, depth ?? 2, max_entries_per_directory ?? 100));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "batch_edit_files",
    "Atomically validate a batch of exact text replacements, then apply them across files. If validation fails, no files are changed.",
    {
      edits: z.array(
        z.object({
          path: z.string(),
          old_text: z.string().min(1),
          new_text: z.string(),
          replace_all: z.boolean().optional(),
        }),
      ).min(1).max(100),
    },
    {
      title: "Batch Edit Files",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ edits }) => {
      try {
        return ok(await batchEditFiles(edits.map((edit) => ({
          path: edit.path,
          oldText: edit.old_text,
          newText: edit.new_text,
          replaceAll: edit.replace_all ?? false,
        }))));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_capabilities",
    "Show the active server permission flags, allowed filesystem roots, version, and audit log location.",
    {},
    {
      title: "Get Capabilities",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async () => {
      try {
        return ok({
          version: "0.4.0",
          allowedDirectories: configuredRoots(),
          write: envFlag("ALLOW_WRITE", true),
          delete: envFlag("ALLOW_DELETE", false),
          shell: envFlag("ALLOW_SHELL", false),
          gitPush: envFlag("ALLOW_GIT_PUSH", false),
          rollback: envFlag("ALLOW_ROLLBACK", false),
          auditLogEnabled: envFlag("AUDIT_LOG_ENABLED", true),
          auditLogPath: getAuditLogPath(),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "get_audit_log",
    "Read recent privacy-aware computer-mcp tool audit entries. File contents, patches, shell commands, and process input are hashed/redacted.",
    {
      limit: z.number().int().min(1).max(500).optional(),
      tool: z.string().optional(),
    },
    {
      title: "Get Audit Log",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ limit, tool }) => {
      try {
        return ok(await readAuditLog(limit ?? 50, tool));
      } catch (error) {
        return fail(error);
      }
    },
  );


  server.tool(
    "begin_transaction",
    "Create a Git-backed checkpoint of the current repository worktree, including tracked and untracked non-ignored files, without changing the real index or branch.",
    {
      cwd: z.string(),
      label: z.string().max(200).optional(),
    },
    {
      title: "Begin Transaction",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ cwd, label }) => {
      try {
        return ok(await beginTransaction(cwd, label ?? "computer-mcp task"));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "transaction_status",
    "Show the current state, Git status, and diff summary for a computer-mcp transaction.",
    { transaction_id: z.string() },
    {
      title: "Transaction Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ transaction_id }) => {
      try {
        return ok(await getTransactionStatus(transaction_id));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "list_transactions",
    "List recent computer-mcp transactions, optionally filtered to a repository.",
    { cwd: z.string().optional() },
    {
      title: "List Transactions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ cwd }) => {
      try {
        return ok(await listTransactions(cwd));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "rollback_transaction",
    "Restore a repository to a transaction checkpoint. This rewinds commits made after the checkpoint on the same branch, but creates a safety ref first. Requires ALLOW_ROLLBACK=true. Ignored files and external/network side effects are not reverted.",
    { transaction_id: z.string() },
    {
      title: "Rollback Transaction",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ transaction_id }) => {
      try {
        return ok(await rollbackTransaction(transaction_id));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "complete_transaction",
    "Mark a transaction complete and optionally retain its hidden Git checkpoint ref.",
    {
      transaction_id: z.string(),
      keep_checkpoint: z.boolean().optional(),
    },
    {
      title: "Complete Transaction",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ transaction_id, keep_checkpoint }) => {
      try {
        return ok(await completeTransaction(transaction_id, keep_checkpoint ?? false));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "execute_command_transactional",
    "Run a shell command inside a Git repository with an automatic checkpoint. If the command fails or times out, repository files are automatically rolled back. External/network side effects and ignored files cannot be undone. Requires ALLOW_SHELL=true and ALLOW_ROLLBACK=true.",
    {
      command: z.string().min(1),
      cwd: z.string(),
      timeout_ms: z.number().int().min(1000).max(600000).optional(),
      keep_checkpoint_on_success: z.boolean().optional(),
    },
    {
      title: "Execute Command Transactionally",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ command, cwd, timeout_ms, keep_checkpoint_on_success }) => {
      let tx: Awaited<ReturnType<typeof beginTransaction>> | null = null;
      try {
        tx = await beginTransaction(cwd, "transactional command");
        const commandResult = await executeCommand(command, cwd, timeout_ms ?? 60000);

        if (commandResult.exitCode !== 0 || commandResult.timedOut) {
          const rollback = await rollbackTransaction(tx.id);
          return ok({
            transactionId: tx.id,
            rolledBack: true,
            commandResult,
            rollback,
          });
        }

        const completion = await completeTransaction(
          tx.id,
          keep_checkpoint_on_success ?? false,
        );
        return ok({
          transactionId: tx.id,
          rolledBack: false,
          commandResult,
          completion,
        });
      } catch (error) {
        if (tx) {
          try {
            const rollback = await rollbackTransaction(tx.id);
            return fail(
              new Error(
                `${error instanceof Error ? error.message : String(error)}; repository rollback succeeded via ${rollback.safetyRef}`,
              ),
            );
          } catch (rollbackError) {
            return fail(
              new Error(
                `${error instanceof Error ? error.message : String(error)}; rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              ),
            );
          }
        }
        return fail(error);
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      if (req.method !== "POST") {
        res.status(400).json({ error: "No valid MCP session." });
        return;
      }

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, { transport, server }),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      session = { transport, server };
    }

    const activeSession = session;
    if (!activeSession) throw new Error("MCP session initialization failed.");

    const body = req.body as {
      method?: string;
      params?: { name?: string; arguments?: unknown };
    };

    if (body?.method === "tools/call" && body.params?.name) {
      await toolAuditContext.run(
        {
          tool: body.params.name,
          args: body.params.arguments ?? {},
          startedAt: Date.now(),
          recorded: false,
        },
        async () => {
          await activeSession.transport.handleRequest(req, res, req.body);
        },
      );
    } else {
      await activeSession.transport.handleRequest(req, res, req.body);
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "computer-mcp",
    version: "0.4.0",
    capabilities: {
      write: envFlag("ALLOW_WRITE", true),
      delete: envFlag("ALLOW_DELETE", false),
      shell: envFlag("ALLOW_SHELL", false),
      gitPush: envFlag("ALLOW_GIT_PUSH", false),
      rollback: envFlag("ALLOW_ROLLBACK", false),
      auditLog: envFlag("AUDIT_LOG_ENABLED", true),
    },
  });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`computer-mcp v0.4.0 listening on http://127.0.0.1:${port}/mcp`);
});
