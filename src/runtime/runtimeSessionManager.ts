export type RuntimeSessionKind = "durable" | "transient";

export type RuntimeSessionState = {
  id: string;
  kind: RuntimeSessionKind;
  ownerSource?: string;
  connectedAt: string;
  lastActivityAt: string;
  disconnectedAt?: string;
  activeCalls: number;
  totalCalls: number;
  userAgent?: string;
};

type RuntimeSessionMetadata = {
  userAgent?: string;
  kind?: RuntimeSessionKind;
  ownerSource?: string;
};

type RuntimeSessionManagerOptions = {
  now?: () => number;
  transientIdleTtlMs?: number;
  disconnectedRetentionMs?: number;
  maxKnownSessions?: number;
};

function boundedPositive(value: number | undefined, fallback: number, minimum: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(Math.trunc(numeric), minimum);
}

export class RuntimeSessionManager {
  private readonly sessions = new Map<string, RuntimeSessionState>();
  private readonly now: () => number;
  private readonly transientIdleTtlMs: number;
  private readonly disconnectedRetentionMs: number;
  private readonly maxKnownSessions: number;

  constructor(options: RuntimeSessionManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.transientIdleTtlMs = boundedPositive(
      options.transientIdleTtlMs ??
        Number(process.env.OWL_TRANSIENT_SESSION_IDLE_TTL_MS),
      5 * 60_000,
      1_000,
    );
    this.disconnectedRetentionMs = boundedPositive(
      options.disconnectedRetentionMs ??
        Number(process.env.OWL_DISCONNECTED_SESSION_RETENTION_MS),
      30 * 60_000,
      1_000,
    );
    this.maxKnownSessions = boundedPositive(
      options.maxKnownSessions ??
        Number(process.env.OWL_RUNTIME_MAX_KNOWN_SESSIONS),
      256,
      8,
    );
  }

  private isoNow(nowMs = this.now()) {
    return new Date(nowMs).toISOString();
  }

  private applyMetadata(
    state: RuntimeSessionState,
    metadata: RuntimeSessionMetadata = {},
  ) {
    if (metadata.userAgent) state.userAgent = metadata.userAgent;
    if (metadata.kind) state.kind = metadata.kind;
    if (metadata.ownerSource) state.ownerSource = metadata.ownerSource;
  }

  register(id: string, metadata: RuntimeSessionMetadata = {}) {
    const nowMs = this.now();
    this.prune(nowMs);
    const now = this.isoNow(nowMs);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivityAt = now;
      existing.disconnectedAt = undefined;
      this.applyMetadata(existing, metadata);
      return { ...existing };
    }

    const state: RuntimeSessionState = {
      id,
      kind: metadata.kind ?? "durable",
      connectedAt: now,
      lastActivityAt: now,
      activeCalls: 0,
      totalCalls: 0,
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      ...(metadata.ownerSource ? { ownerSource: metadata.ownerSource } : {}),
    };
    this.sessions.set(id, state);
    this.prune(nowMs);
    return { ...state };
  }

  beginCall(id: string, metadata: RuntimeSessionMetadata = {}) {
    this.prune();
    this.sessions.get(id) ?? this.register(id, metadata);
    const live = this.sessions.get(id)!;
    live.lastActivityAt = this.isoNow();
    live.disconnectedAt = undefined;
    live.activeCalls += 1;
    live.totalCalls += 1;
    this.applyMetadata(live, metadata);
    return { ...live };
  }

  endCall(id: string) {
    const state = this.sessions.get(id);
    if (!state) return;
    state.lastActivityAt = this.isoNow();
    state.activeCalls = Math.max(0, state.activeCalls - 1);
    this.prune();
  }

  disconnect(id: string) {
    const state = this.sessions.get(id);
    if (!state) return;
    state.disconnectedAt = this.isoNow();
    state.lastActivityAt = state.disconnectedAt;
    state.activeCalls = 0;
    this.prune();
  }

  prune(nowMs = this.now()) {
    const transientStaleBefore = nowMs - this.transientIdleTtlMs;
    const disconnectedDeleteBefore = nowMs - this.disconnectedRetentionMs;

    for (const state of this.sessions.values()) {
      if (
        state.kind === "transient" &&
        !state.disconnectedAt &&
        state.activeCalls === 0 &&
        Date.parse(state.lastActivityAt) <= transientStaleBefore
      ) {
        state.disconnectedAt = this.isoNow(nowMs);
        state.lastActivityAt = state.disconnectedAt;
      }
    }

    for (const [id, state] of this.sessions) {
      if (
        state.disconnectedAt &&
        state.activeCalls === 0 &&
        Date.parse(state.disconnectedAt) <= disconnectedDeleteBefore
      ) {
        this.sessions.delete(id);
      }
    }

    if (this.sessions.size <= this.maxKnownSessions) return;

    const removable = [...this.sessions.values()]
      .filter(
        (state) =>
          state.activeCalls === 0 &&
          (state.disconnectedAt || state.kind === "transient"),
      )
      .sort(
        (a, b) =>
          Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt),
      );

    let excess = this.sessions.size - this.maxKnownSessions;
    for (const state of removable) {
      if (excess <= 0) break;
      this.sessions.delete(state.id);
      excess -= 1;
    }
  }

  list() {
    this.prune();
    return [...this.sessions.values()]
      .map((state) => ({ ...state }))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  status(id: string) {
    this.prune();
    const state = this.sessions.get(id);
    return state ? { ...state } : null;
  }

  summary() {
    const sessions = this.list();
    const live = sessions.filter((item) => !item.disconnectedAt);
    return {
      activeSessions: live.length,
      connectedSessions: live.length,
      knownSessions: sessions.length,
      activeCalls: sessions.reduce((sum, item) => sum + item.activeCalls, 0),
      transientSessions: sessions.filter((item) => item.kind === "transient")
        .length,
      durableSessions: sessions.filter((item) => item.kind === "durable")
        .length,
      disconnectedSessions: sessions.filter((item) => item.disconnectedAt)
        .length,
      policy: {
        transientIdleTtlMs: this.transientIdleTtlMs,
        disconnectedRetentionMs: this.disconnectedRetentionMs,
        maxKnownSessions: this.maxKnownSessions,
      },
    };
  }
}

export const runtimeSessionManager = new RuntimeSessionManager();
