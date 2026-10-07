import fs from "node:fs/promises";
import path from "node:path";

const MIB = 1024 * 1024;

const RECLAIMABLE_PROFILE_PATHS = [
  ["Default", "Cache"],
  ["Default", "Code Cache"],
  ["Default", "GPUCache"],
  ["Default", "DawnGraphiteCache"],
  ["Default", "DawnWebGPUCache"],
  ["GraphiteDawnCache"],
  ["component_crx_cache"],
  ["extensions_crx_cache"],
  ["optimization_guide_model_store"],
] as const;

const DISABLED_EXTENSION_PACKAGE_PATHS = [
  ["Default", "Extensions"],
] as const;

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

function boundedCacheBytes(
  name: string,
  defaultBytes: number,
  minBytes: number,
  maxBytes: number,
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return defaultBytes;
  return Math.min(Math.max(Math.trunc(raw), minBytes), maxBytes);
}

export type BrowserProfilePolicy = {
  allowExtensions: boolean;
  allowSync: boolean;
  diskCacheBytes: number;
  mediaCacheBytes: number;
};

export function browserProfilePolicy(): BrowserProfilePolicy {
  return {
    // OWL's managed profile is an automation boundary, not a second copy of
    // the user's normal Chrome extension/sync environment. Extension settings
    // are preserved, while package bytes are reclaimable when extensions stay
    // disabled. Opting in allows Chrome to keep/recreate extension packages.
    allowExtensions: envBoolean("BROWSER_ALLOW_EXTENSIONS", false),
    allowSync: envBoolean("BROWSER_ALLOW_SYNC", false),
    diskCacheBytes: boundedCacheBytes(
      "BROWSER_DISK_CACHE_BYTES",
      64 * MIB,
      8 * MIB,
      512 * MIB,
    ),
    mediaCacheBytes: boundedCacheBytes(
      "BROWSER_MEDIA_CACHE_BYTES",
      32 * MIB,
      8 * MIB,
      256 * MIB,
    ),
  };
}

export function browserProfileLaunchArgs(
  policy = browserProfilePolicy(),
): string[] {
  const args = [
    `--disk-cache-size=${policy.diskCacheBytes}`,
    `--media-cache-size=${policy.mediaCacheBytes}`,
  ];
  if (!policy.allowExtensions) args.push("--disable-extensions");
  if (!policy.allowSync) args.push("--disable-sync");
  return args;
}

export type BrowserProfileMaintenanceResult = {
  removedPaths: string[];
  preservedAuthState: true;
  extensionPackagesRemoved: boolean;
};

export async function maintainBrowserProfileStorage(
  userDataDir: string,
  policy = browserProfilePolicy(),
): Promise<BrowserProfileMaintenanceResult> {
  const removedPaths: string[] = [];
  const targets = [
    ...RECLAIMABLE_PROFILE_PATHS,
    ...(policy.allowExtensions ? [] : DISABLED_EXTENSION_PACKAGE_PATHS),
  ];
  for (const parts of targets) {
    const target = path.join(userDataDir, ...parts);
    try {
      await fs.rm(target, { recursive: true, force: true });
      removedPaths.push(parts.join("/"));
    } catch {
      // Cache cleanup is best effort. Browser startup must not fail because a
      // cache directory is momentarily locked or protected.
    }
  }
  return {
    removedPaths,
    preservedAuthState: true,
    extensionPackagesRemoved: !policy.allowExtensions,
  };
}
