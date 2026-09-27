import { randomUUID } from "node:crypto";
import {
  currentExecutionContext,
  executionOwnerIdentity,
} from "../runtime/executionContext.js";
import {
  getCapabilityManifest,
  getSkillCatalog,
} from "../skills/skillRuntime.js";
import { getPrimitiveCatalog } from "../primitives/primitiveRuntime.js";

export const OWL_RUNTIME_PUBLIC_API_VERSION = "0.1" as const;

export type RuntimeBackendMode = "legacy" | "owl-http";

export type RuntimeClientInfo = {
  apiVersion: string;
  runtimeVersion: string;
  transport: string;
};

export type RuntimeInvokeOptions = {
  signal?: AbortSignal;
  requestId?: string;
  timeoutMs?: number;
};

export interface RuntimeClient {
  readonly backend: RuntimeBackendMode;
  info(options?: RuntimeInvokeOptions): Promise<RuntimeClientInfo>;
  getCapabilities(
    goal?: string,
    options?: RuntimeInvokeOptions,
  ): Promise<unknown>;
  getPrimitiveCatalog(options?: RuntimeInvokeOptions): Promise<unknown>;
  getSkillCatalog(options?: RuntimeInvokeOptions): Promise<unknown>;
}

function backendMode(): RuntimeBackendMode {
  const configured =
    process.env.COMPUTER_MCP_RUNTIME_BACKEND?.trim().toLowerCase() || "legacy";
  const runtimeMode = (
    process.env.COMPUTER_MCP_RUNTIME_MODE ??
    process.env.AGENTOS_RUNTIME_MODE ??
    "development"
  )
    .trim()
    .toLowerCase();

  // Computer MCP 1.x production is intentionally standalone. OWL Runtime may
  // be exercised in development/test dogfood, but a backend architecture
  // switch is a major-version production promotion (planned for 2.0+), never a
  // patch/minor rollout or an accidental environment change.
  if (
    runtimeMode === "production" &&
    configured !== "legacy"
  ) {
    throw new Error(
      "PRODUCTION_BACKEND_LOCKED: Computer MCP 1.x production must use the standalone legacy backend. OWL Runtime is development/test dogfood only until an explicit major-version production promotion.",
    );
  }

  if (configured === "legacy") return "legacy";
  if (configured === "owl" || configured === "owl-http") return "owl-http";
  throw new Error(
    `Unsupported COMPUTER_MCP_RUNTIME_BACKEND="${configured}". Use "legacy" or "owl-http".`,
  );
}

function owlRuntimeUrl(): string {
  return (
    process.env.OWL_RUNTIME_URL?.trim().replace(/\/+$/, "") ||
    "http://127.0.0.1:8788"
  );
}

function owlRequestTimeoutMs(): number {
  const configured = Number(process.env.OWL_RUNTIME_HTTP_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return 60_000;
  return Math.min(Math.max(Math.trunc(configured), 1_000), 30 * 60_000);
}

function combinedSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason ?? new Error("Runtime request cancelled."));
    }
  };

  if (signal?.aborted) {
    abortFromParent();
  } else if (signal) {
    signal.addEventListener("abort", abortFromParent, { once: true });
  }

  timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new Error(`OWL Runtime request timed out after ${timeoutMs} ms.`),
      );
    }
  }, timeoutMs);
  timer.unref();

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

type RpcFailure = {
  ok?: false;
  error?: { code?: string; message?: string };
  requestId?: string;
};

export class OwlRuntimeRpcError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;

  constructor(
    message: string,
    options?: { code?: string; requestId?: string; status?: number },
  ) {
    super(message);
    this.name = "OwlRuntimeRpcError";
    this.code = options?.code ?? "OWL_RUNTIME_ERROR";
    this.requestId = options?.requestId;
    this.status = options?.status;
  }
}

export class LegacyRuntimeClient implements RuntimeClient {
  readonly backend = "legacy" as const;

  async info(): Promise<RuntimeClientInfo> {
    return {
      apiVersion: "legacy",
      runtimeVersion: "0.9.16",
      transport: "in-process",
    };
  }

  async getCapabilities(goal = ""): Promise<unknown> {
    return await getCapabilityManifest(goal);
  }

  async getPrimitiveCatalog(): Promise<unknown> {
    return getPrimitiveCatalog();
  }

  async getSkillCatalog(): Promise<unknown> {
    return getSkillCatalog();
  }
}

/**
 * Thin consumer of OWL Runtime Public API v0.1.
 *
 * This module intentionally does not import owl-runtime source files. The only
 * dependency is the versioned loopback HTTP contract.
 */
export class OwlHttpRuntimeClient implements RuntimeClient {
  readonly backend = "owl-http" as const;

  private async invoke(
    method: string,
    params?: unknown,
    options: RuntimeInvokeOptions = {},
  ): Promise<unknown> {
    const context = currentExecutionContext();
    const logicalSessionId = executionOwnerIdentity(context);
    const requestId =
      options.requestId ??
      `computer-mcp:${context.requestId}:${randomUUID().slice(0, 8)}`;
    const timeoutMs = options.timeoutMs ?? owlRequestTimeoutMs();
    const cancellation = combinedSignal(
      options.signal ?? context.signal,
      timeoutMs,
    );

    try {
      const response = await fetch(`${owlRuntimeUrl()}/runtime/v0.1/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "computer-mcp/owl-runtime-client-v0.1",
          "x-owl-session-id": logicalSessionId,
          "x-owl-request-id": requestId,
          ...(process.env.OWL_RUNTIME_API_TOKEN?.trim()
            ? {
                authorization: `Bearer ${process.env.OWL_RUNTIME_API_TOKEN.trim()}`,
              }
            : {}),
        },
        body: JSON.stringify({
          id: requestId,
          method,
          ...(params === undefined ? {} : { params }),
        }),
        signal: cancellation.signal,
      });

      let payload: any;
      try {
        payload = await response.json();
      } catch {
        throw new OwlRuntimeRpcError(
          `OWL Runtime returned non-JSON HTTP ${response.status}.`,
          { code: `HTTP_${response.status}`, requestId, status: response.status },
        );
      }

      if (!response.ok || payload?.ok !== true) {
        const failure = payload as RpcFailure;
        throw new OwlRuntimeRpcError(
          failure.error?.message ||
            `OWL Runtime HTTP ${response.status} for ${method}.`,
          {
            code: failure.error?.code || `HTTP_${response.status}`,
            requestId: failure.requestId || requestId,
            status: response.status,
          },
        );
      }

      return payload.result;
    } finally {
      cancellation.cleanup();
    }
  }

  async info(options?: RuntimeInvokeOptions): Promise<RuntimeClientInfo> {
    return (await this.invoke("info", undefined, options)) as RuntimeClientInfo;
  }

  async getCapabilities(
    goal = "",
    options?: RuntimeInvokeOptions,
  ): Promise<unknown> {
    return await this.invoke("capabilities.get", { goal }, options);
  }

  async getPrimitiveCatalog(options?: RuntimeInvokeOptions): Promise<unknown> {
    return await this.invoke("primitives.catalog", undefined, options);
  }

  async getSkillCatalog(options?: RuntimeInvokeOptions): Promise<unknown> {
    return await this.invoke("skills.catalog", undefined, options);
  }
}

const legacyRuntimeClient = new LegacyRuntimeClient();
const owlHttpRuntimeClient = new OwlHttpRuntimeClient();

export function getRuntimeClient(): RuntimeClient {
  return backendMode() === "owl-http"
    ? owlHttpRuntimeClient
    : legacyRuntimeClient;
}

export function getRuntimeClientStatus() {
  const backend = backendMode();
  const runtimeMode = (
    process.env.COMPUTER_MCP_RUNTIME_MODE ??
    process.env.AGENTOS_RUNTIME_MODE ??
    "development"
  )
    .trim()
    .toLowerCase();

  return {
    backend,
    defaultBackend: "legacy",
    runtimeMode,
    productionArchitecturePolicy: "standalone-through-1.x",
    plannedRuntimeBackedMajor: "2.0",
    productionBackendLocked: runtimeMode === "production",
    owlPublicApiVersion: OWL_RUNTIME_PUBLIC_API_VERSION,
    owlRuntimeUrl: owlRuntimeUrl(),
    owlConfigured: backend === "owl-http",
    migrationPolicy: "development-per-capability; production-major-only",
    fallbackPolicy:
      backend === "legacy"
        ? "legacy-explicit"
        : "no-silent-runtime-fallback",
  };
}
