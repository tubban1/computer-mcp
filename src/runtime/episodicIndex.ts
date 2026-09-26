import { createHash } from "node:crypto";
import {
  listPersistentTaskRecords,
  type PersistentTask,
  type PersistentTaskStatus,
} from "../tasks/taskStore.js";
import {
  getEpisodicStorageInfo,
  listGlobalEpisodes,
  newEpisodeId,
  writeGlobalEpisode,
  type GlobalEpisodeRecord,
} from "./episodicStore.js";
import {
  hybridRetrievalScore,
  LOCAL_VECTOR_DIMENSIONS,
  LOCAL_VECTORIZER,
  vectorizeText,
} from "./retrievalVector.js";

const TERMINAL = new Set<PersistentTaskStatus>([
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

function terminalAt(task: PersistentTask): string {
  return (
    task.completedAt ??
    task.cancelledAt ??
    task.blockedAt ??
    task.updatedAt
  );
}

function buildSearchableText(task: PersistentTask): string {
  const stepText = task.steps
    .map((step) =>
      [
        step.id,
        step.primitive ?? "",
        step.op ?? "",
        step.action,
        step.state,
        step.error ?? "",
        step.recoveryNote ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");

  const eventText = task.events
    .slice(-250)
    .map((event) => [event.type, event.stepId ?? "", event.message].join(" "))
    .join("\n");

  return [
    `task ${task.id}`,
    `label ${task.label}`,
    `status ${task.status}`,
    stepText,
    eventText,
  ]
    .join("\n")
    .trim();
}

export function taskToGlobalEpisode(task: PersistentTask): GlobalEpisodeRecord {
  if (!TERMINAL.has(task.status)) {
    throw new Error(
      `Only terminal tasks can enter the global episodic index; ${task.id} is ${task.status}.`,
    );
  }

  const searchableText = buildSearchableText(task);
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newEpisodeId(),
    taskId: task.id,
    label: task.label,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: now,
    terminalAt: terminalAt(task),
    runCount: task.runCount,
    stepCount: task.steps.length,
    steps: task.steps.map((step) => ({
      id: step.id,
      ...(step.primitive ? { primitive: step.primitive } : {}),
      ...(step.op ? { op: step.op } : {}),
      action: step.action,
      state: step.state,
      attempts: step.attempts,
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      ...(step.error ? { error: step.error } : {}),
      ...(step.recoveryNote ? { recoveryNote: step.recoveryNote } : {}),
    })),
    eventTypes: [...new Set(task.events.map((event) => event.type))],
    eventMessages: task.events.slice(-250).map((event) => event.message),
    searchableText,
    contentDigest: createHash("sha256")
      .update(searchableText.normalize("NFKC"))
      .digest("hex"),
    retrieval: {
      vectorizer: LOCAL_VECTORIZER,
      dimensions: LOCAL_VECTOR_DIMENSIONS,
      vector: vectorizeText(searchableText),
    },
  };
}

export async function indexTaskEpisode(task: PersistentTask) {
  if (!TERMINAL.has(task.status)) {
    return { indexed: false, reason: "task_not_terminal", taskId: task.id };
  }
  const record = taskToGlobalEpisode(task);
  await writeGlobalEpisode(record);
  return {
    indexed: true,
    taskId: task.id,
    episodeId: record.id,
    status: task.status,
    terminalAt: record.terminalAt,
  };
}

export async function rebuildGlobalEpisodicIndex() {
  const tasks = await listPersistentTaskRecords();
  let indexed = 0;
  let skipped = 0;
  const failures: Array<{ taskId: string; error: string }> = [];

  for (const task of tasks) {
    if (!TERMINAL.has(task.status)) {
      skipped += 1;
      continue;
    }
    try {
      await indexTaskEpisode(task);
      indexed += 1;
    } catch (error) {
      failures.push({
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    indexed,
    skipped,
    failed: failures.length,
    failures,
    storage: getEpisodicStorageInfo(),
  };
}

export async function searchGlobalEpisodes(
  query: string,
  options?: {
    mode?: "hybrid" | "lexical" | "vector";
    statuses?: PersistentTaskStatus[];
    limit?: number;
  },
) {
  const mode = options?.mode ?? "hybrid";
  const statuses = new Set(options?.statuses ?? []);
  const limit = Math.min(Math.max(Math.trunc(options?.limit ?? 20), 1), 100);
  const records = await listGlobalEpisodes();

  return records
    .filter((record) => statuses.size === 0 || statuses.has(record.status))
    .map((record) => ({
      record,
      score: query.trim()
        ? hybridRetrievalScore(
            query,
            record.searchableText,
            record.retrieval.vector,
            mode,
          )
        : { lexical: 0, vector: 0, combined: 1 },
    }))
    .filter((item) => !query.trim() || item.score.combined > 0)
    .sort(
      (a, b) =>
        b.score.combined - a.score.combined ||
        b.record.terminalAt.localeCompare(a.record.terminalAt),
    )
    .slice(0, limit)
    .map(({ record, score }) => ({
      taskId: record.taskId,
      episodeId: record.id,
      label: record.label,
      status: record.status,
      terminalAt: record.terminalAt,
      runCount: record.runCount,
      stepCount: record.stepCount,
      steps: record.steps,
      eventTypes: record.eventTypes,
      score,
      vectorizer: record.retrieval.vectorizer,
    }));
}

export async function episodicIndexStatus() {
  const records = await listGlobalEpisodes();
  const byStatus = Object.fromEntries(
    [...TERMINAL].map((status) => [
      status,
      records.filter((record) => record.status === status).length,
    ]),
  );
  return {
    available: true,
    autoIndexTerminalTasks: true,
    recordCount: records.length,
    byStatus,
    vectorizer: {
      id: LOCAL_VECTORIZER,
      dimensions: LOCAL_VECTOR_DIMENSIONS,
      neuralEmbedding: false,
      note:
        "v0.9.9 uses local feature hashing for zero-dependency vector retrieval; the vectorizer is replaceable by a neural embedding provider.",
    },
    storage: getEpisodicStorageInfo(),
  };
}
