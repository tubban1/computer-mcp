import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DEFAULT_PROBE_TIMEOUT_MS = 750;

function boundedTimeoutMs(): number {
  const parsed = Number(process.env.MACOS_FILESYSTEM_PROBE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(parsed), 100), 5_000);
}

function enabled(): boolean {
  if (process.platform !== "darwin") return false;
  const raw = process.env.MACOS_FILESYSTEM_PREFLIGHT?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function insideHome(candidate: string): boolean {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(candidate);
  const relative = path.relative(home, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export type MacOSFilesystemProbeResult = "accessible" | "missing" | "not_applicable";

export async function probeMacOSFilesystemAccess(
  inputPath: string,
): Promise<MacOSFilesystemProbeResult> {
  const candidate = path.resolve(inputPath);
  if (!enabled() || !insideHome(candidate)) return "not_applicable";

  const probeBin = process.env.MACOS_FILESYSTEM_PROBE_BIN?.trim() || "/usr/bin/stat";
  const probeArgs = process.env.MACOS_FILESYSTEM_PROBE_BIN?.trim()
    ? [candidate]
    : ["-f", "%N", candidate];

  return await new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const child = spawn(probeBin, probeArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const finish = (
      error?: Error,
      result?: MacOSFilesystemProbeResult,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result ?? "accessible");
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new Error(
          "MACOS_FILE_PERMISSION_REQUIRED: filesystem access did not respond. " +
            "Grant Full Disk Access to Computer MCP Runtime, then restart Computer MCP.",
        ),
      );
    }, boundedTimeoutMs());

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (settled) return;
      if (code === 0) {
        finish(undefined, "accessible");
        return;
      }

      const normalized = stderr.toLowerCase();
      if (
        normalized.includes("operation not permitted") ||
        normalized.includes("permission denied") ||
        normalized.includes("not authorized")
      ) {
        finish(
          new Error(
            "MACOS_FILE_PERMISSION_REQUIRED: macOS denied filesystem access. " +
              "Grant Full Disk Access to Computer MCP Runtime, then restart Computer MCP.",
          ),
        );
        return;
      }

      if (
        normalized.includes("no such file") ||
        normalized.includes("not found")
      ) {
        finish(undefined, "missing");
        return;
      }

      finish(undefined, "missing");
    });
  });
}

export async function assertMacOSFilesystemResponsive(
  inputPath: string,
): Promise<void> {
  await probeMacOSFilesystemAccess(inputPath);
}
