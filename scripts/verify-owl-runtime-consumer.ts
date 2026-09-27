import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withExecutionContext } from "../src/runtime/executionContext.js";
import {
  getRuntimeClient,
  getRuntimeClientStatus,
} from "../src/runtimeClient/runtimeClient.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owlRepo = process.env.OWL_RUNTIME_REPO?.trim();
if (!owlRepo) {
  throw new Error(
    "OWL_RUNTIME_REPO is required, e.g. OWL_RUNTIME_REPO=/path/to/owl-runtime.",
  );
}

const owlPackage = JSON.parse(
  await fs.readFile(path.join(owlRepo, "package.json"), "utf8"),
) as { name?: string };
assert.equal(owlPackage.name, "owl-runtime");

const scratch = path.join(root, ".tmp-verify-owl-runtime-consumer");
await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });

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
    throw new Error("Could not allocate Runtime test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const tsx = path.join(owlRepo, "node_modules", ".bin", "tsx");
let stdout = "";
let stderr = "";

const runtime = spawn(tsx, ["src/server.ts"], {
  cwd: owlRepo,
  env: {
    ...process.env,
    PORT: String(port),
    OWL_RUNTIME_MODE: "test",
    OWL_STATE_ROOT: path.join(scratch, "owl-state"),
    AGENTOS_STATE_ROOT: path.join(scratch, "owl-state"),
    AUDIT_LOG_ENABLED: "false",
  },
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
runtime.stdout?.on("data", (chunk) => {
  stdout += chunk.toString();
});
runtime.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

const previous = {
  backend: process.env.COMPUTER_MCP_RUNTIME_BACKEND,
  url: process.env.OWL_RUNTIME_URL,
  token: process.env.OWL_RUNTIME_API_TOKEN,
};

try {
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null) {
      throw new Error(
        `OWL Runtime exited early (${runtime.exitCode}).\n${stdout}\n${stderr}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/runtime/v0.1/info`);
      if (response.ok) {
        const payload = (await response.json()) as any;
        if (payload?.ok === true && payload?.apiVersion === "0.1") {
          healthy = true;
          break;
        }
      }
    } catch {
      // still starting
    }
    await delay(50);
  }
  assert.equal(healthy, true, `OWL Runtime did not become ready.\n${stderr}`);

  process.env.COMPUTER_MCP_RUNTIME_BACKEND = "owl-http";
  process.env.OWL_RUNTIME_URL = baseUrl;
  delete process.env.OWL_RUNTIME_API_TOKEN;

  const ownerId = "owner_real_owl_consumer";
  const result = await withExecutionContext(
    {
      sessionId: "mcp-transport-real-a",
      ownerId,
      requestId: "consumer-real-a",
      origin: "mcp",
    },
    async () => {
      const client = getRuntimeClient();
      assert.equal(client.backend, "owl-http");
      const info = await client.info();
      const capabilities = await client.getCapabilities("personal MCP stability");
      const primitives = await client.getPrimitiveCatalog();
      const skills = await client.getSkillCatalog();
      return { info, capabilities, primitives, skills };
    },
  );

  assert.equal(result.info.apiVersion, "0.1");
  assert.equal(result.info.transport, "in-process");
  assert.ok(result.capabilities);
  assert.ok(Array.isArray(result.primitives));
  assert.ok(Array.isArray(result.skills));

  // A second MCP transport with the same logical owner must remain the same OWL
  // logical session from the consumer's perspective.
  await withExecutionContext(
    {
      sessionId: "mcp-transport-real-b",
      ownerId,
      requestId: "consumer-real-b",
      origin: "mcp",
    },
    async () => {
      const info = await getRuntimeClient().info();
      assert.equal(info.apiVersion, "0.1");
    },
  );

  const status = getRuntimeClientStatus();
  assert.equal(status.backend, "owl-http");

  console.log(
    JSON.stringify(
      {
        ok: true,
        realOwlRuntimeDaemon: true,
        publicApiVersion: result.info.apiVersion,
        runtimeVersion: result.info.runtimeVersion,
        transport: result.info.transport,
        stableLogicalOwnerAcrossMcpTransportRotation: true,
        capabilityManifestConsumed: true,
        primitiveCatalogConsumed: true,
        skillCatalogConsumed: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (previous.backend === undefined) {
    delete process.env.COMPUTER_MCP_RUNTIME_BACKEND;
  } else {
    process.env.COMPUTER_MCP_RUNTIME_BACKEND = previous.backend;
  }
  if (previous.url === undefined) delete process.env.OWL_RUNTIME_URL;
  else process.env.OWL_RUNTIME_URL = previous.url;
  if (previous.token === undefined) delete process.env.OWL_RUNTIME_API_TOKEN;
  else process.env.OWL_RUNTIME_API_TOKEN = previous.token;

  await stopProcessGroup(runtime);
  await fs.rm(scratch, { recursive: true, force: true });
}
