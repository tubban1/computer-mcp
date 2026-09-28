#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const CLOUD_URL = (process.env.AGENTOS_CLOUD_URL || "https://psnxgftfywpzriseetjg.supabase.co").replace(/\/+$/, "");
const PUBLISHABLE_KEY = process.env.AGENTOS_CLOUD_PUBLISHABLE_KEY || "sb_publishable_71Xx23rZ0gymA2Cemp_fjQ_W15M5dc1";
const APP_URL = (process.env.AGENTOS_CLOUD_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const stateRoot = process.env.AGENTOS_STATE_ROOT || path.join(os.homedir(), ".computer-mcp");
const cloudDir = path.join(stateRoot, "cloud");
const credentialPath = path.join(cloudDir, "device.json");
const installationPath = path.join(cloudDir, "installation.json");

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivate(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(file), 0o700).catch(() => undefined);
  const temp = file + "." + process.pid + ".tmp";
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8", mode: 0o600,
  });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

async function installation() {
  const existing = await readJson(installationPath);
  if (existing?.installationId) return existing;
  const created = {
    version: 1,
    installationId: randomUUID(),
    deviceName: os.hostname(),
    platform: process.platform + "-" + process.arch,
    createdAt: new Date().toISOString(),
  };
  await writePrivate(installationPath, created);
  return created;
}

async function invoke(body, token) {
  const response = await fetch(CLOUD_URL + "/functions/v1/agentos-device-" + (body.action === "authorize" || body.action === "heartbeat" ? "sync" : "auth"), {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(token ? { authorization: "Bearer " + token } : {}),
      "content-type": "application/json",
      "user-agent": "computer-mcp/cloud-device-cli-v1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({ error: "non_json_response" }));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || "HTTP_" + response.status);
  }
  return payload;
}

function openBrowser(url) {
  if (process.platform !== "darwin") return false;
  try {
    const child = spawn("/usr/bin/open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function login() {
  const identity = await installation();
  const requested = await invoke({
    action: "request",
    installation_id: identity.installationId,
    device_name: identity.deviceName,
    platform: identity.platform,
  });

  const verificationUrl = APP_URL + (requested.verification_path || "/device?code=" + encodeURIComponent(requested.user_code));
  console.log("Computer MCP device code:", requested.user_code);
  console.log("Approve this computer at:", verificationUrl);
  openBrowser(verificationUrl);

  const deadline = Date.parse(requested.expires_at);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const polled = await invoke({
      action: "poll",
      request_id: requested.request_id,
      poll_token: requested.poll_token,
    });
    if (polled.status === "pending") continue;
    if (polled.status !== "approved" || !polled.access_token) {
      throw new Error("Device authorization ended with status: " + polled.status);
    }

    await writePrivate(credentialPath, {
      version: 1,
      installationId: identity.installationId,
      deviceId: polled.device.id,
      deviceName: polled.device.device_name,
      platform: polled.device.platform,
      accessToken: polled.access_token,
      expiresAt: polled.expires_at,
      capabilities: polled.grants?.capabilities ?? [],
      scopes: polled.grants?.scopes ?? {},
      authorizedAt: new Date().toISOString(),
    });
    console.log("Computer MCP cloud authorization complete.");
    console.log("Device:", polled.device.device_name, polled.device.id);
    console.log("Credential stored privately at:", credentialPath);
    return;
  }
  throw new Error("Device authorization expired.");
}

async function status() {
  const credential = await readJson(credentialPath);
  if (!credential?.accessToken) {
    console.log(JSON.stringify({ loggedIn: false, credentialPath }, null, 2));
    return;
  }
  try {
    const result = await invoke({ action: "authorize" }, credential.accessToken);
    console.log(JSON.stringify({
      loggedIn: true,
      authorized: result.authorized === true,
      device: result.device,
      grants: result.grants,
      expiresAt: credential.expiresAt,
      credentialPath,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      loggedIn: true,
      authorized: false,
      error: error instanceof Error ? error.message : String(error),
      expiresAt: credential.expiresAt,
      credentialPath,
    }, null, 2));
    process.exitCode = 1;
  }
}

async function logout() {
  await fs.rm(credentialPath, { force: true });
  console.log("Local Computer MCP cloud credential removed.");
  console.log("For full revocation, revoke the device from your OWL cloud account.");
}

async function heartbeat() {
  const credential = await readJson(credentialPath);
  if (!credential?.accessToken) throw new Error("Computer MCP is not logged in.");
  const result = await invoke({
    action: "heartbeat",
    payload: {
      runtimeMode: process.env.AGENTOS_RUNTIME_MODE || "unknown",
      version: process.env.npm_package_version || null,
    },
  }, credential.accessToken);
  console.log(JSON.stringify(result, null, 2));
}

const command = process.argv[2] || "status";
if (command === "login") await login();
else if (command === "status") await status();
else if (command === "logout") await logout();
else if (command === "heartbeat") await heartbeat();
else {
  console.error("Usage: node scripts/cloud-device.mjs login|status|logout|heartbeat");
  process.exitCode = 2;
}
