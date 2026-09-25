import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assertAllowedExistingPath } from "../security/pathGuard.js";
import { requireCapability } from "../security/capabilities.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const processRegistry = new Map<
  string,
  {
    child: ChildProcessWithoutNullStreams;
    command: string;
    cwd: string;
    startedAt: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }
>();

function appendCapped(current: string, next: Buffer | string): string {
  const combined = current + next.toString();
  if (Buffer.byteLength(combined, "utf8") <= MAX_CAPTURE_BYTES) return combined;
  return combined.slice(-MAX_CAPTURE_BYTES);
}

function shellBinary(): string {
  return process.env.SHELL || "/bin/zsh";
}

export async function executeCommand(command: string, cwd: string, timeoutMs = 60_000) {
  requireCapability("ALLOW_SHELL", false);
  const safeCwd = await assertAllowedExistingPath(cwd);

  return await new Promise<{
    command: string;
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(shellBinary(), ["-lc", command], {
      cwd: safeCwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, Math.min(Math.max(timeoutMs, 1_000), 10 * 60_000));

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ command, cwd: safeCwd, exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

export async function startProcess(command: string, cwd: string) {
  requireCapability("ALLOW_SHELL", false);
  const safeCwd = await assertAllowedExistingPath(cwd);
  const id = randomUUID();

  const child = spawn(shellBinary(), ["-lc", command], {
    cwd: safeCwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const record = {
    child,
    command,
    cwd: safeCwd,
    startedAt: new Date().toISOString(),
    stdout: "",
    stderr: "",
    exitCode: null as number | null,
  };

  child.stdout.on("data", (chunk) => {
    record.stdout = appendCapped(record.stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    record.stderr = appendCapped(record.stderr, chunk);
  });
  child.on("close", (code) => {
    record.exitCode = code;
  });

  processRegistry.set(id, record);
  return { processId: id, pid: child.pid ?? null, command, cwd: safeCwd };
}

export function listProcesses() {
  return [...processRegistry.entries()].map(([processId, record]) => ({
    processId,
    pid: record.child.pid ?? null,
    command: record.command,
    cwd: record.cwd,
    startedAt: record.startedAt,
    running: record.exitCode === null,
    exitCode: record.exitCode,
  }));
}

export function sendProcessInput(processId: string, input: string) {
  requireCapability("ALLOW_SHELL", false);
  const record = processRegistry.get(processId);
  if (!record) throw new Error("Unknown process_id.");
  if (record.exitCode !== null) throw new Error("Process has already exited.");
  if (!record.child.stdin.writable) throw new Error("Process stdin is not writable.");
  record.child.stdin.write(input);
  return { processId, bytesWritten: Buffer.byteLength(input, "utf8") };
}

export function getProcessOutput(processId: string, tailChars = 20_000) {
  const record = processRegistry.get(processId);
  if (!record) throw new Error("Unknown process_id.");
  const limit = Math.min(Math.max(tailChars, 1_000), 200_000);
  return {
    processId,
    running: record.exitCode === null,
    exitCode: record.exitCode,
    stdout: record.stdout.slice(-limit),
    stderr: record.stderr.slice(-limit),
  };
}

export function killProcess(processId: string, signal: NodeJS.Signals = "SIGTERM") {
  requireCapability("ALLOW_SHELL", false);
  const record = processRegistry.get(processId);
  if (!record) throw new Error("Unknown process_id.");
  const sent = record.child.kill(signal);
  return { processId, signal, sent };
}
