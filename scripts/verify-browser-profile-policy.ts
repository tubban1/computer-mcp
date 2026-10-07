import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "owl-browser-profile-policy-"));
const profile = path.join(root, "profile");

const {
  browserProfileLaunchArgs,
  maintainBrowserProfileStorage,
} = await import("../src/providers/browserProfilePolicy.js");

async function seed(relative: string, body = relative) {
  const target = path.join(profile, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

async function exists(relative: string) {
  try {
    await fs.access(path.join(profile, relative));
    return true;
  } catch {
    return false;
  }
}

try {
  for (const relative of [
    "Default/Cache/cache.bin",
    "Default/Code Cache/code.bin",
    "Default/GPUCache/gpu.bin",
    "Default/DawnGraphiteCache/a.bin",
    "Default/DawnWebGPUCache/b.bin",
    "GraphiteDawnCache/c.bin",
    "component_crx_cache/component.bin",
    "extensions_crx_cache/ext-crx.bin",
    "optimization_guide_model_store/model.bin",
    "Default/Extensions/ext/package.bin",
  ]) {
    await seed(relative);
  }

  for (const relative of [
    "Default/Cookies",
    "Default/Sessions/session.bin",
    "Default/Session Storage/session-state.bin",
    "Default/IndexedDB/site.db",
    "Default/Local Storage/site.local",
    "Default/Extension State/state.bin",
    "Default/Local Extension Settings/settings.bin",
    "Default/Sync Extension Settings/sync-settings.bin",
    "Default/Preferences",
    "Default/Secure Preferences",
  ]) {
    await seed(relative, "preserve");
  }

  const policy = {
    allowExtensions: false,
    allowSync: false,
    diskCacheBytes: 64 * 1024 * 1024,
    mediaCacheBytes: 32 * 1024 * 1024,
  };
  const args = browserProfileLaunchArgs(policy);
  assert.ok(args.includes("--disable-extensions"));
  assert.ok(args.includes("--disable-sync"));
  assert.ok(args.includes("--disk-cache-size=67108864"));
  assert.ok(args.includes("--media-cache-size=33554432"));

  const result = await maintainBrowserProfileStorage(profile, policy);

  for (const relative of [
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "GraphiteDawnCache",
    "component_crx_cache",
    "extensions_crx_cache",
    "optimization_guide_model_store",
    "Default/Extensions",
  ]) {
    assert.equal(await exists(relative), false, relative + " should be reclaimable");
  }

  for (const relative of [
    "Default/Cookies",
    "Default/Sessions/session.bin",
    "Default/Session Storage/session-state.bin",
    "Default/IndexedDB/site.db",
    "Default/Local Storage/site.local",
    "Default/Extension State/state.bin",
    "Default/Local Extension Settings/settings.bin",
    "Default/Sync Extension Settings/sync-settings.bin",
    "Default/Preferences",
    "Default/Secure Preferences",
  ]) {
    assert.equal(await exists(relative), true, relative + " must be preserved");
  }

  await seed("Default/Extensions/ext/package.bin");
  const optIn = await maintainBrowserProfileStorage(profile, { ...policy, allowExtensions: true });
  assert.equal(await exists("Default/Extensions/ext/package.bin"), true);
  assert.equal(optIn.extensionPackagesRemoved, false);

  console.log(JSON.stringify({
    ok: true,
    defaultExtensionsDisabled: true,
    defaultSyncDisabled: true,
    diskCacheBytes: policy.diskCacheBytes,
    mediaCacheBytes: policy.mediaCacheBytes,
    cacheCleanup: "PASS",
    extensionPackageCleanupWhenDisabled: "PASS",
    authAndSiteStatePreserved: "PASS",
    extensionOptInPreservesPackages: "PASS",
    removedPaths: result.removedPaths,
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
