import { performance } from "node:perf_hooks";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const serverUrl = new URL(
  process.env.COMPUTER_MCP_BENCH_URL ?? "http://127.0.0.1:8787/mcp",
);
const samples = Math.max(
  5,
  Math.min(100, Number(process.env.COMPUTER_MCP_BENCH_SAMPLES ?? 20)),
);
const explicitRoot = process.env.COMPUTER_MCP_BENCH_ROOT?.trim() || null;
const explicitFile = process.env.COMPUTER_MCP_BENCH_FILE?.trim() || null;

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

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
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
) {
  for (let index = 0; index < 3; index += 1) {
    await callTool(client, name, args);
  }
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await callTool(client, name, args);
    values.push(performance.now() - startedAt);
  }
  return summarize(values);
}

const client = new Client({
  name: "computer-mcp-production-benchmark",
  version: "1.0.0",
});
const transport = new StreamableHTTPClientTransport(serverUrl, {
  requestInit: {
    headers: {
      "x-computer-mcp-owner-id": "production-benchmark",
    },
  },
});

try {
  const connectStartedAt = performance.now();
  await Promise.race([
    client.connect(transport),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("MCP session bootstrap exceeded 3 seconds.")),
        3000,
      ),
    ),
  ]);
  const connectMs = performance.now() - connectStartedAt;

  console.error(`[benchmark] connected in ${connectMs.toFixed(1)} ms`);
  console.error("[benchmark] probing get_capabilities");
  const capabilities = await callTool(client, "get_capabilities", {});
  const roots = [
    ...(Array.isArray(capabilities.allowedDirectories)
      ? capabilities.allowedDirectories
      : []),
    ...(Array.isArray(capabilities.runtimeOwnedDirectories)
      ? capabilities.runtimeOwnedDirectories
      : []),
  ].filter((value: unknown): value is string => typeof value === "string");

  const root = explicitRoot ? path.resolve(explicitRoot) : (roots[0] ?? null);
  console.error("[benchmark] sampling get_capabilities");
  const results: Record<string, unknown> = {
    get_capabilities: await benchmark(client, "get_capabilities", {}),
  };

  if (root) {
    console.error(`[benchmark] sampling list_directory ${root}`);
    results.list_directory = await benchmark(client, "list_directory", {
      path: root,
    });
  }

  if (explicitFile) {
    console.error(`[benchmark] sampling read_file ${explicitFile}`);
    results.read_file = await benchmark(client, "read_file", {
      path: path.resolve(explicitFile),
    });
  }

  let serverPerformance: unknown = null;
  try {
    const healthUrl = new URL("/health", serverUrl);
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const health = (await response.json()) as any;
      serverPerformance = health.performance ?? null;
    }
  } catch {
    // Older production versions may not expose performance telemetry.
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: serverUrl.toString(),
        sessionBootstrapMs: Math.round(connectMs * 1000) / 1000,
        localLoopback: results,
        serverPerformance,
        interpretation:
          "This measures local loopback MCP only. If ChatGPT-visible latency is much higher, investigate the remote gateway/tunnel/session recovery path.",
      },
      null,
      2,
    ),
  );
} finally {
  await transport.terminateSession().catch(() => undefined);
  await transport.close().catch(() => undefined);
}
