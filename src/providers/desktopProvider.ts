import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { envFlag } from "../security/capabilities.js";
import { assertAllowedTargetPath } from "../security/pathGuard.js";
import type { ComputerProvider, ProviderStatus } from "./types.js";

function requireDesktopEnabled(): void {
  if (!envFlag("ALLOW_GUI", false)) {
    throw new Error("Desktop provider is disabled. Set ALLOW_GUI=true and restart computer-mcp.");
  }
  if (process.platform !== "darwin") {
    throw new Error("Desktop provider currently supports macOS only.");
  }
}

async function run(command: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

function appleScriptEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function osascript(script: string) {
  const result = await run("/usr/bin/osascript", ["-e", script]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "osascript failed.");
  }
  return result.stdout.trim();
}

class DesktopProvider implements ComputerProvider {
  readonly id = "desktop";
  readonly label = "Desktop";

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      label: this.label,
      enabled: envFlag("ALLOW_GUI", false),
      available: process.platform === "darwin",
      capabilities: ["desktop"],
      details: {
        platform: process.platform,
        note: "Keyboard/click actions require macOS Accessibility permission for the process running computer-mcp.",
      },
    };
  }

  async frontmostApp() {
    requireDesktopEnabled();
    const name = await osascript(
      'tell application "System Events" to get name of first application process whose frontmost is true',
    );
    return { app: name };
  }

  async openApp(appName: string) {
    requireDesktopEnabled();
    const safe = appleScriptEscape(appName);
    await osascript(`tell application "${safe}" to activate`);
    return { app: appName, activated: true };
  }

  async click(x: number, y: number) {
    requireDesktopEnabled();
    await osascript(
      `tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}`,
    );
    return { x: Math.round(x), y: Math.round(y), clicked: true };
  }

  async type(text: string) {
    requireDesktopEnabled();
    const safe = appleScriptEscape(text);
    await osascript(`tell application "System Events" to keystroke "${safe}"`);
    return { typedCharacters: text.length };
  }

  async key(key: string, modifiers: Array<"command" | "option" | "control" | "shift"> = []) {
    requireDesktopEnabled();

    const keyCodes: Record<string, number> = {
      enter: 36,
      return: 36,
      tab: 48,
      space: 49,
      escape: 53,
      left: 123,
      right: 124,
      down: 125,
      up: 126,
      delete: 51,
      backspace: 51,
    };

    const modifierMap: Record<string, string> = {
      command: "command down",
      option: "option down",
      control: "control down",
      shift: "shift down",
    };

    const using = modifiers.length
      ? ` using {${modifiers.map((m) => modifierMap[m]).join(", ")}}`
      : "";

    const normalized = key.toLowerCase();
    if (keyCodes[normalized] != null) {
      await osascript(
        `tell application "System Events" to key code ${keyCodes[normalized]}${using}`,
      );
    } else if (key.length === 1) {
      await osascript(
        `tell application "System Events" to keystroke "${appleScriptEscape(key)}"${using}`,
      );
    } else {
      throw new Error("Unsupported key name.");
    }

    return { key, modifiers };
  }

  async screenshot(outputPath: string) {
    requireDesktopEnabled();
    const safePath = await assertAllowedTargetPath(outputPath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    const result = await run("/usr/sbin/screencapture", ["-x", safePath]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "screencapture failed.");
    }
    return { path: safePath };
  }
}

export const desktopProvider = new DesktopProvider();
