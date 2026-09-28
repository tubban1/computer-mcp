import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const root = await fs.mkdtemp(path.join(tmpdir(), "computer-mcp-cloud-auth-"));
process.env.AGENTOS_RUNTIME_MODE = "test";
process.env.AGENTOS_STATE_ROOT = root;
process.env.AGENTOS_CLOUD_AUTH_REQUIRED = "true";
process.env.AGENTOS_CLOUD_SYNC = "true";
process.env.AGENTOS_CLOUD_SYNC_REQUIRED = "true";
process.env.AGENTOS_CLOUD_AUTH_CACHE_MS = "1000";

const cloud = await import("../src/cloud/cloudDevice.js");

let status = await cloud.getCloudAuthorizationStatus({ force: true });
assert.equal(status.loggedIn, false);
assert.equal(status.authorized, false);
await assert.rejects(() => cloud.assertCloudAuthorized(), /CLOUD_AUTH_REQUIRED/);

const credentialPath = cloud.cloudCredentialPath();
await fs.mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
const token = "test-device-token-secret";
await fs.writeFile(
  credentialPath,
  JSON.stringify({
    version: 1,
    installationId: "installation-test",
    deviceId: "device-test",
    deviceName: "test-mac",
    platform: "darwin-arm64",
    accessToken: token,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    capabilities: ["computer.control", "cloud.sync"],
    scopes: {},
    authorizedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);

const calls: Array<Record<string, unknown>> = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  calls.push(body);
  if (body.action === "refresh_token") {
    return new Response(JSON.stringify({
      ok: true,
      access_token: "rotated-device-token-secret",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      device: {
        id: "device-test",
        device_name: "test-mac",
        platform: "darwin-arm64",
        status: "active",
      },
      grants: {
        capabilities: ["computer.control", "cloud.sync"],
        scopes: {},
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (body.action === "authorize") {
    return new Response(JSON.stringify({
      ok: true,
      authorized: true,
      device: {
        id: "device-test",
        device_name: "test-mac",
        platform: "darwin-arm64",
        status: "active",
      },
      grants: {
        capabilities: ["computer.control", "cloud.sync"],
        scopes: {},
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (body.action === "append_message") {
    return new Response(JSON.stringify({
      ok: true,
      message: { id: "message-test" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

status = await cloud.getCloudAuthorizationStatus({ force: true });
assert.equal(status.authorized, true);
assert.equal(status.deviceId, "device-test");
assert.equal((status as unknown as Record<string, unknown>).accessToken, undefined);
assert.ok(calls.some((call) => call.action === "refresh_token"));
const rotated = JSON.parse(await fs.readFile(credentialPath, "utf8")) as {
  accessToken: string;
  expiresAt: string;
};
assert.equal(rotated.accessToken, "rotated-device-token-secret");
assert.ok(Date.parse(rotated.expiresAt) > Date.now() + 20 * 24 * 60 * 60_000);
await cloud.assertCloudAuthorized();

await cloud.appendCloudMessage({
  channelType: "wechat",
  externalRef: "wechat_session_test",
  title: "Test Contact",
  direction: "outgoing",
  text: "hello",
  idempotencyKey: "wechat_session_test:outgoing:1:digest",
  receipt: { status: "sent", providerRef: "wechat_session_test" },
});
const messageCall = calls.find((call) => call.action === "append_message");
assert.ok(messageCall);
assert.equal(messageCall?.content_text, "hello");
assert.equal(messageCall?.direction, "outgoing");
assert.equal(messageCall?.idempotency_key, "wechat_session_test:outgoing:1:digest");

globalThis.fetch = (async () =>
  new Response(JSON.stringify({ error: "DEVICE_REVOKED" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

status = await cloud.getCloudAuthorizationStatus({ force: true });
assert.equal(status.authorized, false);
assert.equal(status.reason, "DEVICE_REVOKED");
await assert.rejects(() => cloud.assertCloudAuthorized(), /CLOUD_AUTH_REQUIRED/);

await fs.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  deviceCodeCredentialBoundary: true,
  opaqueTokenNeverReturnedByStatus: true,
  cloudGrantRequiredForControl: true,
  deviceTokenRotatesBeforeExpiry: true,
  communicationSyncUsesIdempotencyKey: true,
  revocationFailsClosed: true,
}, null, 2));
