import { createHash } from "node:crypto";

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

export const LOGICAL_OWNER_HEADER = "x-computer-mcp-owner-id";

function firstHeader(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name];
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  if (!trimmed || trimmed.length > 512) return undefined;
  return trimmed;
}

function hashOwnerHint(value: string): string {
  return `owner_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export type LogicalOwnerIdentity = {
  ownerId: string;
  stable: boolean;
  source: "explicit-header" | "transport-session";
};

/**
 * Resolve a logical owner without guessing from User-Agent, IP, or timing.
 *
 * The explicit owner header is intended to be injected by a trusted local
 * client/ingress that knows the durable conversation/client identity. The raw
 * value is never persisted: only a deterministic digest is used internally.
 * Without that signal we deliberately fall back to the MCP transport session
 * rather than accidentally merging independent chats.
 */
export function resolveLogicalOwnerIdentity(
  headers: HeaderMap,
  transportSessionId: string,
): LogicalOwnerIdentity {
  const explicit = firstHeader(headers, LOGICAL_OWNER_HEADER);
  if (explicit) {
    return {
      ownerId: hashOwnerHint(explicit),
      stable: true,
      source: "explicit-header",
    };
  }
  return {
    ownerId: transportSessionId,
    stable: false,
    source: "transport-session",
  };
}
