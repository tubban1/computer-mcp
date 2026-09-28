import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runtimeStatePath } from "../runtime/runtimePaths.js";

const DEFAULT_CLOUD_URL = "https://psnxgftfywpzriseetjg.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_71Xx23rZ0gymA2Cemp_fjQ_W15M5dc1";

export type CloudDeviceCredential = {
  version: 1;
  installationId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  accessToken: string;
  expiresAt: string;
  capabilities: string[];
  scopes: Record<string, unknown>;
  authorizedAt: string;
};

export type CloudAuthorizationStatus = {
  enabled: boolean;
  required: boolean;
  syncEnabled: boolean;
  loggedIn: boolean;
  authorized: boolean;
  deviceId?: string;
  deviceName?: string;
  expiresAt?: string;
  capabilities: string[];
  reason?: string;
};

type AuthorizationResult = {
  ok?: boolean;
  authorized?: boolean;
  device?: {
    id?: string;
    device_name?: string;
    platform?: string;
    status?: string;
  };
  grants?: {
    capabilities?: string[];
    scopes?: Record<string, unknown>;
  };
  error?: string;
};

let cachedAuthorization:
  | { checkedAt: number; status: CloudAuthorizationStatus }
  | undefined;

function flag(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export function cloudUrl() {
  return process.env.AGENTOS_CLOUD_URL?.trim().replace(/\/+$/, "") || DEFAULT_CLOUD_URL;
}

export function cloudPublishableKey() {
  return process.env.AGENTOS_CLOUD_PUBLISHABLE_KEY?.trim() || DEFAULT_PUBLISHABLE_KEY;
}

export function cloudAuthRequired() {
  return flag("AGENTOS_CLOUD_AUTH_REQUIRED", false);
}

export function cloudSyncEnabled() {
  return flag("AGENTOS_CLOUD_SYNC", cloudAuthRequired());
}

export function cloudSyncRequired() {
  return flag("AGENTOS_CLOUD_SYNC_REQUIRED", cloudAuthRequired());
}

export function cloudCredentialPath() {
  return runtimeStatePath("cloud", "device.json");
}

async function readCredential(): Promise<CloudDeviceCredential | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cloudCredentialPath(), "utf8")) as CloudDeviceCredential;
    if (
      parsed.version !== 1 ||
      !parsed.deviceId ||
      !parsed.installationId ||
      !parsed.accessToken ||
      !parsed.expiresAt
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function invokeDeviceSync(
  credential: CloudDeviceCredential,
  body: Record<string, unknown>,
) {
  const response = await fetch(cloudUrl() + "/functions/v1/agentos-device-sync", {
    method: "POST",
    headers: {
      apikey: cloudPublishableKey(),
      authorization: "Bearer " + credential.accessToken,
      "content-type": "application/json",
      "user-agent": "computer-mcp/cloud-device-v1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = { error: "CLOUD_NON_JSON_RESPONSE" };
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || "CLOUD_HTTP_" + response.status);
  }
  return payload;
}

export async function getCloudAuthorizationStatus(
  options: { force?: boolean } = {},
): Promise<CloudAuthorizationStatus> {
  const required = cloudAuthRequired();
  const syncEnabled = cloudSyncEnabled();
  const enabled = required || syncEnabled;
  if (!enabled) {
    return {
      enabled: false,
      required,
      syncEnabled,
      loggedIn: Boolean(await readCredential()),
      authorized: !required,
      capabilities: [],
    };
  }

  const ttlMs = Math.min(
    Math.max(Number(process.env.AGENTOS_CLOUD_AUTH_CACHE_MS) || 30_000, 1_000),
    5 * 60_000,
  );
  if (
    !options.force &&
    cachedAuthorization &&
    Date.now() - cachedAuthorization.checkedAt < ttlMs
  ) {
    return cachedAuthorization.status;
  }

  const credential = await readCredential();
  if (!credential) {
    const status: CloudAuthorizationStatus = {
      enabled: true,
      required,
      syncEnabled,
      loggedIn: false,
      authorized: false,
      capabilities: [],
      reason: "CLOUD_DEVICE_NOT_LOGGED_IN",
    };
    cachedAuthorization = { checkedAt: Date.now(), status };
    return status;
  }

  if (Date.parse(credential.expiresAt) <= Date.now()) {
    const status: CloudAuthorizationStatus = {
      enabled: true,
      required,
      syncEnabled,
      loggedIn: true,
      authorized: false,
      deviceId: credential.deviceId,
      deviceName: credential.deviceName,
      expiresAt: credential.expiresAt,
      capabilities: credential.capabilities ?? [],
      reason: "CLOUD_DEVICE_TOKEN_EXPIRED",
    };
    cachedAuthorization = { checkedAt: Date.now(), status };
    return status;
  }

  try {
    const result = await invokeDeviceSync(credential, { action: "authorize" }) as AuthorizationResult;
    const capabilities = result.grants?.capabilities ?? credential.capabilities ?? [];
    const status: CloudAuthorizationStatus = {
      enabled: true,
      required,
      syncEnabled,
      loggedIn: true,
      authorized:
        result.authorized === true &&
        capabilities.includes("computer.control"),
      deviceId: result.device?.id ?? credential.deviceId,
      deviceName: result.device?.device_name ?? credential.deviceName,
      expiresAt: credential.expiresAt,
      capabilities,
      reason: result.authorized === true ? undefined : "CLOUD_DEVICE_NOT_AUTHORIZED",
    };
    cachedAuthorization = { checkedAt: Date.now(), status };
    return status;
  } catch (error) {
    const status: CloudAuthorizationStatus = {
      enabled: true,
      required,
      syncEnabled,
      loggedIn: true,
      authorized: false,
      deviceId: credential.deviceId,
      deviceName: credential.deviceName,
      expiresAt: credential.expiresAt,
      capabilities: credential.capabilities ?? [],
      reason: error instanceof Error ? error.message : String(error),
    };
    cachedAuthorization = { checkedAt: Date.now(), status };
    return status;
  }
}

export async function assertCloudAuthorized(): Promise<void> {
  if (!cloudAuthRequired()) return;
  const status = await getCloudAuthorizationStatus();
  if (!status.authorized) {
    throw new Error(
      "CLOUD_AUTH_REQUIRED: Computer MCP is not authorized by an active cloud account/device grant"
        + (status.reason ? " (" + status.reason + ")" : "")
        + ". Run npm run cloud:login and approve the device in OWL Worker.",
    );
  }
}

export async function appendCloudRuntimeEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  if (!cloudSyncEnabled()) return { skipped: true };
  const credential = await readCredential();
  if (!credential) {
    if (cloudSyncRequired()) throw new Error("CLOUD_SYNC_AUTH_REQUIRED");
    return { skipped: true, reason: "not_logged_in" };
  }
  try {
    return await invokeDeviceSync(credential, {
      action: "append_event",
      event_type: eventType,
      payload,
    });
  } catch (error) {
    if (cloudSyncRequired()) throw error;
    console.warn("AgentOS cloud event sync failed:", error);
    return { skipped: true, reason: "sync_failed" };
  }
}

export async function appendCloudMessage(input: {
  channelType: string;
  externalRef: string;
  title?: string;
  direction: "incoming" | "outgoing" | "system";
  messageType?: string;
  text?: string;
  content?: Record<string, unknown>;
  occurredAt?: string;
  idempotencyKey?: string;
  receipt?: {
    status: "pending" | "sent" | "delivered" | "read" | "failed" | "uncertain";
    providerRef?: string;
    evidence?: Record<string, unknown>;
  };
}) {
  if (!cloudSyncEnabled()) return { skipped: true };
  const credential = await readCredential();
  if (!credential) {
    if (cloudSyncRequired()) throw new Error("CLOUD_SYNC_AUTH_REQUIRED");
    return { skipped: true, reason: "not_logged_in" };
  }

  const text = input.text?.trim() || undefined;
  const contentSha256 = text
    ? createHash("sha256").update(text, "utf8").digest("hex")
    : undefined;

  try {
    return await invokeDeviceSync(credential, {
      action: "append_message",
      channel_type: input.channelType,
      external_ref: input.externalRef,
      title: input.title,
      direction: input.direction,
      message_type: input.messageType ?? "text",
      content_text: text,
      content_json: input.content ?? {},
      content_sha256: contentSha256,
      occurred_at: input.occurredAt,
      idempotency_key: input.idempotencyKey,
      receipt: input.receipt,
    });
  } catch (error) {
    if (cloudSyncRequired()) throw error;
    console.warn("AgentOS cloud message sync failed:", error);
    return { skipped: true, reason: "sync_failed" };
  }
}

export async function cloudDeviceLocalSummary() {
  const credential = await readCredential();
  return {
    host: os.hostname(),
    credentialPath: path.relative(os.homedir(), cloudCredentialPath()),
    loggedIn: Boolean(credential),
    deviceId: credential?.deviceId ?? null,
    deviceName: credential?.deviceName ?? null,
    expiresAt: credential?.expiresAt ?? null,
  };
}
