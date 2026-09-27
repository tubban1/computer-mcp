import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-transport-stability");
await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForFile(filePath: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function stopProcessGroup(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    return;
  }
  await delay(250);
  if (child.exitCode === null) {
    try {
      if (process.platform !== "win32") {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // best effort
    }
  }
}

function parseToolText(result: any) {
  const text = result.content
    ?.filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");
  if (result.isError) {
    throw new Error(text || "MCP tool returned an error.");
  }
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeout?: number },
) {
  const result = await client.request(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    CallToolResultSchema,
    options,
  );
  return parseToolText(result);
}

const port = await freePort();
const serverUrl = new URL(`http://127.0.0.1:${port}/mcp`);
let serverStdout = "";
let serverStderr = "";
const server = spawn(
  path.join(root, "node_modules", ".bin", "tsx"),
  ["src/server.ts"],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      AGENTOS_RUNTIME_MODE: "test",
      AGENTOS_STATE_ROOT: path.join(scratch, "state"),
      ALLOWED_DIRECTORIES: root,
      ALLOW_SHELL: "true",
      ALLOW_WRITE: "true",
      AUDIT_LOG_ENABLED: "false",
      PROCESS_MONITOR_POLL_MS: "1000",
      MCP_REQUEST_TIMEOUT_MS: "5000",
      RUNTIME_SESSION_STALE_MS: "1000",
      RUNTIME_SESSION_RETENTION_MS: "60000",
      RUNTIME_SESSION_SWEEP_MS: "1000",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout?.on("data", (chunk) => {
  serverStdout += chunk.toString();
});
server.stderr?.on("data", (chunk) => {
  serverStderr += chunk.toString();
});

const transports: StreamableHTTPClientTransport[] = [];

try {
  const healthUrl = new URL("/health", serverUrl);
  const healthDeadline = Date.now() + 10_000;
  let healthy = false;
  while (Date.now() < healthDeadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Test server exited early (${server.exitCode}).\n${serverStdout}\n${serverStderr}`,
      );
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // server is still starting
    }
    await delay(50);
  }
  assert.equal(healthy, true, `Server failed health check.\n${serverStderr}`);

  const ownerHeader = "e2e-logical-conversation";
  const createClient = async (name: string) => {
    const client = new Client({ name, version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      requestInit: {
        headers: {
          "x-computer-mcp-owner-id": ownerHeader,
        },
      },
    });
    transports.push(transport);
    await client.connect(transport);
    return { client, transport };
  };

  const first = await createClient("stability-client-a");
  const managed = await callTool(first.client, "start_process", {
    command: "sleep 30",
    cwd: scratch,
    workspace_mode: "read",
  });
  assert.equal(typeof managed.processId, "string");

  await first.transport.terminateSession();
  await first.transport.close();

  const second = await createClient("stability-client-b");
  const killed = await callTool(second.client, "kill_process", {
    process_id: managed.processId,
    signal: "SIGTERM",
  });
  assert.equal(killed.sent, true);

  const pidFile = path.join(scratch, "cancel-child.pid");
  const controller = new AbortController();
  const cancelledRequest = callTool(
    second.client,
    "execute_command",
    {
      command: `sleep 30 & echo $! > ${JSON.stringify(pidFile)}; wait`,
      cwd: scratch,
      timeout_ms: 30_000,
      workspace_mode: "read",
    },
    { signal: controller.signal, timeout: 30_000 },
  );

  const childText = await waitForFile(pidFile);
  const childPid = Number(childText.trim());
  assert.ok(Number.isInteger(childPid) && childPid > 1);
  controller.abort(new Error("transport verifier cancellation"));

  await assert.rejects(
    cancelledRequest,
    (error: unknown) =>
      error instanceof Error &&
      (error.name === "AbortError" || /abort|cancel/i.test(error.message)),
  );

  await delay(400);
  if (pidAlive(childPid)) {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // cleanup best effort
    }
    assert.fail("MCP cancellation left the command child process alive.");
  }

  let healthAfter = await (await fetch(healthUrl)).json() as any;
  const cancellationSettledDeadline = Date.now() + 3_000;
  while (
    healthAfter.runtime.sessions.inFlightMcpRequests !== 0 &&
    Date.now() < cancellationSettledDeadline
  ) {
    await delay(50);
    healthAfter = await (await fetch(healthUrl)).json() as any;
  }
  assert.ok(healthAfter.runtime.sessions.activeSessions >= 1);
  assert.ok(healthAfter.runtime.sessions.activeOwners >= 1);
  assert.ok(healthAfter.runtime.sessions.transportRegistrySize >= 1);
  assert.equal(healthAfter.runtime.sessions.inFlightMcpRequests, 0);

  // Simulate a client that disappears without terminateSession(). The server
  // must age out both the logical session record and the transport registry
  // entry instead of leaking it forever.
  const abandoned = await createClient("stability-client-abandoned");
  const registryWithAbandoned = (
    await (await fetch(healthUrl)).json() as any
  ).runtime.sessions.transportRegistrySize;
  assert.ok(registryWithAbandoned >= 2);
  await abandoned.transport.close();

  await delay(2_500);
  const healthAfterSweep = await (await fetch(healthUrl)).json() as any;
  assert.ok(
    healthAfterSweep.runtime.sessions.transportRegistrySize <
      registryWithAbandoned,
  );
  assert.equal(healthAfterSweep.runtime.sessions.inFlightMcpRequests, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        logicalOwnerAcrossRealMcpTransportRotation: true,
        protocolCancellationPropagatesToExecution: true,
        cancelledCommandProcessTreeCleaned: true,
        boundedSessionDiagnostics: true,
        staleTransportRegistrySwept: true,
      },
      null,
      2,
    ),
  );
} finally {
  for (const transport of transports) {
    await transport.close().catch(() => undefined);
  }
  await stopProcessGroup(server);
  await fs.rm(scratch, { recursive: true, force: true });
}
