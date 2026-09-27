import assert from "node:assert/strict";
import http from "node:http";
import {
  OwlHttpRuntimeClient,
  getRuntimeClient,
  getRuntimeClientStatus,
} from "../src/runtimeClient/runtimeClient.js";
import { withExecutionContext } from "../src/runtime/executionContext.js";

type SeenRequest = {
  sessionId: string | undefined;
  requestId: string | undefined;
  authorization: string | undefined;
  method: string | undefined;
};

const seen: SeenRequest[] = [];
let holdResponse = false;

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/runtime/v0.1/rpc") {
    res.statusCode = 404;
    res.end();
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk.toString();
  const parsed = JSON.parse(body) as { method?: string };

  seen.push({
    sessionId: req.headers["x-owl-session-id"] as string | undefined,
    requestId: req.headers["x-owl-request-id"] as string | undefined,
    authorization: req.headers.authorization,
    method: parsed.method,
  });

  if (holdResponse) {
    req.once("aborted", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (res.destroyed) return;
  }

  const result =
    parsed.method === "info"
      ? { apiVersion: "0.1", runtimeVersion: "test", transport: "http" }
      : parsed.method === "capabilities.get"
        ? { capabilities: ["test"] }
        : parsed.method === "primitives.catalog"
          ? [{ primitive: "fs" }]
          : parsed.method === "skills.catalog"
            ? [{ skill: "runtime.health" }]
            : null;

  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      apiVersion: "0.1",
      requestId: req.headers["x-owl-request-id"] ?? "unknown",
      rpcId: null,
      result,
    }),
  );
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to allocate test Runtime port.");
}

const previous = {
  backend: process.env.COMPUTER_MCP_RUNTIME_BACKEND,
  url: process.env.OWL_RUNTIME_URL,
  token: process.env.OWL_RUNTIME_API_TOKEN,
  timeout: process.env.OWL_RUNTIME_HTTP_TIMEOUT_MS,
};

process.env.COMPUTER_MCP_RUNTIME_BACKEND = "owl-http";
process.env.OWL_RUNTIME_URL = `http://127.0.0.1:${address.port}`;
process.env.OWL_RUNTIME_API_TOKEN = "test-token";
process.env.OWL_RUNTIME_HTTP_TIMEOUT_MS = "5000";

const logicalOwner = "owner_stable_test";
const contextA = {
  sessionId: "transport-a",
  transportSessionId: "transport-a",
  ownerId: logicalOwner,
  requestId: "mcp-request-a",
  origin: "mcp" as const,
};
const contextB = {
  sessionId: "transport-b",
  transportSessionId: "transport-b",
  ownerId: logicalOwner,
  requestId: "mcp-request-b",
  origin: "mcp" as const,
};

try {
  const status = getRuntimeClientStatus();
  assert.equal(status.backend, "owl-http");
  assert.equal(status.owlPublicApiVersion, "0.1");
  assert.equal(status.fallbackPolicy, "no-silent-runtime-fallback");

  const selected = getRuntimeClient();
  assert.equal(selected.backend, "owl-http");

  await withExecutionContext(contextA, async () => {
    const info = await selected.info();
    assert.equal(info.apiVersion, "0.1");
    await selected.getCapabilities("stability");
    await selected.getPrimitiveCatalog();
  });

  await withExecutionContext(contextB, async () => {
    await selected.getSkillCatalog();
  });

  assert.equal(seen.length, 4);
  assert.deepEqual(
    seen.map((item) => item.sessionId),
    [logicalOwner, logicalOwner, logicalOwner, logicalOwner],
  );
  assert.ok(seen.every((item) => item.requestId?.startsWith("computer-mcp:")));
  assert.ok(seen.every((item) => item.authorization === "Bearer test-token"));
  assert.deepEqual(
    seen.map((item) => item.method),
    ["info", "capabilities.get", "primitives.catalog", "skills.catalog"],
  );

  // Cancellation on the MCP execution context must abort the Runtime HTTP
  // request instead of leaving a detached request running.
  holdResponse = true;
  const controller = new AbortController();
  const cancelContext = {
    ...contextA,
    requestId: "mcp-request-cancel",
    signal: controller.signal,
  };
  const client = new OwlHttpRuntimeClient();
  const pending = withExecutionContext(cancelContext, async () =>
    await client.getCapabilities("cancel-me"),
  );
  setTimeout(() => controller.abort(new Error("consumer cancelled")), 50);

  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof Error &&
      (error.name === "AbortError" ||
        /abort|cancel|consumer cancelled/i.test(error.message)),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicApiVersion: "0.1",
        stableLogicalSessionHeader: true,
        requestIdentitySeparatedFromSession: true,
        bearerTokenForwarded: true,
        cancellationPropagated: true,
        silentFallbackDisabled: true,
      },
      null,
      2,
    ),
  );
} finally {
  holdResponse = false;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (previous.backend === undefined) {
    delete process.env.COMPUTER_MCP_RUNTIME_BACKEND;
  } else {
    process.env.COMPUTER_MCP_RUNTIME_BACKEND = previous.backend;
  }
  if (previous.url === undefined) delete process.env.OWL_RUNTIME_URL;
  else process.env.OWL_RUNTIME_URL = previous.url;
  if (previous.token === undefined) delete process.env.OWL_RUNTIME_API_TOKEN;
  else process.env.OWL_RUNTIME_API_TOKEN = previous.token;
  if (previous.timeout === undefined) {
    delete process.env.OWL_RUNTIME_HTTP_TIMEOUT_MS;
  } else {
    process.env.OWL_RUNTIME_HTTP_TIMEOUT_MS = previous.timeout;
  }
}
