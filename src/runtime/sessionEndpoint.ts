import {
  captureLatestAgentReply,
  identifyBrowserAgentSession,
  sendAgentMessage,
} from "./sessionAdapters.js";
import { appendCloudMessage } from "../cloud/cloudDevice.js";
import {
  captureLatestWeChatReply,
  identifyWeChatSession,
  probeWeChatSession,
  sendWeChatSessionFile,
  sendWeChatSessionMessage,
} from "./wechatSessionAdapter.js";

export type SessionEndpointOperation =
  | "identify"
  | "probe"
  | "capture_latest"
  | "send"
  | "send_file";

export function sessionEndpointKind(
  bindingId: string,
): "browser-agent" | "wechat" {
  if (bindingId.startsWith("wechat_session_")) return "wechat";
  if (bindingId.startsWith("session_")) return "browser-agent";
  throw new Error(
    `Unknown session endpoint id "${bindingId}". Expected session_* or wechat_session_*.`,
  );
}

export async function identifySessionEndpoint(bindingId: string) {
  return sessionEndpointKind(bindingId) === "wechat"
    ? await identifyWeChatSession(bindingId)
    : await identifyBrowserAgentSession(bindingId);
}

export async function probeSessionEndpoint(bindingId: string) {
  if (sessionEndpointKind(bindingId) === "wechat") {
    return await probeWeChatSession(bindingId);
  }
  const captured = await captureLatestAgentReply(bindingId);
  return {
    ...captured,
    endpoint: "browser-agent",
    probe: true,
  };
}

export async function captureLatestSessionEndpoint(
  bindingId: string,
  args?: Record<string, unknown>,
) {
  const kind = sessionEndpointKind(bindingId);
  const captured = kind === "wechat"
    ? await captureLatestWeChatReply(bindingId, {
        allowFocus: args?.allow_focus !== false,
      })
    : await captureLatestAgentReply(bindingId, {
        maxChars:
          typeof args?.max_chars === "number"
            ? args.max_chars
            : undefined,
      });

  const row = captured as Record<string, unknown>;
  const reply = typeof row.reply === "string" ? row.reply.trim() : "";
  const ready = row.ready !== false && Boolean(reply);
  const changed = row.changed !== false;
  if (ready && changed) {
    const digest =
      typeof row.replyDigest === "string"
        ? row.replyDigest
        : undefined;
    const turn =
      typeof row.turn === "number"
        ? row.turn
        : undefined;
    const title =
      typeof row.contactName === "string"
        ? row.contactName
        : typeof row.adapterId === "string"
          ? row.adapterId
          : bindingId;
    await appendCloudMessage({
      channelType: kind === "wechat" ? "wechat" : "browser-agent",
      externalRef: bindingId,
      title,
      direction: "incoming",
      text: reply,
      content: {
        endpoint: kind,
        sessionId: bindingId,
        turn: turn ?? null,
        replyDigest: digest ?? null,
      },
      idempotencyKey:
        digest
          ? [bindingId, "incoming", String(turn ?? "na"), digest].join(":")
          : undefined,
    });
  }

  return captured;
}

export async function sendSessionEndpoint(
  bindingId: string,
  text: string,
  args?: Record<string, unknown>,
) {
  const kind = sessionEndpointKind(bindingId);
  const sent = kind === "wechat"
    ? await sendWeChatSessionMessage(bindingId, text, {
        confirm: args?.confirm === true,
        allowDuplicate: args?.allow_duplicate === true,
        deduplicateAsSuccess: true,
      })
    : await sendAgentMessage(bindingId, text, {
        confirm: args?.confirm === true,
        allowDuplicate: args?.allow_duplicate === true,
        deduplicateAsSuccess: true,
      });

  const row = sent as Record<string, unknown>;
  if (row.sent === true) {
    const digest =
      typeof row.messageDigest === "string"
        ? row.messageDigest
        : undefined;
    const turn =
      typeof row.turn === "number"
        ? row.turn
        : undefined;
    await appendCloudMessage({
      channelType: kind === "wechat" ? "wechat" : "browser-agent",
      externalRef: bindingId,
      title:
        typeof row.contactName === "string"
          ? row.contactName
          : typeof row.adapterId === "string"
            ? row.adapterId
            : bindingId,
      direction: "outgoing",
      text,
      content: {
        endpoint: kind,
        sessionId: bindingId,
        turn: turn ?? null,
        deduplicated: row.deduplicated === true,
      },
      idempotencyKey:
        digest
          ? [bindingId, "outgoing", String(turn ?? "na"), digest].join(":")
          : undefined,
      receipt: {
        status: row.verification === "uncertain" ? "uncertain" : "sent",
        providerRef:
          typeof row.sessionId === "string"
            ? row.sessionId
            : bindingId,
        evidence: {
          turn: turn ?? null,
          deduplicated: row.deduplicated === true,
        },
      },
    });
  }

  return sent;
}

export async function sendFileSessionEndpoint(
  bindingId: string,
  filePath: string,
  args?: Record<string, unknown>,
) {
  const kind = sessionEndpointKind(bindingId);
  if (kind !== "wechat") {
    throw new Error(
      "SESSION_ATTACHMENT_UNSUPPORTED: this Session Endpoint does not support file attachments.",
    );
  }

  const sent = await sendWeChatSessionFile(bindingId, filePath, {
    confirm: args?.confirm === true,
    allowDuplicate: args?.allow_duplicate === true,
    deduplicateAsSuccess: true,
  });
  const row = sent as Record<string, unknown>;
  if (row.sent === true) {
    const digest =
      typeof row.messageDigest === "string" ? row.messageDigest : undefined;
    const turn = typeof row.turn === "number" ? row.turn : undefined;
    const filename =
      typeof row.filename === "string" ? row.filename : "attachment";
    const fileSha256 =
      typeof row.fileSha256 === "string" ? row.fileSha256 : undefined;
    const verification =
      row.verification === "verified" ? "verified" : "uncertain";

    await appendCloudMessage({
      channelType: "wechat",
      externalRef: bindingId,
      title:
        typeof row.contactName === "string"
          ? row.contactName
          : bindingId,
      direction: "outgoing",
      messageType: "file",
      text: filename,
      content: {
        endpoint: kind,
        sessionId: bindingId,
        turn: turn ?? null,
        filename,
        fileSha256: fileSha256 ?? null,
        bytes: typeof row.bytes === "number" ? row.bytes : null,
        verification,
        deduplicated: row.deduplicated === true,
      },
      idempotencyKey:
        digest
          ? [bindingId, "outgoing-file", String(turn ?? "na"), digest].join(":")
          : undefined,
      receipt: {
        status: verification === "verified" ? "sent" : "uncertain",
        providerRef: bindingId,
        evidence: {
          turn: turn ?? null,
          filename,
          fileSha256: fileSha256 ?? null,
          verification,
        },
      },
    });
  }

  return sent;
}
