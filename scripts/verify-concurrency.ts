import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-concurrency");
const parentWorkspace = path.join(scratch, "parent");
const repoA = path.join(parentWorkspace, "repo-a");
const repoB = path.join(parentWorkspace, "repo-b");
const repoTx = path.join(parentWorkspace, "repo-tx");

await fs.rm(scratch, { recursive: true, force: true });
for (const dir of [parentWorkspace, repoA, repoB]) {
  await fs.mkdir(path.join(dir, ".git"), { recursive: true });
}
await fs.mkdir(repoTx, { recursive: true });

process.env.AGENTOS_RUNTIME_MODE = "test";
process.env.AGENTOS_STATE_ROOT = path.join(scratch, "state");
process.env.WORKSPACE_LEASE_DIR = path.join(
  scratch,
  "state",
  "workspace-leases",
);
process.env.PROCESS_STATE_DIR = path.join(scratch, "state", "processes");
process.env.PROCESS_STATE_KEY_PATH = path.join(scratch, "state", "process.key");
process.env.PROCESS_LOG_DIR = path.join(
  scratch,
  "state",
  "processes",
  "logs",
);
process.env.TRANSACTION_DIR = path.join(scratch, "state", "transactions");
process.env.ALLOWED_DIRECTORIES = root;
process.env.ALLOW_WRITE = "true";
process.env.ALLOW_DELETE = "true";
process.env.ALLOW_SHELL = "true";
process.env.ALLOW_ROLLBACK = "true";
process.env.WORKSPACE_LEASE_TTL_MS = "10000";
process.env.WORKSPACE_SESSION_RECLAIM_GRACE_MS = "0";

const { withExecutionContext } = await import(
  "../src/runtime/executionContext.js"
);
const { executeRoutedAction } = await import(
  "../src/router/actionRouter.js"
);
const { resourceArbiter } = await import(
  "../src/runtime/resourceArbiter.js"
);
const {
  assertWorkspaceWriteAllowed,
  ensureWorkspaceWriteLease,
  getWorkspaceLeaseStorageInfo,
  releaseWorkspaceLease,
  releaseWorkspaceLeasesForTask,
  workspaceLeaseStatus,
} = await import("../src/runtime/workspaceLeaseManager.js");
const {
  claimRecoveredProcess,
  getProcessOutput,
  listProcesses,
  reconcilePersistentProcesses,
} = await import("../src/tools/shellOps.js");
const { runtimeSessionManager } = await import(
  "../src/runtime/runtimeSessionManager.js"
);
const {
  beginTransaction,
  completeTransaction,
} = await import("../src/tools/transactionOps.js");
const { batchEditFiles } = await import("../src/tools/fileOps.js");

const sessionA = {
  sessionId: "session-concurrency-A",
  requestId: "request-A",
  origin: "mcp" as const,
};
const sessionB = {
  sessionId: "session-concurrency-B",
  requestId: "request-B",
  origin: "mcp" as const,
};
const sessionC = {
  sessionId: "session-concurrency-C",
  requestId: "request-C",
  origin: "mcp" as const,
};
const sessionD = {
  sessionId: "session-concurrency-D",
  requestId: "request-D",
  origin: "mcp" as const,
};
runtimeSessionManager.register(sessionA.sessionId);
runtimeSessionManager.register(sessionB.sessionId);
runtimeSessionManager.register(sessionC.sessionId);
runtimeSessionManager.register(sessionD.sessionId);

const fileA = path.join(repoA, "a.txt");
const fileB = path.join(repoB, "b.txt");
const batchFile = path.join(repoB, "batch.txt");
let processId = "";

try {
  // Ordinary writes are action-scoped: they do not leave a long transport
  // session lease behind after the action returns.
  await withExecutionContext(sessionA, async () => {
    await executeRoutedAction("fs.write", {
      path: fileA,
      content: "A\n",
      overwrite: true,
      create_parents: true,
    });
  });
  assert.equal((await workspaceLeaseStatus(repoA)).busy, false);
  await withExecutionContext(sessionB, async () => {
    await executeRoutedAction("fs.write", {
      path: fileA,
      content: "B after A action completed\n",
      overwrite: true,
      create_parents: true,
    });
  });

  // Sibling repositories can run shell work concurrently.
  const siblingStarted = Date.now();
  const [siblingAResult, siblingBResult] = await Promise.all([
    withExecutionContext(sessionA, async () =>
      await executeRoutedAction("shell.exec", {
        command: "sleep 1.2",
        cwd: repoA,
        workspace_mode: "write",
        timeout_ms: 10000,
      }),
    ),
    withExecutionContext(sessionB, async () =>
      await executeRoutedAction("shell.exec", {
        command: "sleep 1.2",
        cwd: repoB,
        workspace_mode: "write",
        timeout_ms: 10000,
      }),
    ),
  ]);
  const siblingWallMs = Date.now() - siblingStarted;
  assert.ok(
    siblingAResult.resourceWaitMs < 500 &&
      siblingBResult.resourceWaitMs < 500,
    `sibling repositories unexpectedly waited on AgentOS resources: A=${siblingAResult.resourceWaitMs}ms B=${siblingBResult.resourceWaitMs}ms wall=${siblingWallMs}ms`,
  );

  // Parent/child workspaces are hierarchically conflicting. A broad shell
  // operation at parent scope cannot race a nested repo mutation.
  const parentStarted = Date.now();
  const parentRun = withExecutionContext(sessionA, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 1.2",
      cwd: parentWorkspace,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const childRun = withExecutionContext(sessionB, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 0.1",
      cwd: repoA,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  const [, childResult] = await Promise.all([parentRun, childRun]);
  const hierarchicalWallMs = Date.now() - parentStarted;
  assert.ok(hierarchicalWallMs >= 1150);
  assert.ok(childResult.resourceWaitMs >= 800);

  // Observation must stay responsive while unrelated workspace mutation is
  // active. Exact-path fs resources still protect direct file-vs-file races,
  // but a broad shell writer must not freeze read_file/list_directory across
  // the entire repository tree.
  const observationWriter = withExecutionContext(sessionA, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 1.2",
      cwd: parentWorkspace,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const observationStarted = Date.now();
  const [readObservation, listObservation] = await Promise.all([
    withExecutionContext(sessionB, async () =>
      await executeRoutedAction("fs.read", { path: fileA }),
    ),
    withExecutionContext(sessionB, async () =>
      await executeRoutedAction("fs.list", { path: parentWorkspace }),
    ),
  ]);
  const observationWallMs = Date.now() - observationStarted;
  assert.ok(
    observationWallMs < 500,
    `read-only observation waited ${observationWallMs}ms behind an unrelated workspace writer`,
  );
  assert.ok(readObservation.resourceWaitMs < 250);
  assert.ok(listObservation.resourceWaitMs < 250);
  await observationWriter;

  // Removing coarse read workspace locks must not remove exact-path safety.
  // Hold the same fs:<path> exclusively and prove a read waits until release.
  const exactPathLease = await resourceArbiter.acquire(
    "verify-exact-path-write",
    [{ key: `fs:${fileA}`, mode: "exclusive" }],
  );
  let exactPathReadSettled = false;
  const exactPathRead = withExecutionContext(sessionB, async () =>
    await executeRoutedAction("fs.read", { path: fileA }),
  ).then((value) => {
    exactPathReadSettled = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    exactPathReadSettled,
    false,
    "same-path read bypassed the exact filesystem write resource",
  );
  exactPathLease.release();
  const exactPathReadResult = await exactPathRead;
  assert.ok(exactPathReadResult.resourceWaitMs >= 75);

  // Resource waits must honor transport cancellation and leave no ghost
  // pending request behind.
  const cancellationBlocker = withExecutionContext(sessionA, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 1.0",
      cwd: parentWorkspace,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const cancellationController = new AbortController();
  const cancellationContext = {
    ...sessionB,
    requestId: "request-resource-cancel",
    signal: cancellationController.signal,
  };
  const cancellationStarted = Date.now();
  const cancelledWait = withExecutionContext(cancellationContext, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 0.1",
      cwd: repoA,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  setTimeout(
    () => cancellationController.abort(new Error("verify cancellation")),
    100,
  ).unref();
  await assert.rejects(cancelledWait, /RESOURCE_WAIT_CANCELLED/);
  const cancellationWallMs = Date.now() - cancellationStarted;
  assert.ok(
    cancellationWallMs < 750,
    `cancelled resource wait lingered for ${cancellationWallMs}ms`,
  );
  assert.equal(resourceArbiter.status().pending.length, 0);
  await cancellationBlocker;

  // Interactive MCP contention must fail explicitly before the outer
  // transport/gateway timeout.
  process.env.MCP_RESOURCE_WAIT_TIMEOUT_MS = "250";
  const timeoutBlocker = withExecutionContext(sessionA, async () =>
    await executeRoutedAction("shell.exec", {
      command: "sleep 0.9",
      cwd: parentWorkspace,
      workspace_mode: "write",
      timeout_ms: 10000,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const resourceTimeoutStarted = Date.now();
  await assert.rejects(
    () =>
      withExecutionContext(sessionB, async () =>
        await executeRoutedAction("shell.exec", {
          command: "sleep 0.1",
          cwd: repoA,
          workspace_mode: "write",
          timeout_ms: 10000,
        }),
      ),
    /RESOURCE_WAIT_TIMEOUT/,
  );
  const resourceTimeoutWallMs = Date.now() - resourceTimeoutStarted;
  assert.ok(
    resourceTimeoutWallMs < 750,
    `resource timeout exceeded bounded wait: ${resourceTimeoutWallMs}ms`,
  );
  assert.equal(resourceArbiter.status().pending.length, 0);
  await timeoutBlocker;
  delete process.env.MCP_RESOURCE_WAIT_TIMEOUT_MS;

  // Durable Task ownership is keyed by task id, not transport session id.
  const taskId = "task_concurrency_verifier";
  const taskContextA = {
    ...sessionA,
    origin: "task" as const,
    taskId,
  };
  const taskContextB = {
    ...sessionB,
    requestId: "request-task-B",
    origin: "task" as const,
    taskId,
  };
  const taskLease = await withExecutionContext(taskContextA, async () =>
    await ensureWorkspaceWriteLease(repoA, {
      purpose: "verify task-scoped workspace ownership",
    }),
  );
  assert.equal(taskLease.ownerTaskId, taskId);

  // Same durable task survives a transport-session change.
  const renewed = await withExecutionContext(taskContextB, async () =>
    await ensureWorkspaceWriteLease(repoA, {
      purpose: "same task after transport change",
    }),
  );
  assert.equal(renewed.id, taskLease.id);

  // Another task/session may read, but may not mutate the owned workspace.
  await withExecutionContext(sessionB, async () => {
    await executeRoutedAction("fs.read", { path: fileA });
  });
  await assert.rejects(
    () =>
      withExecutionContext(sessionB, async () =>
        await executeRoutedAction("fs.write", {
          path: fileA,
          content: "blocked\n",
          overwrite: true,
          create_parents: true,
        }),
      ),
    /WORKSPACE_BUSY/,
  );
  assert.equal(await releaseWorkspaceLeasesForTask(taskId), 1);

  // Long-running processes own a durable process:<id> workspace lease.
  const started = await withExecutionContext(sessionA, async () =>
    await executeRoutedAction("shell.start", {
      command: "sleep 20",
      cwd: repoA,
      workspace_mode: "write",
    }),
  );
  const processResult = started.result as {
    processId: string;
    ownerSessionId: string;
    durable: boolean;
  };
  processId = processResult.processId;
  assert.equal(processResult.durable, true);
  assert.equal(
    (await workspaceLeaseStatus(repoA)).lease?.ownerTaskId,
    `process:${processId}`,
  );

  await assert.rejects(
    () =>
      withExecutionContext(sessionB, async () =>
        await executeRoutedAction("fs.write", {
          path: fileA,
          content: "blocked by process\n",
          overwrite: true,
          create_parents: true,
        }),
      ),
    /WORKSPACE_BUSY/,
  );
  await assert.rejects(
    () =>
      withExecutionContext(sessionB, async () =>
        await executeRoutedAction("shell.kill", {
          process_id: processId,
          signal: "SIGTERM",
        }),
      ),
    /PROCESS_OWNED/,
  );

  // If the original transport disconnects, an explicit claim transfers
  // control without changing the durable process:<id> workspace owner.
  runtimeSessionManager.disconnect(sessionA.sessionId);
  const claimed = await withExecutionContext(sessionB, async () =>
    await claimRecoveredProcess(processId),
  );
  assert.equal(claimed.ownerSessionId, sessionB.sessionId);
  assert.equal(
    (await workspaceLeaseStatus(repoA)).lease?.ownerTaskId,
    `process:${processId}`,
  );

  await withExecutionContext(sessionB, async () =>
    await executeRoutedAction("shell.kill", {
      process_id: processId,
      signal: "SIGTERM",
    }),
  );
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await reconcilePersistentProcesses();
    const record = (await listProcesses()).find(
      (item) => item.processId === processId,
    );
    if (record && !record.running) break;
  }
  assert.equal(
    (await listProcesses()).find((item) => item.processId === processId)
      ?.running,
    false,
  );
  assert.equal((await workspaceLeaseStatus(repoA)).busy, false);
  processId = "";

  // Natural process exit must converge without an explicit kill or Runtime
  // restart. This protects against ghost "running" records and pinned workspace
  // leases after a background validator finishes while the client stream is
  // interrupted.
  const naturalExit = await withExecutionContext(sessionB, async () =>
    await executeRoutedAction("shell.start", {
      command: "sleep 0.2",
      cwd: repoB,
      workspace_mode: "write",
    }),
  );
  const naturalProcessId = (naturalExit.result as { processId: string }).processId;
  await new Promise((resolve) => setTimeout(resolve, 600));
  const naturalOutput = await getProcessOutput(naturalProcessId);
  assert.equal(naturalOutput.running, false);
  assert.ok(
    naturalOutput.status === "exited" || naturalOutput.status === "lost",
    `natural process did not converge: ${naturalOutput.status}`,
  );
  assert.equal((await workspaceLeaseStatus(repoB)).busy, false);

  // Old unpinned session-only leases are reaped after Runtime identity changes.
  const orphan = await withExecutionContext(sessionB, async () =>
    await ensureWorkspaceWriteLease(repoB, {
      purpose: "simulate previous-runtime session lease",
    }),
  );
  const leaseDir = getWorkspaceLeaseStorageInfo().directory;
  const leaseName =
    createHash("sha256").update(path.resolve(repoB)).digest("hex") +
    ".lease.json";
  const leasePath = path.join(leaseDir, leaseName);
  const rawLease = JSON.parse(await fs.readFile(leasePath, "utf8"));
  rawLease.runtimeInstanceId = "previous-runtime-instance";
  await fs.writeFile(leasePath, JSON.stringify(rawLease, null, 2) + "\n");
  assert.equal((await workspaceLeaseStatus(repoB)).busy, false);

  // A session-only lease is also reclaimable inside the same Runtime after the
  // owning transport disconnects and the short reconnect grace window passes.
  const disconnectedLease = await withExecutionContext(sessionC, async () =>
    await ensureWorkspaceWriteLease(repoB, {
      purpose: "same-runtime disconnected session lease",
    }),
  );
  assert.equal(disconnectedLease.ownerSessionId, sessionC.sessionId);
  runtimeSessionManager.disconnect(sessionC.sessionId);
  const reclaimed = await withExecutionContext(sessionB, async () =>
    await ensureWorkspaceWriteLease(repoB, {
      purpose: "reclaimed after transport reconnect",
    }),
  );
  assert.equal(reclaimed.ownerSessionId, sessionB.sessionId);
  await withExecutionContext(sessionB, async () =>
    await releaseWorkspaceLease(repoB),
  );

  // Chat stream recovery can leave a transport session looking active even
  // though it never makes another call. Session-only leases are reclaimable
  // after a conservative idle timeout. The verifier sets that timeout to zero
  // only for this isolated test.
  process.env.WORKSPACE_SESSION_IDLE_RECLAIM_MS = "0";
  const idleLease = await withExecutionContext(sessionD, async () =>
    await ensureWorkspaceWriteLease(repoB, {
      purpose: "same-runtime stale active session lease",
    }),
  );
  assert.equal(idleLease.ownerSessionId, sessionD.sessionId);
  const idleReclaimed = await withExecutionContext(sessionB, async () =>
    await ensureWorkspaceWriteLease(repoB, {
      purpose: "reclaimed after stale active transport",
    }),
  );
  assert.equal(idleReclaimed.ownerSessionId, sessionB.sessionId);
  await withExecutionContext(sessionB, async () =>
    await releaseWorkspaceLease(repoB),
  );
  delete process.env.WORKSPACE_SESSION_IDLE_RECLAIM_MS;

  // batch_edit_files composes multiple edits against the same in-memory file.
  await fs.writeFile(batchFile, "alpha beta gamma\n");
  const batch = await batchEditFiles([
    {
      path: batchFile,
      oldText: "alpha",
      newText: "ALPHA",
    },
    {
      path: batchFile,
      oldText: "beta",
      newText: "BETA",
    },
  ]);
  assert.equal(batch.length, 2);
  assert.equal(await fs.readFile(batchFile, "utf8"), "ALPHA BETA gamma\n");

  // Transaction ownership is transaction:<txId>, so completion may arrive
  // over another MCP transport session.
  execFileSync("git", ["init", "-q", repoTx]);
  execFileSync("git", ["-C", repoTx, "config", "user.email", "verify@example.test"]);
  execFileSync("git", ["-C", repoTx, "config", "user.name", "Verifier"]);
  await fs.writeFile(path.join(repoTx, "tracked.txt"), "baseline\n");
  execFileSync("git", ["-C", repoTx, "add", "tracked.txt"]);
  execFileSync("git", ["-C", repoTx, "commit", "-qm", "baseline"]);
  const tx = await withExecutionContext(sessionA, async () =>
    await beginTransaction(repoTx, "cross-transport verifier"),
  );
  assert.equal(
    (await workspaceLeaseStatus(repoTx)).lease?.ownerTaskId,
    `transaction:${tx.id}`,
  );
  await withExecutionContext(sessionB, async () =>
    await completeTransaction(tx.id, false),
  );
  assert.equal((await workspaceLeaseStatus(repoTx)).busy, false);

  // Production Runtime may not mutate its own active release.
  process.env.AGENTOS_RUNTIME_MODE = "production";
  await assert.rejects(
    () =>
      withExecutionContext(sessionB, async () =>
        await assertWorkspaceWriteAllowed(root),
      ),
    /RUNTIME_SELF_IMMUTABLE/,
  );
  process.env.AGENTOS_RUNTIME_MODE = "test";

  console.log(
    JSON.stringify(
      {
        ok: true,
        adHocWritesAreActionScoped: true,
        siblingWorkspacesConcurrent: true,
        siblingWallMs,
        hierarchicalActionLocks: true,
        hierarchicalWallMs,
        readOnlyObservationNotBlockedByWorkspaceWriter: true,
        observationWallMs,
        exactPathReadWriteConflictPreserved: true,
        resourceWaitCancellation: true,
        cancellationWallMs,
        boundedInteractiveResourceWait: true,
        resourceTimeoutWallMs,
        taskOwnershipTransportIndependent: true,
        processScopedWorkspaceLease: true,
        disconnectedProcessClaim: true,
        processExitReleasesLease: true,
        naturalProcessExitReconciles: true,
        orphanSessionLeaseReclamation: true,
        sameRuntimeDisconnectedSessionReclamation: true,
        staleActiveSessionReclamation: true,
        transactionOwnershipTransportIndependent: true,
        sameFileBatchEditsCompose: true,
        runtimeSelfProductionGuard: true,
      },
      null,
      2,
    ),
  );
} finally {
  process.env.AGENTOS_RUNTIME_MODE = "test";
  if (processId) {
    runtimeSessionManager.disconnect(sessionA.sessionId);
    await withExecutionContext(sessionB, async () => {
      await claimRecoveredProcess(processId).catch(() => undefined);
      await executeRoutedAction("shell.kill", {
        process_id: processId,
        signal: "SIGKILL",
      }).catch(() => undefined);
    });
  }
  await releaseWorkspaceLease(repoA, { force: true }).catch(() => undefined);
  await releaseWorkspaceLease(repoB, { force: true }).catch(() => undefined);
  await releaseWorkspaceLease(repoTx, { force: true }).catch(() => undefined);
  await fs.rm(scratch, { recursive: true, force: true });
}
