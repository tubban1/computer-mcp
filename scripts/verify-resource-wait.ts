import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.join(root, ".tmp-verify-resource-wait");
const probe = path.join(scratch, "probe.txt");

await fs.rm(scratch, { recursive: true, force: true });
await fs.mkdir(scratch, { recursive: true });
await fs.writeFile(probe, "resource-wait-ok\n");

process.env.AGENTOS_RUNTIME_MODE = "test";
process.env.AGENTOS_STATE_ROOT = path.join(scratch, "state");
process.env.ALLOWED_DIRECTORIES = root;
process.env.ALLOW_WRITE = "true";
process.env.MCP_RESOURCE_WAIT_TIMEOUT_MS = "250";

const { resourceArbiter } = await import(
  "../src/runtime/resourceArbiter.js"
);
const { executeRoutedAction } = await import(
  "../src/router/actionRouter.js"
);
const { withExecutionContext } = await import(
  "../src/runtime/executionContext.js"
);

const context = (requestId: string, signal?: AbortSignal) => ({
  sessionId: "resource-wait-session",
  ownerId: "resource-wait-owner",
  requestId,
  origin: "mcp" as const,
  signal,
});

async function withSafetyDeadline<T>(
  promise: Promise<T>,
  timeoutMs = 2_000,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("VERIFIER_DEADLINE: resource wait did not settle.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

try {
  const resourceKey = `fs:${probe}`;

  // A blocked MCP action must fail within the bounded resource-wait budget
  // instead of silently waiting until the outer transport times out.
  const timeoutHolder = await resourceArbiter.acquire(
    "verify-timeout-holder",
    [{ key: resourceKey, mode: "exclusive" }],
  );
  const timeoutStartedAt = Date.now();
  await assert.rejects(
    withSafetyDeadline(
      withExecutionContext(context("timeout"), async () =>
        await executeRoutedAction("fs.read", { path: probe }),
      ),
    ),
    (error: unknown) =>
      error instanceof Error &&
      /RESOURCE_WAIT_TIMEOUT/.test(error.message),
  );
  const timeoutElapsedMs = Date.now() - timeoutStartedAt;
  assert.ok(
    timeoutElapsedMs >= 200 && timeoutElapsedMs < 1000,
    `resource wait timeout completed in unexpected ${timeoutElapsedMs}ms`,
  );
  assert.equal(resourceArbiter.status().pending.length, 0);
  assert.equal(resourceArbiter.status().heldTickets, 1);
  timeoutHolder.release();
  assert.equal(resourceArbiter.status().heldTickets, 0);

  // MCP/HTTP cancellation must remove the queued resource waiter immediately.
  process.env.MCP_RESOURCE_WAIT_TIMEOUT_MS = "3000";
  const cancelHolder = await resourceArbiter.acquire(
    "verify-cancel-holder",
    [{ key: resourceKey, mode: "exclusive" }],
  );
  const controller = new AbortController();
  const cancelStartedAt = Date.now();
  const cancelled = withExecutionContext(
    context("cancel", controller.signal),
    async () => await executeRoutedAction("fs.read", { path: probe }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort(new Error("resource wait verifier cancellation"));

  await assert.rejects(
    withSafetyDeadline(cancelled),
    (error: unknown) =>
      error instanceof Error &&
      /RESOURCE_WAIT_CANCELLED/.test(error.message),
  );
  const cancelElapsedMs = Date.now() - cancelStartedAt;
  assert.ok(
    cancelElapsedMs < 750,
    `resource wait cancellation took ${cancelElapsedMs}ms`,
  );
  assert.equal(resourceArbiter.status().pending.length, 0);
  assert.equal(resourceArbiter.status().heldTickets, 1);
  cancelHolder.release();
  assert.equal(resourceArbiter.status().heldTickets, 0);

  // A timed-out/cancelled waiter must not poison later resource acquisition.
  const read = await withExecutionContext(context("post-cancel"), async () =>
    await executeRoutedAction("fs.read", { path: probe }),
  );
  assert.equal(read.result, "resource-wait-ok\n");
  assert.equal(resourceArbiter.status().pending.length, 0);
  assert.equal(resourceArbiter.status().heldTickets, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mcpResourceWaitTimeoutMs: 250,
        timeoutElapsedMs,
        resourceWaitCancellationPropagated: true,
        cancelElapsedMs,
        timedOutWaiterRemoved: true,
        cancelledWaiterRemoved: true,
        subsequentAcquisitionHealthy: true,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
