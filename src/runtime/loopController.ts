import { createHash } from "node:crypto";
import {
  createPersistentPrimitiveTask,
  getPersistentTaskStatus,
  runPersistentTask,
  validatePrimitiveTaskSteps,
  type PrimitiveTaskStep,
} from "../tasks/taskRuntime.js";
import {
  deleteLoopRecord,
  getLoopStorageInfo,
  listLoopRecords,
  newLoopId,
  readLoop,
  writeLoop,
  type LoopPhase,
  type PersistentLoop,
} from "./loopStore.js";

type CreateLoopInput = {
  label: string;
  phases: LoopPhase[];
  pollIntervalMs?: number;
  maxCycles?: number;
  endAt?: string;
  maxConcurrency?: number;
  failFast?: boolean;
  maxWaves?: number;
  timeBudgetMs?: number;
};

let loopTimer: NodeJS.Timeout | undefined;
let tickRunning = false;
const activeLoops = new Set<string>();

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function resolvePath(value: unknown, pathValue: string): unknown {
  const segments = pathValue.split(".").filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function resolveTaskRef(
  status: Awaited<ReturnType<typeof getPersistentTaskStatus>>,
  ref: string,
): unknown {
  const [stepId, ...segments] = ref.split(".").filter(Boolean);
  if (!stepId) throw new Error("Loop phase outputRef must start with a step id.");
  const step = status.steps.find((item) => item.id === stepId);
  if (!step) {
    throw new Error(`Loop phase outputRef references unknown step "${stepId}".`);
  }
  return resolvePath(step.result, segments.join("."));
}

function loopValue(loop: PersistentLoop, pathValue: string): unknown {
  if (pathValue === "lastOutput") return loop.lastOutput;
  if (pathValue === "cycleCount") return loop.cycleCount;
  if (pathValue === "transitionCount") return loop.transitionCount;
  if (pathValue.startsWith("phase.")) {
    return loop.phaseOutputs[pathValue.slice("phase.".length)];
  }
  throw new Error(`Unknown loop template reference "${pathValue}".`);
}

function resolveLoopTemplates(value: unknown, loop: PersistentLoop): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{loop\.([^}]+)\}\}$/.exec(value);
    if (exact) return loopValue(loop, exact[1]);

    return value.replace(/\{\{loop\.([^}]+)\}\}/g, (_match, ref: string) => {
      const resolved = loopValue(loop, ref);
      if (resolved === undefined || resolved === null) return "";
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveLoopTemplates(item, loop));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveLoopTemplates(item, loop),
      ]),
    );
  }

  return value;
}

function instantiatePhaseSteps(
  phase: LoopPhase,
  loop: PersistentLoop,
): PrimitiveTaskStep[] {
  return phase.steps.map((step) => ({
    ...step,
    args: resolveLoopTemplates(step.args ?? {}, loop) as Record<string, unknown>,
  }));
}

function currentPhase(loop: PersistentLoop): LoopPhase {
  const phase = loop.phases[loop.currentPhaseIndex];
  if (!phase) throw new Error("Persistent loop currentPhaseIndex is invalid.");
  return phase;
}

function summarize(loop: PersistentLoop) {
  return {
    id: loop.id,
    label: loop.label,
    enabled: loop.enabled,
    phase: currentPhase(loop).id,
    currentPhaseIndex: loop.currentPhaseIndex,
    phaseCount: loop.phases.length,
    cycleCount: loop.cycleCount,
    transitionCount: loop.transitionCount,
    pollIntervalMs: loop.pollIntervalMs,
    nextRunAt: loop.nextRunAt,
    maxCycles: loop.maxCycles ?? null,
    endAt: loop.endAt ?? null,
    activeTaskId: loop.activeTaskId ?? null,
    lastTaskId: loop.lastTaskId ?? null,
    lastTaskStatus: loop.lastTaskStatus ?? null,
    lastError: loop.lastError ?? null,
    stoppedReason: loop.stoppedReason ?? null,
    lastOutput: loop.lastOutput ?? null,
    phaseOutputs: loop.phaseOutputs,
    storage: getLoopStorageInfo(),
  };
}

export async function createPersistentLoop(input: CreateLoopInput) {
  const label = input.label.trim();
  if (!label) throw new Error("Loop label is required.");
  if (input.phases.length < 2) {
    throw new Error("A persistent loop requires at least two phases.");
  }
  if (input.phases.length > 16) {
    throw new Error("A persistent loop accepts at most 16 phases.");
  }

  const ids = new Set<string>();
  for (const phase of input.phases) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(phase.id)) {
      throw new Error(`Invalid loop phase id "${phase.id}".`);
    }
    if (ids.has(phase.id)) throw new Error(`Duplicate loop phase id "${phase.id}".`);
    ids.add(phase.id);
    if (phase.waitForChange && !phase.outputRef) {
      throw new Error(`Loop phase "${phase.id}" requires outputRef when waitForChange=true.`);
    }
    // Validate static topology now. Template placeholders are strings and remain
    // type-compatible for common text-based relay operations.
    validatePrimitiveTaskSteps(phase.steps);
  }

  const now = Date.now();
  let endAt: string | undefined;
  if (input.endAt) {
    const timestamp = Date.parse(input.endAt);
    if (!Number.isFinite(timestamp) || timestamp <= now) {
      throw new Error("Loop endAt must be a valid future ISO date/time.");
    }
    endAt = new Date(timestamp).toISOString();
  }

  let maxCycles: number | undefined;
  if (input.maxCycles !== undefined) {
    maxCycles = Math.trunc(input.maxCycles);
    if (!Number.isFinite(maxCycles) || maxCycles < 1) {
      throw new Error("Loop maxCycles must be >= 1.");
    }
  }

  const createdAt = new Date(now).toISOString();
  const loop: PersistentLoop = {
    version: 1,
    id: newLoopId(),
    label,
    createdAt,
    updatedAt: createdAt,
    enabled: true,
    phases: input.phases,
    currentPhaseIndex: 0,
    cycleCount: 0,
    transitionCount: 0,
    pollIntervalMs: Math.min(
      Math.max(Math.trunc(input.pollIntervalMs ?? 5_000), 1_000),
      10 * 60_000,
    ),
    nextRunAt: new Date(now).toISOString(),
    ...(maxCycles ? { maxCycles } : {}),
    ...(endAt ? { endAt } : {}),
    phaseOutputs: {},
    phaseHashes: {},
    taskRuntime: {
      maxConcurrency: Math.min(
        Math.max(Math.trunc(input.maxConcurrency ?? 4), 1),
        8,
      ),
      failFast: input.failFast ?? true,
      maxWaves: Math.min(
        Math.max(Math.trunc(input.maxWaves ?? 100), 1),
        1000,
      ),
      timeBudgetMs: Math.min(
        Math.max(Math.trunc(input.timeBudgetMs ?? 60_000), 1_000),
        10 * 60_000,
      ),
    },
  };

  await writeLoop(loop);
  return summarize(loop);
}

function advance(loop: PersistentLoop, output: unknown, phase: LoopPhase): void {
  if (phase.outputRef) {
    loop.lastOutput = output;
    loop.phaseOutputs[phase.id] = output;
    loop.phaseHashes[phase.id] = stableHash(output);
  }

  loop.currentPhaseIndex += 1;
  loop.transitionCount += 1;
  if (loop.currentPhaseIndex >= loop.phases.length) {
    loop.currentPhaseIndex = 0;
    loop.cycleCount += 1;
  }
}

async function executeLoop(loopId: string): Promise<void> {
  if (activeLoops.has(loopId)) return;
  activeLoops.add(loopId);

  try {
    const loop = await readLoop(loopId);
    if (!loop.enabled) return;

    const now = Date.now();
    if (loop.endAt && now > Date.parse(loop.endAt)) {
      loop.enabled = false;
      loop.nextRunAt = null;
      loop.stoppedReason = "Reached loop endAt.";
      await writeLoop(loop);
      return;
    }

    const phase = currentPhase(loop);
    let taskId = loop.activeTaskId;

    if (!taskId) {
      const steps = instantiatePhaseSteps(phase, loop);
      const created = await createPersistentPrimitiveTask(
        `${loop.label} / ${phase.label ?? phase.id}`,
        steps,
        {
          maxConcurrency: loop.taskRuntime.maxConcurrency,
          failFast: loop.taskRuntime.failFast,
        },
      );
      taskId = created.id;
      loop.activeTaskId = taskId;
      loop.lastTaskId = taskId;
      loop.lastTaskStatus = created.status;
      loop.lastError = undefined;
      await writeLoop(loop);
    }

    try {
      const run = await runPersistentTask(taskId, {
        maxConcurrency: loop.taskRuntime.maxConcurrency,
        failFast: loop.taskRuntime.failFast,
        maxWaves: loop.taskRuntime.maxWaves,
        timeBudgetMs: loop.taskRuntime.timeBudgetMs,
      });
      loop.lastTaskStatus = run.status;
    } catch (error) {
      loop.lastError = error instanceof Error ? error.message : String(error);
    }

    const status = await getPersistentTaskStatus(taskId, true);
    loop.lastTaskStatus = status.status;

    if (["failed", "blocked", "cancelled"].includes(status.status)) {
      loop.enabled = false;
      loop.nextRunAt = null;
      loop.stoppedReason =
        `Loop phase "${phase.id}" task ${taskId} ended with status ${status.status}.`;
      loop.activeTaskId = undefined;
      await writeLoop(loop);
      return;
    }

    if (status.status !== "completed") {
      loop.nextRunAt = new Date(Date.now() + loop.pollIntervalMs).toISOString();
      await writeLoop(loop);
      return;
    }

    const output = phase.outputRef ? resolveTaskRef(status, phase.outputRef) : undefined;
    const previousHash = loop.phaseHashes[phase.id];
    const outputHash = phase.outputRef ? stableHash(output) : undefined;

    loop.activeTaskId = undefined;

    if (
      phase.waitForChange &&
      phase.outputRef &&
      previousHash !== undefined &&
      outputHash === previousHash
    ) {
      loop.nextRunAt = new Date(Date.now() + loop.pollIntervalMs).toISOString();
      await writeLoop(loop);
      return;
    }

    advance(loop, output, phase);

    if (loop.maxCycles && loop.cycleCount >= loop.maxCycles) {
      loop.enabled = false;
      loop.nextRunAt = null;
      loop.stoppedReason = `Reached maxCycles=${loop.maxCycles}.`;
      await writeLoop(loop);
      return;
    }

    loop.nextRunAt = new Date(Date.now() + loop.pollIntervalMs).toISOString();
    await writeLoop(loop);
  } finally {
    activeLoops.delete(loopId);
  }
}

function controllerPollMs(): number {
  const raw = Number(process.env.LOOP_CONTROLLER_POLL_MS);
  if (Number.isFinite(raw)) {
    return Math.min(Math.max(Math.trunc(raw), 1_000), 60_000);
  }
  return 5_000;
}

export async function runLoopControllerTick(nowMs = Date.now()) {
  if (tickRunning) return { skipped: true, reason: "tick_already_running" };
  tickRunning = true;
  try {
    const loops = await listLoopRecords();
    const due = loops.filter(
      (loop) =>
        loop.enabled &&
        loop.nextRunAt !== null &&
        Date.parse(loop.nextRunAt) <= nowMs,
    );

    for (const loop of due) {
      await executeLoop(loop.id);
    }

    return {
      skipped: false,
      checked: loops.length,
      due: due.length,
      ran: due.map((item) => item.id),
    };
  } finally {
    tickRunning = false;
  }
}

export function startPersistentLoopController() {
  if (loopTimer) {
    return { started: false, pollMs: controllerPollMs() };
  }

  const pollMs = controllerPollMs();
  void runLoopControllerTick().catch((error) => {
    console.error(
      "AgentOS loop controller initial tick failed:",
      error instanceof Error ? error.message : String(error),
    );
  });

  loopTimer = setInterval(() => {
    void runLoopControllerTick().catch((error) => {
      console.error(
        "AgentOS loop controller tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
  }, pollMs);
  loopTimer.unref();

  return { started: true, pollMs };
}

export async function listPersistentLoops() {
  return (await listLoopRecords()).map(summarize);
}

export async function getPersistentLoop(id: string) {
  return summarize(await readLoop(id));
}

export async function cancelPersistentLoop(id: string) {
  const loop = await readLoop(id);
  loop.enabled = false;
  loop.nextRunAt = null;
  loop.stoppedReason = "Cancelled.";
  await writeLoop(loop);
  return summarize(loop);
}

export async function deletePersistentLoop(id: string) {
  if (activeLoops.has(id)) {
    throw new Error("Cannot delete a loop while it is executing.");
  }
  const loop = await readLoop(id);
  await deleteLoopRecord(id);
  return {
    id,
    deleted: true,
    lastTaskId: loop.lastTaskId ?? null,
  };
}
