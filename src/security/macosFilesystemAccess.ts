import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DEFAULT_PROBE_TIMEOUT_MS = 750;

const DEFAULT_NODE_PROBE = String.raw`
const fs = require("node:fs");
const candidate = process.argv[1];
try {
  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    const dir = fs.opendirSync(candidate);
    try { dir.readSync(); } finally { dir.closeSync(); }
  } else if (stat.isFile()) {
    const fd = fs.openSync(candidate, "r");
    try { fs.readSync(fd, Buffer.alloc(1), 0, 1, 0); } finally { fs.closeSync(fd); }
  }
  process.exit(0);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  console.error(code + ":" + message);
  process.exit(code === "ENOENT" ? 3 : 2);
}
`;

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

  const probeOverride = process.env.MACOS_FILESYSTEM_PROBE_BIN?.trim();
  const testArgsJson =
    process.env.AGENTOS_RUNTIME_MODE === "test"
      ? process.env.MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON?.trim()
      : undefined;
  const testArgs = testArgsJson
    ? (JSON.parse(testArgsJson) as unknown)
    : undefined;
  if (
    testArgs !== undefined &&
    (!Array.isArray(testArgs) || !testArgs.every((value) => typeof value === "string"))
  ) {
    throw new Error("MACOS_FILESYSTEM_PROBE_TEST_ARGS_JSON must be a JSON string array.");
  }
  const probeBin = probeOverride || process.execPath;
  const probeArgs = probeOverride
    ? ((testArgs as string[] | undefined) ?? [candidate])
    : ["-e", DEFAULT_NODE_PROBE, candidate];

  type InternalProbeResult =
    | MacOSFilesystemProbeResult
    | "permission_required";

  const outcome = await new Promise<InternalProbeResult>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(probeBin, probeArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const finish = (result: InternalProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish("permission_required");
    }, boundedTimeoutMs());

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code === 0) {
        finish("accessible");
        return;
      }

      if (code === 3) {
        finish("missing");
        return;
      }

      const normalized = stderr.toLowerCase();
      if (
        normalized.includes("operation not permitted") ||
        normalized.includes("permission denied") ||
        normalized.includes("not authorized") ||
        normalized.includes("eperm") ||
        normalized.includes("eacces")
      ) {
        finish("permission_required");
        return;
      }

      if (
        normalized.includes("no such file") ||
        normalized.includes("not found")
      ) {
        finish("missing");
        return;
      }

      finish("missing");
    });
  });

  if (outcome === "permission_required") {
    throw new Error(
      "MACOS_FILE_PERMISSION_REQUIRED: macOS filesystem access is unavailable or did not respond. " +
        "Grant Full Disk Access to Computer MCP Runtime, then restart Computer MCP.",
    );
  }

  return outcome;
}

export async function assertMacOSFilesystemResponsive(
  inputPath: string,
): Promise<void> {
  await probeMacOSFilesystemAccess(inputPath);
}
