import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ExecutionOrigin =
  | "mcp"
  | "task"
  | "scheduler"
  | "loop"
  | "system";

export type ExecutionContext = {
  sessionId: string;
  transportSessionId?: string;
  ownerId?: string;
  requestId: string;
  origin: ExecutionOrigin;
  taskId?: string;
  loopId?: string;
  scheduleId?: string;
  tool?: string;
  signal?: AbortSignal;
};

const storage = new AsyncLocalStorage<ExecutionContext>();

export function systemExecutionContext(): ExecutionContext {
  return {
    sessionId: "runtime:system",
    requestId: `system:${process.pid}:${randomUUID()}`,
    origin: "system",
  };
}

export function currentExecutionContext(): ExecutionContext {
  return storage.getStore() ?? systemExecutionContext();
}

export function executionOwnerIdentity(
  context: ExecutionContext = currentExecutionContext(),
): string {
  return context.ownerId?.trim() || context.sessionId;
}

export function executionOwnerKey(
  context: ExecutionContext = currentExecutionContext(),
): string {
  if (context.taskId) return `task:${context.taskId}`;
  return context.ownerId
    ? `owner:${executionOwnerIdentity(context)}`
    : `session:${context.sessionId}`;
}

export async function withExecutionContext<T>(
  context: ExecutionContext,
  operation: () => Promise<T>,
): Promise<T> {
  return await storage.run(context, operation);
}

export async function withChildExecutionContext<T>(
  partial: Partial<ExecutionContext>,
  operation: () => Promise<T>,
): Promise<T> {
  const parent = currentExecutionContext();
  return await storage.run(
    {
      ...parent,
      ...partial,
      sessionId: partial.sessionId ?? parent.sessionId,
      requestId: partial.requestId ?? parent.requestId,
      origin: partial.origin ?? parent.origin,
    },
    operation,
  );
}
