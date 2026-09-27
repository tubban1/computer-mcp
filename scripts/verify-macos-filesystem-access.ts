import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAllowedExistingPath } from "../src/security/pathGuard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-macos-filesystem-access");
const slowProbe = path.join(scratch, "slow-probe.sh");
const okProbe = path.join(scratch, "ok-probe.sh");

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });
await fs.writeFile(slowProbe, "#!/bin/zsh\nsleep 5\n", { mode: 0o755 });
await fs.writeFile(okProbe, "#!/bin/zsh\nexit 0\n", { mode: 0o755 });

const previous = {
  allowed: process.env.ALLOWED_DIRECTORIES,
  probe: process.env.MACOS_FILESYSTEM_PROBE_BIN,
  timeout: process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS,
  preflight: process.env.MACOS_FILESYSTEM_PREFLIGHT,
};

try {
  process.env.ALLOWED_DIRECTORIES = root;
  process.env.MACOS_FILESYSTEM_PREFLIGHT = "true";
  process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS = "150";
  process.env.MACOS_FILESYSTEM_PROBE_BIN = slowProbe;

  let eventLoopResponsive = false;
  const timer = setTimeout(() => {
    eventLoopResponsive = true;
  }, 25);

  const started = performance.now();
  await assert.rejects(
    () => assertAllowedExistingPath(root),
    /MACOS_FILE_PERMISSION_REQUIRED/,
  );
  const elapsedMs = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 40));
  clearTimeout(timer);

  assert.equal(eventLoopResponsive, true);
  assert.ok(elapsedMs < 1_000, `preflight took ${elapsedMs.toFixed(1)}ms`);

  process.env.MACOS_FILESYSTEM_PROBE_BIN = okProbe;
  const resolved = await assertAllowedExistingPath(root);
  assert.equal(resolved, await fs.realpath(root));

  process.env.ALLOWED_DIRECTORIES = scratch;
  process.env.MACOS_FILESYSTEM_PROBE_BIN = slowProbe;
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
  if (previous.timeout === undefined) delete process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS;
  else process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS = previous.timeout;
  if (previous.preflight === undefined) delete process.env.MACOS_FILESYSTEM_PREFLIGHT;
  else process.env.MACOS_FILESYSTEM_PREFLIGHT = previous.preflight;
  await fs.rm(scratch, { recursive: true, force: true });
}
