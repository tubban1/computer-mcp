import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listDirectory } from "./tools/listDirectory.js";
import { readFile } from "./tools/readFile.js";
import {
  appendFile,
  copyPath,
  createDirectory,
  deletePath,
  editFile,
  getFileInfo,
  movePath,
  searchFiles,
  writeFile,
} from "./tools/fileOps.js";
import {
  executeCommand,
  getProcessOutput,
  killProcess,
  listProcesses,
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

function ok(value: unknown) {
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
    version: "0.2.0",
  });

  server.tool(
    "list_directory",
    "List files and folders inside an allowed local directory. Read-only.",
    { path: z.string().describe("Absolute local directory path") },
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
    async () => {
      try {
        return ok(listProcesses());
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
    async ({ cwd, patch }) => {
      try {
        return ok(await applyPatch(cwd, patch));
      } catch (error) {
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

    await session.transport.handleRequest(req, res, req.body);
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
    version: "0.2.0",
    capabilities: {
      write: process.env.ALLOW_WRITE !== "false",
      delete: ["1", "true", "yes", "on"].includes((process.env.ALLOW_DELETE ?? "").toLowerCase()),
      shell: ["1", "true", "yes", "on"].includes((process.env.ALLOW_SHELL ?? "").toLowerCase()),
      gitPush: ["1", "true", "yes", "on"].includes((process.env.ALLOW_GIT_PUSH ?? "").toLowerCase()),
    },
  });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`computer-mcp v0.2.0 listening on http://127.0.0.1:${port}/mcp`);
});
