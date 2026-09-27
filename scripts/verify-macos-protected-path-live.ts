import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const mcpUrl = new URL(
  process.env.COMPUTER_MCP_LIVE_URL ?? "http://127.0.0.1:8787/mcp",
);
const protectedPath = path.resolve(
  process.env.MACOS_PROTECTED_PATH_TEST_PATH ?? path.join(os.homedir(), "Desktop"),
);

function resultText(result: any): string {
  return (
    result.content
      ?.filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("\n") ?? ""
  );
}

const client = new Client({
  name: "computer-mcp-macos-protected-path-verifier",
  version: "1.0.0",
});
const transport = new StreamableHTTPClientTransport(mcpUrl, {
  requestInit: {
    headers: {
      "x-computer-mcp-owner-id": "macos-protected-path-verifier",
    },
  },
});

try {
  await Promise.race([
    client.connect(transport),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("MCP bootstrap exceeded 3 seconds.")), 3000),
    ),
  ]);

  const started = performance.now();
  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "list_directory",
        arguments: { path: protectedPath },
      },
    },
    CallToolResultSchema,
    { timeout: 2500 },
  );
  const elapsedMs = performance.now() - started;
  const text = resultText(result);
  const permissionRequired =
    result.isError === true && text.includes("MACOS_FILE_PERMISSION_REQUIRED");
  const accessible = result.isError !== true;

  assert.ok(accessible || permissionRequired, text || "Unexpected MCP result.");
  assert.ok(elapsedMs < 2000, `protected-path call took ${elapsedMs.toFixed(1)}ms`);

  const healthUrl = new URL("/health", mcpUrl);
  const healthStarted = performance.now();
  const healthResponse = await fetch(healthUrl, {
    signal: AbortSignal.timeout(1500),
  });
  const healthElapsedMs = performance.now() - healthStarted;
  assert.equal(healthResponse.ok, true);
  const health = (await healthResponse.json()) as any;
  assert.equal(health.ok, true);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mcpUrl: mcpUrl.toString(),
        protectedPath,
        outcome: accessible ? "accessible" : "permission-required",
        callElapsedMs: Number(elapsedMs.toFixed(1)),
        healthElapsedMs: Number(healthElapsedMs.toFixed(1)),
        runtimeVersion: health.version,
        runtimeResponsiveAfterProbe: true,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
}
