import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-process-capability");

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });

process.env.AGENTOS_RUNTIME_MODE = "test";
process.env.AGENTOS_STATE_ROOT = path.join(scratch, "state");
process.env.PROCESS_STATE_DIR = path.join(scratch, "state", "processes");
process.env.PROCESS_STATE_KEY_PATH = path.join(scratch, "state", "process.key");
process.env.PROCESS_LOG_DIR = path.join(scratch, "state", "processes", "logs");
process.env.WORKSPACE_LEASE_DIR = path.join(scratch, "state", "workspace-leases");
process.env.ALLOWED_DIRECTORIES = root;
process.env.ALLOW_SHELL = "true";
process.env.AUDIT_LOG_ENABLED = "true";
process.env.AUDIT_LOG_PATH = path.join(scratch, "state", "audit.jsonl");

const { withExecutionContext } = await import("../src/runtime/executionContext.js");
const { readManagedProcess } = await import("../src/runtime/processStore.js");
const { sanitizeAuditArgs } = await import("../src/audit.js");
const {
  getProcessOutput,
  killProcess,
  listProcesses,
  sendProcessInput,
  startProcess,
} = await import("../src/tools/shellOps.js");

const ownerA = {
  sessionId: "transport-a",
  ownerId: "owner-a",
  requestId: "request-a",
  origin: "mcp" as const,
};
const ownerB = {
  sessionId: "transport-b",
  ownerId: "owner-b",
  requestId: "request-b",
  origin: "mcp" as const,
};

const started = await withExecutionContext(ownerA, async () =>
  await startProcess(
    "while IFS= read -r line; do echo GOT:$line; done",
    scratch,
    "read",
  ),
);

assert.match(started.controlToken, /^pcap_[A-Za-z0-9_-]+$/);
const persisted = await readManagedProcess(started.processId);
assert.ok(persisted.controlTokenHash);
assert.notEqual(persisted.controlTokenHash, started.controlToken);
assert.equal("controlToken" in persisted, false);

const listedText = JSON.stringify(await listProcesses());
assert.equal(listedText.includes(started.controlToken), false);
assert.equal(listedText.includes(persisted.controlTokenHash ?? ""), false);

const runningOnly = await withExecutionContext(ownerA, async () =>
  await listProcesses({ runningOnly: true, limit: 1, ownerScope: "current" }),
);
assert.equal(runningOnly.length, 1);
assert.equal(runningOnly[0]?.processId, started.processId);
const hiddenFromOtherOwner = await withExecutionContext(ownerB, async () =>
  await listProcesses({ runningOnly: true, ownerScope: "current" }),
);
assert.equal(
  hiddenFromOtherOwner.some((item) => item.processId === started.processId),
  false,
);

await assert.rejects(
  () =>
    withExecutionContext(ownerB, async () => {
      await sendProcessInput(started.processId, "blocked\n");
    }),
  /PROCESS_OWNED/,
);

await assert.rejects(
  () =>
    withExecutionContext(ownerB, async () => {
      await killProcess(started.processId, "SIGTERM", "pcap_invalid");
    }),
  /PROCESS_OWNED/,
);

await withExecutionContext(ownerB, async () => {
  await sendProcessInput(started.processId, "hello\n", started.controlToken);
});

let observed = false;
for (let i = 0; i < 40; i += 1) {
  const output = await getProcessOutput(started.processId, 10_000);
  if (output.stdout.includes("GOT:hello")) {
    observed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
assert.equal(observed, true);

const killed = await withExecutionContext(ownerB, async () =>
  await killProcess(started.processId, "SIGTERM", started.controlToken),
);
assert.equal(killed.sent, true);

for (let i = 0; i < 80; i += 1) {
  const status = await getProcessOutput(started.processId, 2_000);
  if (!status.running) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}
const finalStatus = await getProcessOutput(started.processId, 2_000);
assert.equal(finalStatus.running, false);
const statusFiltered = await withExecutionContext(ownerA, async () =>
  await listProcesses({
    status: finalStatus.status as "running" | "exited" | "lost" | "terminating",
    limit: 10,
  }),
);
assert.equal(
  statusFiltered.some((item) => item.processId === started.processId),
  true,
);

const sanitized = sanitizeAuditArgs({
  process_id: started.processId,
  control_token: started.controlToken,
}) as Record<string, unknown>;
assert.equal(JSON.stringify(sanitized).includes(started.controlToken), false);
assert.equal(
  (sanitized.control_token as { redacted?: boolean }).redacted,
  true,
);

await fs.rm(scratch, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      reconnectSafeProcessCapability: true,
      unrelatedOwnerWithoutTokenRejected: true,
      invalidTokenRejected: true,
      validTokenCanSendInputAcrossTransport: true,
      validTokenCanKillAcrossTransport: true,
      rawTokenNotPersisted: true,
      rawTokenNotListed: true,
      processListFilters: true,
      ownerScopedProcessListing: true,
      auditRedactsControlToken: true,
    },
    null,
    2,
  ),
);
