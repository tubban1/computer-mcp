export type RuntimeSessionState = {
  id: string;
  ownerId?: string;
  connectedAt: string;
  lastActivityAt: string;
  disconnectedAt?: string;
  activeCalls: number;
  totalCalls: number;
  userAgent?: string;
};

type RuntimeSessionOptions = {
  staleMs?: number;
  retentionMs?: number;
};

function configuredMs(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

export class RuntimeSessionManager {
  private readonly sessions = new Map<string, RuntimeSessionState>();
  private readonly staleMs: number;
  private readonly retentionMs: number;

  constructor(options?: RuntimeSessionOptions) {
    this.staleMs =
      options?.staleMs ??
      configuredMs(
        "RUNTIME_SESSION_STALE_MS",
        15 * 60_000,
        1_000,
        24 * 60 * 60_000,
      );
    this.retentionMs =
      options?.retentionMs ??
      configuredMs(
        "RUNTIME_SESSION_RETENTION_MS",
        24 * 60 * 60_000,
        60_000,
        7 * 24 * 60 * 60_000,
      );
  }

  private prune(now = Date.now()) {
    for (const [id, state] of this.sessions) {
      if (!state.disconnectedAt && state.activeCalls === 0) {
        const lastActivity = Date.parse(state.lastActivityAt);
        if (
          Number.isFinite(lastActivity) &&
          now >= lastActivity + this.staleMs
        ) {
          state.disconnectedAt = new Date(now).toISOString();
        }
      }

      if (state.disconnectedAt) {
        const disconnectedAt = Date.parse(state.disconnectedAt);
        if (
          Number.isFinite(disconnectedAt) &&
          now >= disconnectedAt + this.retentionMs
        ) {
          this.sessions.delete(id);
        }
      }
    }
  }

  register(id: string, metadata?: { userAgent?: string; ownerId?: string }) {
    this.prune();
    const now = new Date().toISOString();
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivityAt = now;
      existing.disconnectedAt = undefined;
      if (metadata?.userAgent) existing.userAgent = metadata.userAgent;
      if (metadata?.ownerId) existing.ownerId = metadata.ownerId;
      return { ...existing };
    }

    const state: RuntimeSessionState = {
      id,
      connectedAt: now,
      lastActivityAt: now,
      activeCalls: 0,
      totalCalls: 0,
      ...(metadata?.userAgent ? { userAgent: metadata.userAgent } : {}),
      ...(metadata?.ownerId ? { ownerId: metadata.ownerId } : {}),
    };
    this.sessions.set(id, state);
    return { ...state };
  }

  beginCall(id: string, metadata?: { userAgent?: string; ownerId?: string }) {
    this.prune();
    this.sessions.get(id) ?? this.register(id, metadata);
    const live = this.sessions.get(id)!;
    live.lastActivityAt = new Date().toISOString();
    live.disconnectedAt = undefined;
    live.activeCalls += 1;
    live.totalCalls += 1;
    if (metadata?.userAgent) live.userAgent = metadata.userAgent;
    if (metadata?.ownerId) live.ownerId = metadata.ownerId;
    return { ...live };
  }

  endCall(id: string) {
    const state = this.sessions.get(id);
    if (!state) return;
    state.lastActivityAt = new Date().toISOString();
    state.activeCalls = Math.max(0, state.activeCalls - 1);
    this.prune();
  }

  disconnect(id: string) {
    const state = this.sessions.get(id);
    if (!state) return null;
    state.disconnectedAt = new Date().toISOString();
    state.lastActivityAt = state.disconnectedAt;
    state.activeCalls = 0;
    return { ...state };
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

  ownerStatus(ownerId: string) {
    this.prune();
    const sessions = [...this.sessions.values()].filter(
      (state) => (state.ownerId ?? state.id) === ownerId,
    );
    return {
      ownerId,
      knownSessions: sessions.length,
      activeSessions: sessions.filter((state) => !state.disconnectedAt).length,
      activeCalls: sessions.reduce((sum, state) => sum + state.activeCalls, 0),
      lastActivityAt:
        sessions
          .map((state) => state.lastActivityAt)
          .sort((a, b) => b.localeCompare(a))[0] ?? null,
    };
  }

  summary() {
    const sessions = this.list();
    const active = sessions.filter((item) => !item.disconnectedAt);
    return {
      activeSessions: active.length,
      activeOwners: new Set(active.map((item) => item.ownerId ?? item.id)).size,
      knownSessions: sessions.length,
      activeCalls: sessions.reduce((sum, item) => sum + item.activeCalls, 0),
      staleAfterMs: this.staleMs,
      retentionMs: this.retentionMs,
    };
  }
}

export const runtimeSessionManager = new RuntimeSessionManager();
