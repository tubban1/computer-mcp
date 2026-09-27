import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ResourceRequirement } from "./actionContracts.js";

type ActiveResource = {
  readers: Set<string>;
  writer?: string;
};

type PendingRequest = {
  ticket: string;
  action: string;
  resources: ResourceRequirement[];
  enqueuedAt: number;
  resolve: (lease: ResourceLease) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export type ResourceLease = {
  ticket: string;
  action: string;
  resources: ResourceRequirement[];
  waitMs: number;
  release: () => void;
};

export type ResourceAcquireOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resourceKeysConflict(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.startsWith("workspace:") && right.startsWith("workspace:")) {
    const leftPath = left.slice("workspace:".length);
    const rightPath = right.slice("workspace:".length);
    return pathContains(leftPath, rightPath) || pathContains(rightPath, leftPath);
  }
  return false;
}

function normalizeResources(resources: ResourceRequirement[]): ResourceRequirement[] {
  const byKey = new Map<string, ResourceRequirement>();
  for (const item of resources) {
    const key = item.key.trim();
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || item.mode === "exclusive") {
      byKey.set(key, { key, mode: item.mode });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function boundedTimeoutMs(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 0), 10 * 60_000);
}

class ResourceArbiter {
  private readonly active = new Map<string, ActiveResource>();
  private readonly pending: PendingRequest[] = [];
  private readonly heldByTicket = new Map<string, ResourceRequirement[]>();

  private canGrant(resources: ResourceRequirement[]): boolean {
    for (const requirement of resources) {
      for (const [activeKey, state] of this.active.entries()) {
        if (!resourceKeysConflict(requirement.key, activeKey)) continue;

        if (requirement.mode === "shared") {
          if (state.writer) return false;
        } else if (state.writer || state.readers.size > 0) {
          return false;
        }
      }
    }
    return true;
  }

  private markGranted(ticket: string, resources: ResourceRequirement[]): void {
    for (const requirement of resources) {
      const state = this.active.get(requirement.key) ?? {
        readers: new Set<string>(),
      };

      if (requirement.mode === "shared") {
        state.readers.add(ticket);
      } else {
        state.writer = ticket;
      }

      this.active.set(requirement.key, state);
    }
    this.heldByTicket.set(ticket, resources);
  }

  private releaseTicket(ticket: string): void {
    const resources = this.heldByTicket.get(ticket);
    if (!resources) return;

    for (const requirement of resources) {
      const state = this.active.get(requirement.key);
      if (!state) continue;

      state.readers.delete(ticket);
      if (state.writer === ticket) state.writer = undefined;

      if (state.readers.size === 0 && !state.writer) {
        this.active.delete(requirement.key);
      }
    }

    this.heldByTicket.delete(ticket);
    this.drain();
  }

  private removePending(ticket: string): PendingRequest | null {
    const index = this.pending.findIndex((request) => request.ticket === ticket);
    if (index < 0) return null;
    const [request] = this.pending.splice(index, 1);
    request?.cleanup();
    return request ?? null;
  }

  private drain(): void {
    let index = 0;
    while (index < this.pending.length) {
      const request = this.pending[index]!;
      if (!this.canGrant(request.resources)) {
        index += 1;
        continue;
      }

      this.pending.splice(index, 1);
      request.cleanup();
      this.markGranted(request.ticket, request.resources);
      let released = false;
      request.resolve({
        ticket: request.ticket,
        action: request.action,
        resources: request.resources,
        waitMs: Date.now() - request.enqueuedAt,
        release: () => {
          if (released) return;
          released = true;
          this.releaseTicket(request.ticket);
        },
      });
    }
  }

  async acquire(
    action: string,
    resources: ResourceRequirement[],
    options?: ResourceAcquireOptions,
  ): Promise<ResourceLease> {
    const normalized = normalizeResources(resources);
    const ticket = randomUUID();

    if (normalized.length === 0) {
      return {
        ticket,
        action,
        resources: [],
        waitMs: 0,
        release: () => undefined,
      };
    }

    if (options?.signal?.aborted) {
      throw new Error(
        `RESOURCE_WAIT_CANCELLED: ${action} was cancelled before resource acquisition.`,
      );
    }

    const timeoutMs = boundedTimeoutMs(options?.timeoutMs);

    return await new Promise<ResourceLease>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        const pending = this.removePending(ticket);
        if (!pending) return;
        pending.reject(
          new Error(
            `RESOURCE_WAIT_CANCELLED: ${action} was cancelled while waiting for resources.`,
          ),
        );
      };

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const pending: PendingRequest = {
        ticket,
        action,
        resources: normalized,
        enqueuedAt: Date.now(),
        resolve: (lease) => {
          if (settled) {
            lease.release();
            return;
          }
          settled = true;
          resolve(lease);
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        },
        cleanup,
      };

      this.pending.push(pending);
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      if (timeoutMs !== null) {
        timeout = setTimeout(() => {
          if (settled) return;
          const removed = this.removePending(ticket);
          if (!removed) return;
          removed.reject(
            new Error(
              `RESOURCE_WAIT_TIMEOUT: ${action} waited ${timeoutMs} ms for resources. Retry after the conflicting work finishes.`,
            ),
          );
        }, timeoutMs);
        timeout.unref();
      }

      this.drain();
    });
  }

  async withResources<T>(
    action: string,
    resources: ResourceRequirement[],
    operation: () => Promise<T>,
    options?: ResourceAcquireOptions,
  ): Promise<{ result: T; lease: Omit<ResourceLease, "release"> }> {
    const lease = await this.acquire(action, resources, options);
    try {
      const result = await operation();
      return {
        result,
        lease: {
          ticket: lease.ticket,
          action: lease.action,
          resources: lease.resources,
          waitMs: lease.waitMs,
        },
      };
    } finally {
      lease.release();
    }
  }

  status() {
    return {
      active: [...this.active.entries()].map(([key, state]) => ({
        key,
        readers: state.readers.size,
        writer: state.writer ?? null,
      })),
      pending: this.pending.map((request) => ({
        ticket: request.ticket,
        action: request.action,
        resources: request.resources,
        waitingMs: Date.now() - request.enqueuedAt,
      })),
      heldTickets: this.heldByTicket.size,
    };
  }
}

export const resourceArbiter = new ResourceArbiter();
