import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-stability-core");
const repo = path.join(scratch, "repo");

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(repo, { recursive: true });

process.env.AGENTOS_RUNTIME_MODE = "test";
process.env.AGENTOS_STATE_ROOT = path.join(scratch, "state");
process.env.WORKSPACE_LEASE_DIR = path.join(
  scratch,
  "state",
  "workspace-leases",
);
process.env.PROCESS_STATE_DIR = path.join(scratch, "state", "processes");
process.env.PROCESS_STATE_KEY_PATH = path.join(
  scratch,
  "state",
  "process.key",
);
process.env.PROCESS_LOG_DIR = path.join(
  scratch,
  "state",
  "processes",
  "logs",
);
process.env.TRANSACTION_DIR = path.join(scratch, "state", "transactions");
process.env.ALLOWED_DIRECTORIES = root;
process.env.MACOS_FILESYSTEM_PREFLIGHT = "false";
process.env.ALLOW_WRITE = "true";
process.env.ALLOW_DELETE = "true";
process.env.ALLOW_SHELL = "true";
process.env.ALLOW_ROLLBACK = "true";
process.env.WORKSPACE_LEASE_TTL_MS = "10000";
process.env.WORKSPACE_SESSION_RECLAIM_GRACE_MS = "0";

const {
  withExecutionContext,
} = await import("../src/runtime/executionContext.js");
const {
  RuntimeSessionManager,
  runtimeSessionManager,
} = await import("../src/runtime/runtimeSessionManager.js");
const { resolveLogicalOwnerIdentity } = await import(
  "../src/runtime/sessionIdentity.js"
);
const { executeRoutedAction } = await import(
  "../src/router/actionRouter.js"
);
const {
  beginTransaction,
  completeTransaction,
} = await import("../src/tools/transactionOps.js");
const {
  claimRecoveredProcess,
  executeCommand,
  getProcessOutput,
  killProcess,
  listProcesses,
  startProcess,
} = await import("../src/tools/shellOps.js");

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

async function waitForOutput(processId: string, pattern: RegExp) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const output = await getProcessOutput(processId, 10_000);
    const match = output.stdout.match(pattern);
    if (match) return match;
    await delay(50);
  }
  throw new Error(`Timed out waiting for process output: ${pattern}`);
}

execFileSync("git", ["init", "-q", repo]);
execFileSync("git", ["-C", repo, "config", "user.email", "verify@example.com"]);
execFileSync("git", ["-C", repo, "config", "user.name", "Verifier"]);
await fs.writeFile(path.join(repo, "base.txt"), "base\n", "utf8");
execFileSync("git", ["-C", repo, "add", "."]);
execFileSync("git", ["-C", repo, "commit", "-q", "-m", "base"]);

const stableA = resolveLogicalOwnerIdentity(
  { "x-computer-mcp-owner-id": "conversation-alpha" },
  "transport-a",
);
const stableB = resolveLogicalOwnerIdentity(
  { "x-computer-mcp-owner-id": "conversation-alpha" },
  "transport-b",
);
const fallbackA = resolveLogicalOwnerIdentity({}, "transport-a");
const fallbackB = resolveLogicalOwnerIdentity({}, "transport-b");
assert.equal(stableA.stable, true);
assert.equal(stableA.ownerId, stableB.ownerId);
assert.notEqual(stableA.ownerId, "conversation-alpha");
assert.notEqual(fallbackA.ownerId, fallbackB.ownerId);

const shortLivedSessions = new RuntimeSessionManager({
  staleMs: 15,
  retentionMs: 10_000,
});
shortLivedSessions.register("stale-transport");
await delay(30);
assert.equal(shortLivedSessions.summary().activeSessions, 0);
assert.ok(shortLivedSessions.status("stale-transport")?.disconnectedAt);

const transactionOwner = {
  sessionId: "tx-transport-a",
  ownerId: stableA.ownerId,
  requestId: "tx-request-a",
  origin: "mcp" as const,
};
const competingOwner = {
  sessionId: "tx-transport-other",
  ownerId: "owner_other",
  requestId: "tx-request-other",
  origin: "mcp" as const,
};

const tx = await withExecutionContext(transactionOwner, async () =>
  await beginTransaction(repo, "stability verifier"),
);
await withExecutionContext(transactionOwner, async () => {
  await executeRoutedAction("fs.write", {
    path: path.join(repo, "inside-transaction.txt"),
    content: "same logical owner can keep editing\n",
    overwrite: true,
    create_parents: true,
  });
});
await assert.rejects(
  () =>
    withExecutionContext(competingOwner, async () => {
      await executeRoutedAction("fs.write", {
        path: path.join(repo, "blocked.txt"),
        content: "must not write\n",
        overwrite: true,
        create_parents: true,
      });
    }),
  /WORKSPACE_BUSY/,
);
await withExecutionContext(transactionOwner, async () => {
  await completeTransaction(tx.id);
});

const ownerId = stableA.ownerId;
const processA = {
  sessionId: "process-transport-a",
  ownerId,
  requestId: "process-request-a",
  origin: "mcp" as const,
};
const processB = {
  sessionId: "process-transport-b",
  ownerId,
  requestId: "process-request-b",
  origin: "mcp" as const,
};
const stranger = {
  sessionId: "process-transport-stranger",
  ownerId: "owner_stranger",
  requestId: "process-request-stranger",
  origin: "mcp" as const,
};
runtimeSessionManager.register(processA.sessionId, { ownerId });
runtimeSessionManager.register(processB.sessionId, { ownerId });
runtimeSessionManager.register(stranger.sessionId, {
  ownerId: stranger.ownerId,
});

const managed = await withExecutionContext(processA, async () =>
  await startProcess("sleep 30 & echo CHILD:$!; wait", scratch, "read"),
);
const childMatch = await waitForOutput(managed.processId, /CHILD:(\d+)/);
const childPid = Number(childMatch[1]);
assert.ok(Number.isInteger(childPid) && childPid > 1);

await assert.rejects(
  () =>
    withExecutionContext(stranger, async () => {
      await killProcess(managed.processId);
    }),
  /PROCESS_OWNED/,
);
const killed = await withExecutionContext(processB, async () =>
  await killProcess(managed.processId),
);
assert.equal(killed.sent, true);
await delay(250);
if (pidAlive(childPid)) {
  try {
    process.kill(childPid, "SIGKILL");
  } catch {
    // cleanup best effort
  }
  assert.fail("Managed process-group kill left its child process alive.");
}

const orphanOwnerId = resolveLogicalOwnerIdentity(
  { "x-computer-mcp-owner-id": "conversation-orphan" },
  "orphan-a",
).ownerId;
const orphanA = {
  sessionId: "orphan-transport-a",
  ownerId: orphanOwnerId,
  requestId: "orphan-request-a",
  origin: "mcp" as const,
};
const orphanB = {
  sessionId: "orphan-transport-b",
  ownerId: orphanOwnerId,
  requestId: "orphan-request-b",
  origin: "mcp" as const,
};
runtimeSessionManager.register(orphanA.sessionId, { ownerId: orphanOwnerId });
runtimeSessionManager.register(orphanB.sessionId, { ownerId: orphanOwnerId });

const orphanProcess = await withExecutionContext(orphanA, async () =>
  await startProcess("sleep 30", scratch, "read"),
);
runtimeSessionManager.disconnect(orphanA.sessionId);
let orphanStatus = (await listProcesses()).find(
  (item) => item.processId === orphanProcess.processId,
);
assert.equal(orphanStatus?.orphaned, false);

runtimeSessionManager.disconnect(orphanB.sessionId);
orphanStatus = (await listProcesses()).find(
  (item) => item.processId === orphanProcess.processId,
);
assert.equal(orphanStatus?.orphaned, true);

const claimed = await withExecutionContext(stranger, async () =>
  await claimRecoveredProcess(orphanProcess.processId),
);
assert.equal(claimed.claimed, true);
await withExecutionContext(stranger, async () => {
  await killProcess(orphanProcess.processId, "SIGKILL");
});

const controller = new AbortController();
const cancellationContext = {
  sessionId: "cancel-transport",
  ownerId: "owner_cancel",
  requestId: "cancel-request",
  origin: "mcp" as const,
  signal: controller.signal,
};
const cancellationStarted = Date.now();
const cancelledPromise = withExecutionContext(cancellationContext, async () =>
  await executeCommand(
    "sleep 30 & echo CANCEL_CHILD:$!; wait",
    scratch,
    30_000,
  ),
);
setTimeout(() => controller.abort(new Error("verifier cancellation")), 100);
const cancelled = await cancelledPromise;
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.timedOut, false);
assert.ok(Date.now() - cancellationStarted < 5_000);
const cancelledChildMatch = cancelled.stdout.match(/CANCEL_CHILD:(\d+)/);
if (cancelledChildMatch) {
  const cancelledChildPid = Number(cancelledChildMatch[1]);
  await delay(250);
  if (pidAlive(cancelledChildPid)) {
    try {
      process.kill(cancelledChildPid, "SIGKILL");
    } catch {
      // cleanup best effort
    }
    assert.fail("Cancelled command left its child process alive.");
  }
}

runtimeSessionManager.disconnect(processA.sessionId);
runtimeSessionManager.disconnect(processB.sessionId);
runtimeSessionManager.disconnect(stranger.sessionId);
await fs.rm(scratch, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      logicalOwnerSurvivesTransportRotation: true,
      noUserAgentIdentityGuessing: true,
      staleSessionLifecycleBounded: true,
      transactionCreatorCanContinueEditing: true,
      competingOwnerStillBlocked: true,
      processOwnershipUsesLogicalOwner: true,
      processGroupTerminationPreventsChildOrphans: true,
      disconnectedProcessMarkedOrphaned: true,
      orphanExplicitClaim: true,
      executionCancellationTerminatesProcessGroup: true,
    },
    null,
    2,
  ),
);
