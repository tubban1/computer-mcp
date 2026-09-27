import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distServer = path.join(root, "dist", "server.js");
const scratch = path.join(root, ".tmp-verify-performance-p0");
const stateRoot = path.join(scratch, "state");

const P50_TARGET_MS = Number(process.env.MCP_WARM_P50_TARGET_MS ?? 500);
const P95_TARGET_MS = Number(process.env.MCP_WARM_P95_TARGET_MS ?? 1500);
const SAMPLE_COUNT = Math.max(
  20,
  Math.min(200, Number(process.env.MCP_PERF_SAMPLE_COUNT ?? 40)),
);

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(stateRoot, { recursive: true });
await fs.access(distServer);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    throw new Error("Could not allocate performance verifier port.");
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function stopProcessGroup(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    return;
  }
  await delay(250);
  if (child.exitCode === null) {
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
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
  if (result.isError) throw new Error(text || "MCP tool returned an error.");
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
) {
  const result = await client.request(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    CallToolResultSchema,
    { timeout: 5_000 },
  );
  return parseToolText(result);
}

type SampleSummary = {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

function summarize(samples: number[]): SampleSummary {
  assert.ok(samples.length > 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (ratio: number) =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1),
      )
    ]!;
  return {
    samples: sorted.length,
    p50Ms: Math.round(at(0.5) * 1000) / 1000,
    p95Ms: Math.round(at(0.95) * 1000) / 1000,
    maxMs: Math.round(sorted[sorted.length - 1]! * 1000) / 1000,
  };
}

async function benchmark(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  count = SAMPLE_COUNT,
): Promise<SampleSummary> {
  for (let index = 0; index < 5; index += 1) {
    await callTool(client, name, args);
  }

  const samples: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    await callTool(client, name, args);
    samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}

function assertWarmTarget(name: string, summary: SampleSummary) {
  assert.ok(
    summary.p50Ms <= P50_TARGET_MS,
    `${name} P50 ${summary.p50Ms} ms exceeds ${P50_TARGET_MS} ms`,
  );
  assert.ok(
    summary.p95Ms <= P95_TARGET_MS,
    `${name} P95 ${summary.p95Ms} ms exceeds ${P95_TARGET_MS} ms`,
  );
}

const port = await freePort();
const serverUrl = new URL(`http://127.0.0.1:${port}/mcp`);
const healthUrl = new URL("/health", serverUrl);
let stdout = "";
let stderr = "";

const server = spawn(process.execPath, [distServer], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    AGENTOS_RUNTIME_MODE: "test",
    AGENTOS_STATE_ROOT: stateRoot,
    ALLOWED_DIRECTORIES: root,
    ALLOW_SHELL: "false",
    ALLOW_WRITE: "true",
    ALLOW_BROWSER: "false",
    ALLOW_GUI: "false",
    AUDIT_LOG_ENABLED: "false",
    MCP_REQUEST_TIMEOUT_MS: "5000",
    MCP_WARM_P50_TARGET_MS: String(P50_TARGET_MS),
    MCP_WARM_P95_TARGET_MS: String(P95_TARGET_MS),
  },
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (chunk) => {
  stdout += chunk.toString();
});
server.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

let transport: StreamableHTTPClientTransport | null = null;

try {
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Performance test server exited early (${server.exitCode}).\n${stdout}\n${stderr}`,
      );
    }
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // still starting
    }
    await delay(50);
  }
  assert.equal(healthy, true, `Server failed health check.\n${stderr}`);

  const client = new Client({ name: "performance-p0-verifier", version: "1.0.0" });
  transport = new StreamableHTTPClientTransport(serverUrl, {
    requestInit: {
      headers: {
        "x-computer-mcp-owner-id": "performance-p0-verifier",
      },
    },
  });

  const connectStartedAt = performance.now();
  await client.connect(transport);
  const connectMs = performance.now() - connectStartedAt;
  assert.ok(
    connectMs <= 3_000,
    `Warm-session bootstrap took ${connectMs.toFixed(1)} ms; expected <= 3000 ms`,
  );

  const read = await benchmark(client, "read_file", {
    path: path.join(root, "package.json"),
  });
  const list = await benchmark(client, "list_directory", { path: root });
  const capabilities = await benchmark(client, "get_capabilities", {}, 20);

  assertWarmTarget("read_file", read);
  assertWarmTarget("list_directory", list);
  assertWarmTarget("get_capabilities", capabilities);

  const batchSteps = Array.from({ length: 10 }, (_, index) => ({
    id: `info_${index}`,
    action: "fs.info",
    args: { path: path.join(root, "package.json") },
  }));
  const batchStartedAt = performance.now();
  const batch = await callTool(client, "computer_batch", {
    steps: batchSteps,
    stop_on_error: true,
  });
  const batchRoundTripMs = performance.now() - batchStartedAt;
  assert.equal(batch.ok, true);
  assert.equal(batch.executedSteps, 10);
  assert.equal(batch.failed, 0);

  const health = (await (await fetch(healthUrl)).json()) as any;
  assert.equal(health.capabilities?.mcpLatencyTelemetry, true);
  assert.equal(health.capabilities?.performanceRegressionGate, true);
  assert.ok(health.performance?.overall?.totalSamples >= 100);
  assert.equal(health.performance?.overall?.meetsWarmTargets, true);
  assert.match(
    String(health.performance?.scope ?? ""),
    /excludes ChatGPT\/gateway\/network time/,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        targets: {
          p50Ms: P50_TARGET_MS,
          p95Ms: P95_TARGET_MS,
          sessionBootstrapMaxMs: 3000,
        },
        sessionBootstrapMs: Math.round(connectMs * 1000) / 1000,
        warmLoopbackMcp: {
          read_file: read,
          list_directory: list,
          get_capabilities: capabilities,
        },
        localComposition: {
          tool: "computer_batch",
          logicalSteps: 10,
          mcpRoundTrips: 1,
          roundTripMs: Math.round(batchRoundTripMs * 1000) / 1000,
        },
        serverTelemetry: health.performance,
      },
      null,
      2,
    ),
  );
} finally {
  if (transport) {
    await transport.terminateSession().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
  await stopProcessGroup(server);
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}
