import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { envFlag } from "../security/capabilities.js";
import { assertAllowedTargetPath } from "../security/pathGuard.js";
import type { ComputerProvider, ProviderStatus } from "./types.js";

export type DesktopUiElement = {
  index: number;
  role: string;
  name: string;
  description: string;
  value: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

function requireDesktopEnabled(): void {
  if (!envFlag("ALLOW_GUI", false)) {
    throw new Error(
      "Desktop provider is disabled. Set ALLOW_GUI=true and restart computer-mcp.",
    );
  }
  if (process.platform !== "darwin") {
    throw new Error("Desktop provider currently supports macOS only.");
  }
}

async function run(command: string, args: string[]) {
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout, stderr, exitCode: code ?? 1 }),
    );
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

function parseNumber(value: string): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function cleanField(value: string): string {
  return value.replaceAll("\\n", " ").replaceAll("\\r", " ").trim();
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
      capabilities: [
        "desktop",
        "accessibility",
        "ui-tree",
        "region-screenshot",
        "clipboard",
      ],
      details: {
        platform: process.platform,
        note:
          "Keyboard/click/UI-tree actions require macOS Accessibility permission. Screenshots require Screen Recording permission.",
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

  async windowBounds(appName?: string) {
    requireDesktopEnabled();
    const target =
      appName?.trim() || (await this.frontmostApp()).app;
    const safe = appleScriptEscape(target);

    const output = await osascript(`
      tell application "System Events"
        tell process "${safe}"
          if (count of windows) is 0 then return "NOT_FOUND"
          set p to position of front window
          set s to size of front window
          return (item 1 of p as text) & tab & (item 2 of p as text) & tab & (item 1 of s as text) & tab & (item 2 of s as text)
        end tell
      end tell
    `);

    if (output === "NOT_FOUND") {
      throw new Error(`No window found for application "${target}".`);
    }

    const [x, y, width, height] = output.split("\t").map(Number);
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`Could not parse window bounds for "${target}".`);
    }

    return { app: target, x, y, width, height };
  }

  async uiTree(appName?: string, maxElements = 300): Promise<{
    app: string;
    elements: DesktopUiElement[];
    truncated: boolean;
  }> {
    requireDesktopEnabled();
    const target =
      appName?.trim() || (await this.frontmostApp()).app;
    const safe = appleScriptEscape(target);
    const limit = Math.min(Math.max(Math.trunc(maxElements), 1), 1000);

    const output = await osascript(`
      tell application "System Events"
        tell process "${safe}"
          if (count of windows) is 0 then return ""
          set allItems to entire contents of front window
          set itemCount to count of allItems
          set maxCount to ${limit}
          if itemCount < maxCount then set maxCount to itemCount
          set outText to ""
          repeat with i from 1 to maxCount
            set e to item i of allItems
            set roleText to ""
            set nameText to ""
            set descText to ""
            set valueText to ""
            set px to "-1"
            set py to "-1"
            set sw to "-1"
            set sh to "-1"
            try
              set roleText to role of e as text
            end try
            try
              set nameText to name of e as text
            end try
            try
              set descText to description of e as text
            end try
            try
              set valueText to value of e as text
            end try
            try
              set p to position of e
              set px to item 1 of p as text
              set py to item 2 of p as text
            end try
            try
              set s to size of e
              set sw to item 1 of s as text
              set sh to item 2 of s as text
            end try
            set outText to outText & i & tab & roleText & tab & nameText & tab & descText & tab & valueText & tab & px & tab & py & tab & sw & tab & sh & linefeed
          end repeat
          return outText
        end tell
      end tell
    `);

    const elements = output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line): DesktopUiElement | null => {
        const fields = line.split("\t");
        if (fields.length < 9) return null;
        return {
          index: Number(fields[0]) || 0,
          role: cleanField(fields[1] ?? ""),
          name: cleanField(fields[2] ?? ""),
          description: cleanField(fields[3] ?? ""),
          value: cleanField(fields[4] ?? ""),
          x: parseNumber(fields[5] ?? ""),
          y: parseNumber(fields[6] ?? ""),
          width: parseNumber(fields[7] ?? ""),
          height: parseNumber(fields[8] ?? ""),
        };
      })
      .filter((item): item is DesktopUiElement => Boolean(item));

    return {
      app: target,
      elements,
      truncated: elements.length >= limit,
    };
  }

  async uiFind(
    query: string,
    appName?: string,
    maxResults = 20,
    maxElements = 500,
  ) {
    requireDesktopEnabled();
    const normalized = query.trim().toLowerCase();
    if (!normalized) throw new Error("UI query cannot be empty.");

    const tree = await this.uiTree(appName, maxElements);
    const matches = tree.elements
      .filter((element) =>
        [element.name, element.description, element.value, element.role]
          .join("\n")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, Math.min(Math.max(Math.trunc(maxResults), 1), 100));

    return {
      app: tree.app,
      query,
      matches,
      scanned: tree.elements.length,
      truncated: tree.truncated,
    };
  }

  async clickElement(query: string, appName?: string, matchIndex = 0) {
    requireDesktopEnabled();
    const result = await this.uiFind(query, appName, matchIndex + 1, 700);
    const element = result.matches[matchIndex];
    if (!element) {
      throw new Error(
        `No accessible UI element matching "${query}" was found in ${result.app}.`,
      );
    }
    if (
      element.x == null ||
      element.y == null ||
      element.width == null ||
      element.height == null
    ) {
      throw new Error(
        `Matched UI element "${query}" has no usable screen geometry.`,
      );
    }

    const x = Math.round(element.x + Math.max(element.width, 1) / 2);
    const y = Math.round(element.y + Math.max(element.height, 1) / 2);
    await this.click(x, y);
    return { app: result.app, query, matchIndex, x, y, element };
  }

  async click(x: number, y: number) {
    requireDesktopEnabled();
    await osascript(
      `tell application "System Events" to click at {${Math.round(x)}, ${Math.round(y)}}`,
    );
    return { x: Math.round(x), y: Math.round(y), clicked: true };
  }

  async clipboardRead() {
    requireDesktopEnabled();
    const result = await run("/usr/bin/pbpaste", []);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "pbpaste failed.");
    }
    return { text: result.stdout };
  }

  async clipboardWrite(text: string) {
    requireDesktopEnabled();
    const safe = appleScriptEscape(text);
    await osascript(`set the clipboard to "${safe}"`);
    return { writtenCharacters: text.length };
  }

  async type(text: string) {
    requireDesktopEnabled();
    await this.clipboardWrite(text);
    await osascript(
      'tell application "System Events" to keystroke "v" using {command down}',
    );
    return { typedCharacters: text.length, method: "clipboard-paste" };
  }

  async key(
    key: string,
    modifiers: Array<"command" | "option" | "control" | "shift"> = [],
  ) {
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
      pageup: 116,
      pagedown: 121,
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

    const normalized = key.toLowerCase().replaceAll(" ", "");
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

  async screenshotRegion(
    outputPath: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    requireDesktopEnabled();
    const values = [x, y, width, height].map((value) => Math.round(value));
    if (values.some((value) => !Number.isFinite(value)) || width <= 0 || height <= 0) {
      throw new Error("Invalid screenshot region.");
    }

    const safePath = await assertAllowedTargetPath(outputPath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    const region = values.join(",");
    const result = await run("/usr/sbin/screencapture", [
      "-x",
      "-R",
      region,
      safePath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || "regional screencapture failed.");
    }
    return { path: safePath, x: values[0], y: values[1], width: values[2], height: values[3] };
  }
}

export const desktopProvider = new DesktopProvider();
