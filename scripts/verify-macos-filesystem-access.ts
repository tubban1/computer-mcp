import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertAllowedExistingPath } from "../src/security/pathGuard.js";

const scratch = path.join(os.homedir(), `.computer-mcp-macos-fs-${process.pid}`);
const root = path.join(scratch, "allowed");

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });

const previous = {
  allowed: process.env.ALLOWED_DIRECTORIES,
  probe: process.env.MACOS_FILESYSTEM_PROBE_BIN,
  probeArgs: process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON,
  timeout: process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS,
  preflight: process.env.MACOS_FILESYSTEM_PREFLIGHT,
};

try {
  process.env.ALLOWED_DIRECTORIES = root;
  process.env.MACOS_FILESYSTEM_PREFLIGHT = "true";
  process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS = "150";
  process.env.MACOS_FILESYSTEM_PROBE_BIN = "/bin/sleep";
  process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON = '["5"]';

  let eventLoopResponsive = false;
  const timer = setTimeout(() => {
    eventLoopResponsive = true;
  }, 25);

  const started = performance.now();
  let timeoutError: unknown;
  try {
    await assertAllowedExistingPath(root);
  } catch (error) {
    timeoutError = error;
  }
  assert.match(String(timeoutError), /MACOS_FILE_PERMISSION_REQUIRED/);
  const elapsedMs = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 40));
  clearTimeout(timer);

  assert.equal(eventLoopResponsive, true);
  assert.ok(elapsedMs < 1_000, `preflight took ${elapsedMs.toFixed(1)}ms`);

  process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS = "1000";
  process.env.MACOS_FILESYSTEM_PROBE_BIN = "/usr/bin/true";
  process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON = "[]";
  const resolved = await assertAllowedExistingPath(root);
  assert.equal(resolved, await fs.realpath(root));

  process.env.ALLOWED_DIRECTORIES = path.join(root, "nested");
  process.env.MACOS_FILESYSTEM_PROBE_BIN = "/bin/sleep";
  process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON = '["5"]';
  const outsideStarted = performance.now();
  await assert.rejects(
    () => assertAllowedExistingPath(root),
    /outside ALLOWED_DIRECTORIES/,
  );
  const outsideElapsedMs = performance.now() - outsideStarted;
  assert.ok(outsideElapsedMs < 100);

  console.log(
    JSON.stringify(
      {
        ok: true,
        macOSFilesystemPreflight: true,
        failFastMs: Number(elapsedMs.toFixed(1)),
        eventLoopResponsive,
        lexicalAllowlistBeforeProbe: true,
        healthyProbePasses: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (previous.allowed === undefined) delete process.env.ALLOWED_DIRECTORIES;
  else process.env.ALLOWED_DIRECTORIES = previous.allowed;
  if (previous.probe === undefined) delete process.env.MACOS_FILESYSTEM_PROBE_BIN;
  else process.env.MACOS_FILESYSTEM_PROBE_BIN = previous.probe;
  if (previous.probeArgs === undefined) delete process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON;
  else process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON = previous.probeArgs;
  if (previous.timeout === undefined) delete process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS;
  else process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS = previous.timeout;
  if (previous.preflight === undefined) delete process.env.MACOS_FILESYSTEM_PREFLIGHT;
  else process.env.MACOS_FILESYSTEM_PREFLIGHT = previous.preflight;
  await fs.rm(scratch, { recursive: true, force: true });
}
