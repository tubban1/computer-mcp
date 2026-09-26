import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  currentExecutionContext,
  executionOwnerKey,
} from "./executionContext.js";
import { runtimeStatePath } from "./runtimePaths.js";
import {
  ensureWorkspaceWriteLease,
  releaseWorkspaceLease,
  workspaceLeaseStatus,
  type WorkspaceLeaseRecord,
} from "./workspaceLeaseManager.js";
import { resolveWorkspace } from "./workspaceResolver.js";

export type WorkspaceHandoffStatus =
  | "requested"
  | "released"
  | "completed"
  | "cancelled";

export type WorkspaceHandoffRecord = {
  version: 1;
  id: string;
  workspace: string;
  status: WorkspaceHandoffStatus;
  requestedAt: string;
  updatedAt: string;
  requesterSessionId: string;
  requesterTaskId?: string;
  requesterOwnerKey: string;
  purpose?: string;
  sourceLeaseId?: string;
  sourceOwnerKey?: string;
  releasedAt?: string;
  completedAt?: string;
  acquiredLeaseId?: string;
};

function handoffDir(): string {
  return (
    process.env.WORKSPACE_HANDOFF_DIR?.trim() ||
    runtimeStatePath("workspace-handoffs")
  );
}

function recordPath(id: string): string {
  return path.join(handoffDir(), `${id}.json`);
}

async function ensureDir() {
  await fs.mkdir(handoffDir(), { recursive: true, mode: 0o700 });
  await fs.chmod(handoffDir(), 0o700).catch(() => undefined);
}

async function writeRecord(record: WorkspaceHandoffRecord) {
  await ensureDir();
  record.updatedAt = new Date().toISOString();
  const target = recordPath(record.id);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(record, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temp, target);
  await fs.chmod(target, 0o600).catch(() => undefined);
}

export async function readWorkspaceHandoff(
  id: string,
): Promise<WorkspaceHandoffRecord> {
  await ensureDir();
  const parsed = JSON.parse(
    await fs.readFile(recordPath(id), "utf8"),
  ) as WorkspaceHandoffRecord;
  if (parsed.version !== 1 || parsed.id !== id) {
    throw new Error(`Workspace handoff ${id} is invalid.`);
  }
  return parsed;
}

export async function listWorkspaceHandoffs() {
  await ensureDir();
  const names = await fs.readdir(handoffDir());
  const records: WorkspaceHandoffRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      records.push(
        JSON.parse(
          await fs.readFile(path.join(handoffDir(), name), "utf8"),
        ) as WorkspaceHandoffRecord,
      );
    } catch {
      // One damaged receipt must not hide healthy handoff records.
    }
  }
  return records.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function requestWorkspaceTakeover(
  workspaceInput: string,
  purpose?: string,
) {
  const workspace = await resolveWorkspace(workspaceInput);
  const current = await workspaceLeaseStatus(workspace);
  const context = currentExecutionContext();
  const now = new Date().toISOString();

  if (!current.lease) {
    return {
      requested: false,
      workspace,
      available: true,
      reason: "workspace_already_available",
    };
  }

  const record: WorkspaceHandoffRecord = {
    version: 1,
    id: `handoff_${Date.now().toString(36)}_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)}`,
    workspace,
    status: "requested",
    requestedAt: now,
    updatedAt: now,
    requesterSessionId: context.sessionId,
    ...(context.taskId ? { requesterTaskId: context.taskId } : {}),
    requesterOwnerKey: executionOwnerKey(context),
    ...(purpose?.trim() ? { purpose: purpose.trim() } : {}),
    sourceLeaseId: current.lease.id,
    sourceOwnerKey: current.lease.ownerKey,
  };
  await writeRecord(record);
  return {
    requested: true,
    request: record,
    currentLease: current.lease,
  };
}

function assertSourceLeaseMatches(
  record: WorkspaceHandoffRecord,
  lease: WorkspaceLeaseRecord | null,
) {
  if (!lease) {
    throw new Error(
      "HANDOFF_SOURCE_CHANGED: the original workspace lease no longer exists.",
    );
  }
  if (
    lease.id !== record.sourceLeaseId ||
    lease.ownerKey !== record.sourceOwnerKey
  ) {
    throw new Error(
      "HANDOFF_SOURCE_CHANGED: workspace ownership changed after the takeover request.",
    );
  }
}

export async function approveWorkspaceHandoff(
  requestId: string,
  confirm: boolean,
) {
  if (!confirm) {
    throw new Error("Workspace handoff requires confirm=true.");
  }
  const record = await readWorkspaceHandoff(requestId);
  if (record.status !== "requested") {
    throw new Error(
      `Workspace handoff ${requestId} is already ${record.status}.`,
    );
  }

  const status = await workspaceLeaseStatus(record.workspace);
  assertSourceLeaseMatches(record, status.lease);

  const context = currentExecutionContext();
  const sourceOwnedByCaller = status.lease?.ownerTaskId
    ? context.taskId === status.lease.ownerTaskId
    : context.sessionId === status.lease?.ownerSessionId;
  if (!sourceOwnedByCaller) {
    throw new Error(
      "HANDOFF_NOT_OWNER: only the current workspace owner can confirm handoff.",
    );
  }

  if ((status.lease?.pinnedProcessIds.length ?? 0) > 0) {
    throw new Error(
      `HANDOFF_BLOCKED_BY_PROCESS: ${status.lease!.pinnedProcessIds.join(",")}`,
    );
  }

  await releaseWorkspaceLease(record.workspace, { force: true });
  record.status = "released";
  record.releasedAt = new Date().toISOString();
  await writeRecord(record);
  return {
    released: true,
    request: record,
  };
}

export async function completeWorkspaceTakeover(
  requestId: string,
  confirm: boolean,
) {
  if (!confirm) {
    throw new Error("Workspace takeover requires confirm=true.");
  }
  const record = await readWorkspaceHandoff(requestId);
  if (record.status !== "released") {
    throw new Error(
      `Workspace takeover ${requestId} requires released status; current status is ${record.status}.`,
    );
  }

  const context = currentExecutionContext();
  if (executionOwnerKey(context) !== record.requesterOwnerKey) {
    throw new Error(
      "TAKEOVER_NOT_REQUESTER: only the original takeover requester can complete acquisition.",
    );
  }

  const lease = await ensureWorkspaceWriteLease(record.workspace, {
    purpose:
      record.purpose ??
      `Takeover after handoff ${record.id}`,
    auto: false,
  });
  record.status = "completed";
  record.completedAt = new Date().toISOString();
  record.acquiredLeaseId = lease.id;
  await writeRecord(record);

  return {
    completed: true,
    request: record,
    lease,
  };
}

export async function cancelWorkspaceHandoff(
  requestId: string,
) {
  const record = await readWorkspaceHandoff(requestId);
  const context = currentExecutionContext();
  if (executionOwnerKey(context) !== record.requesterOwnerKey) {
    throw new Error(
      "TAKEOVER_NOT_REQUESTER: only the original takeover requester can cancel the request.",
    );
  }
  if (record.status === "completed") {
    throw new Error("Completed workspace handoffs cannot be cancelled.");
  }
  record.status = "cancelled";
  await writeRecord(record);
  return record;
}

export function getWorkspaceHandoffStorageInfo() {
  return {
    directory: handoffDir(),
    durable: true,
    silentLeaseStealing: false,
    requiresExplicitHandoffConfirmation: true,
    requiresExplicitTakeoverConfirmation: true,
  };
}
