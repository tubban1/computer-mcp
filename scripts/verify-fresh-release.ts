import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-fresh-release");
const release = path.join(scratch, "release");
const stateRoot = path.join(scratch, "state");
const dataRoot = path.join(scratch, "data");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
) as { version: string; dependencies?: Record<string, string> };

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
    throw new Error("Could not allocate fresh-release verifier port.");
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
  await delay(300);
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

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(release, { recursive: true });
await fs.mkdir(stateRoot, { recursive: true });
await fs.mkdir(dataRoot, { recursive: true });
await fs.writeFile(path.join(dataRoot, "probe.txt"), "fresh-release-ok\n");

try {
  await fs.cp(path.join(root, "dist"), path.join(release, "dist"), {
    recursive: true,
  });
  await Promise.all([
    fs.copyFile(
      path.join(root, "package.json"),
      path.join(release, "package.json"),
    ),
    fs.copyFile(
      path.join(root, "package-lock.json"),
      path.join(release, "package-lock.json"),
    ),
  ]);

  const installStartedAt = performance.now();
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd: release,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  const installMs = performance.now() - installStartedAt;

  // The immutable production release must be runnable without the source
  // checkout's TypeScript toolchain or native Helper source.
  await assert.rejects(fs.access(path.join(release, "node_modules", "tsx")));
  await assert.rejects(
    fs.access(path.join(release, "node_modules", "typescript")),
  );
  await assert.rejects(fs.access(path.join(release, "macos-helper")));

  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    await fs.access(path.join(release, "node_modules", dependency));
  }

  const dependencyTree = JSON.parse(
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "--omit=dev", "--depth=0", "--json"],
      { cwd: release, encoding: "utf8" },
    ),
  ) as any;
  assert.equal(dependencyTree.version, pkg.version);

  const port = await freePort();
  const serverUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  const healthUrl = new URL("/health", serverUrl);
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: release,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      AGENTOS_RUNTIME_MODE: "production",
      AGENTOS_STATE_ROOT: stateRoot,
      COMPUTER_MCP_RUNTIME_BACKEND: "legacy",
      ALLOWED_DIRECTORIES: dataRoot,
      ALLOW_WRITE: "true",
      ALLOW_DELETE: "false",
      ALLOW_SHELL: "false",
      ALLOW_GIT_PUSH: "false",
      ALLOW_ROLLBACK: "false",
      ALLOW_BROWSER: "false",
      ALLOW_GUI: "false",
      AUDIT_LOG_ENABLED: "false",
    },
  });
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let transport: StreamableHTTPClientTransport | null = null;
  try {
    const deadline = Date.now() + 15_000;
    let health: any = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Fresh release exited early (${child.exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }
      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {
        // still starting
      }
      await delay(50);
    }

    assert.ok(health, `Fresh release failed health.\n${stderr}`);
    assert.equal(health.ok, true);
    assert.equal(health.version, pkg.version);
    assert.equal(health.runtime?.mode, "production");
    assert.equal(path.resolve(health.runtime?.stateRoot), path.resolve(stateRoot));
    assert.equal(path.resolve(health.runtime?.codeRoot), path.resolve(release));
    assert.equal(health.runtimeClient?.backend, "legacy");
    assert.equal(health.runtimeClient?.productionBackendLocked, true);

    const client = new Client({
      name: "fresh-release-verifier",
      version: "1.0.0",
    });
    transport = new StreamableHTTPClientTransport(serverUrl, {
      requestInit: {
        headers: {
          "x-computer-mcp-owner-id": "fresh-release-verifier",
        },
      },
    });
    await client.connect(transport);

    const capabilities = parseToolText(
      await client.request(
        {
          method: "tools/call",
          params: { name: "get_capabilities", arguments: {} },
        },
        CallToolResultSchema,
        { timeout: 5000 },
      ),
    );
    assert.equal(capabilities.runtimeClient?.backend, "legacy");
    assert.deepEqual(capabilities.allowedDirectories, [path.resolve(dataRoot)]);

    const read = parseToolText(
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "read_file",
            arguments: { path: path.join(dataRoot, "probe.txt") },
          },
        },
        CallToolResultSchema,
        { timeout: 5000 },
      ),
    );
    assert.equal(read, "fresh-release-ok\n");

    console.log(
      JSON.stringify(
        {
          ok: true,
          version: pkg.version,
          immutableReleaseDirectory: release,
          productionDependenciesOnly: true,
          noSourceTypeScriptToolchain: true,
          noNativeHelperBundled: true,
          sourceCheckoutNotRequiredAtRuntime: true,
          productionBackend: health.runtimeClient.backend,
          productionBackendLocked: health.runtimeClient.productionBackendLocked,
          freshReleaseHealth: true,
          freshReleaseMcpRead: true,
          npmCiProductionInstallMs: Math.round(installMs),
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
    await stopProcessGroup(child);
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}
