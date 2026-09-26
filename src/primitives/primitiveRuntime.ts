import {
  executeRoutedAction,
  validateRoutedAction,
} from "../router/actionRouter.js";

type JsonObject = Record<string, unknown>;

type PrimitiveDefinition = {
  id: string;
  domain: string;
  description: string;
  ops: string[];
  route: (op: string, args: JsonObject) => {
    action: string;
    args: JsonObject;
  };
};

function requireOp(op: string, allowed: string[], primitive: string): string {
  const normalized = op.trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(
      `Primitive ${primitive} does not support op "${op}". Allowed: ${allowed.join(", ")}.`,
    );
  }
  return normalized;
}

const definitions: PrimitiveDefinition[] = [
  {
    id: "provider.status",
    domain: "state",
    description: "Inspect provider availability and enablement.",
    ops: ["get"],
    route: (op, args) => {
      requireOp(op, ["get"], "provider.status");
      return { action: "provider.status", args };
    },
  },
  {
    id: "vision.capture",
    domain: "perception",
    description: "Capture the whole desktop or a rectangular region.",
    ops: ["screen", "region"],
    route: (op, args) => {
      const normalized = requireOp(op, ["screen", "region"], "vision.capture");
      return {
        action:
          normalized === "screen"
            ? "desktop.screenshot"
            : "desktop.screenshot_region",
        args,
      };
    },
  },
  {
    id: "ui.query",
    domain: "perception",
    description: "Inspect macOS accessibility, app focus, or window geometry.",
    ops: ["tree", "find", "frontmost", "bounds"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["tree", "find", "frontmost", "bounds"],
        "ui.query",
      );
      const action = {
        tree: "desktop.ui_tree",
        find: "desktop.ui_find",
        frontmost: "desktop.frontmost_app",
        bounds: "desktop.window_bounds",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "pointer.click",
    domain: "input",
    description: "Click by absolute coordinate or semantic UI element.",
    ops: ["coordinate", "element"],
    route: (op, args) => {
      const normalized = requireOp(op, ["coordinate", "element"], "pointer.click");
      return {
        action:
          normalized === "coordinate"
            ? "desktop.click"
            : "desktop.click_element",
        args,
      };
    },
  },
  {
    id: "keyboard.type",
    domain: "input",
    description: "Paste text into the currently focused desktop control.",
    ops: ["text"],
    route: (op, args) => {
      requireOp(op, ["text"], "keyboard.type");
      return { action: "desktop.type", args };
    },
  },
  {
    id: "keyboard.press",
    domain: "input",
    description: "Send a key or shortcut to the desktop.",
    ops: ["key"],
    route: (op, args) => {
      requireOp(op, ["key"], "keyboard.press");
      return { action: "desktop.key", args };
    },
  },
  {
    id: "clipboard",
    domain: "input",
    description:
      "Read, write, snapshot, restore, monitor, or safely copy the current desktop selection through the macOS clipboard.",
    ops: [
      "read",
      "write",
      "info",
      "snapshot",
      "restore",
      "wait_change",
      "copy_selection",
    ],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        [
          "read",
          "write",
          "info",
          "snapshot",
          "restore",
          "wait_change",
          "copy_selection",
        ],
        "clipboard",
      );
      const action = {
        read: "desktop.clipboard_read",
        write: "desktop.clipboard_write",
        info: "desktop.clipboard_info",
        snapshot: "desktop.clipboard_snapshot",
        restore: "desktop.clipboard_restore",
        wait_change: "desktop.clipboard_wait_change",
        copy_selection: "desktop.clipboard_copy_selection",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "app.lifecycle",
    domain: "app",
    description: "Activate an app, inspect the active app/window, or manage the native macOS helper permissions.",
    ops: ["launch", "frontmost", "bounds", "helper_status", "request_permissions"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["launch", "frontmost", "bounds", "helper_status", "request_permissions"],
        "app.lifecycle",
      );
      const action = {
        launch: "desktop.open_app",
        frontmost: "desktop.frontmost_app",
        bounds: "desktop.window_bounds",
        helper_status: "desktop.helper_status",
        request_permissions: "desktop.helper_request_permissions",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "web.open",
    domain: "web",
    description: "Navigate the managed browser, optionally selecting headless mode.",
    ops: ["navigate"],
    route: (op, args) => {
      requireOp(op, ["navigate"], "web.open");
      return { action: "browser.open", args };
    },
  },
  {
    id: "web.query",
    domain: "web",
    description: "Read page content, tabs, or find visible controls.",
    ops: ["snapshot", "find", "tabs"],
    route: (op, args) => {
      const normalized = requireOp(op, ["snapshot", "find", "tabs"], "web.query");
      const action = {
        snapshot: "browser.snapshot",
        find: "browser.find",
        tabs: "browser.tabs",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "web.act",
    domain: "web",
    description: "Interact with browser controls.",
    ops: ["click", "type", "use_tab"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["click", "type", "use_tab"],
        "web.act",
      );
      const action = {
        click: "browser.click",
        type: "browser.type",
        use_tab: "browser.use_tab",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "web.transfer",
    domain: "web",
    description: "Transfer files into a page or capture a page screenshot.",
    ops: ["upload", "screenshot"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["upload", "screenshot"],
        "web.transfer",
      );
      return {
        action:
          normalized === "upload"
            ? "browser.upload"
            : "browser.screenshot",
        args,
      };
    },
  },
  {
    id: "web.session",
    domain: "web",
    description: "Inspect or close the managed browser session.",
    ops: ["tabs", "close"],
    route: (op, args) => {
      const normalized = requireOp(op, ["tabs", "close"], "web.session");
      return {
        action: normalized === "tabs" ? "browser.tabs" : "browser.close",
        args,
      };
    },
  },
  {
    id: "fs.read",
    domain: "data",
    description: "Read one or many files.",
    ops: ["one", "many"],
    route: (op, args) => {
      const normalized = requireOp(op, ["one", "many"], "fs.read");
      return {
        action: normalized === "one" ? "fs.read" : "fs.read_many",
        args,
      };
    },
  },
  {
    id: "fs.write",
    domain: "data",
    description: "Write, append, edit, or batch-edit files.",
    ops: ["write", "append", "edit", "batch_edit"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["write", "append", "edit", "batch_edit"],
        "fs.write",
      );
      const action = {
        write: "fs.write",
        append: "fs.append",
        edit: "fs.edit",
        batch_edit: "fs.batch_edit",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "fs.list",
    domain: "data",
    description: "List a directory or bounded directory tree.",
    ops: ["directory", "tree"],
    route: (op, args) => {
      const normalized = requireOp(op, ["directory", "tree"], "fs.list");
      return {
        action: normalized === "directory" ? "fs.list" : "fs.tree",
        args,
      };
    },
  },
  {
    id: "fs.query",
    domain: "data",
    description: "Read file metadata.",
    ops: ["info"],
    route: (op, args) => {
      requireOp(op, ["info"], "fs.query");
      return { action: "fs.info", args };
    },
  },
  {
    id: "fs.manage",
    domain: "data",
    description: "Create, move, copy, or delete filesystem paths.",
    ops: ["mkdir", "move", "copy", "delete"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["mkdir", "move", "copy", "delete"],
        "fs.manage",
      );
      const action = {
        mkdir: "fs.mkdir",
        move: "fs.move",
        copy: "fs.copy",
        delete: "fs.delete",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "fs.search",
    domain: "data",
    description: "Search file and directory names.",
    ops: ["names"],
    route: (op, args) => {
      requireOp(op, ["names"], "fs.search");
      return { action: "fs.search", args };
    },
  },
  {
    id: "process.manage",
    domain: "system",
    description: "Start, inspect, interact with, or stop managed processes.",
    ops: ["start", "list", "input", "output", "kill"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["start", "list", "input", "output", "kill"],
        "process.manage",
      );
      const action = {
        start: "shell.start",
        list: "shell.processes",
        input: "shell.input",
        output: "shell.output",
        kill: "shell.kill",
      }[normalized]!;
      return { action, args };
    },
  },
  {
    id: "sys.exec",
    domain: "system",
    description: "Execute a controlled shell command.",
    ops: ["run"],
    route: (op, args) => {
      requireOp(op, ["run"], "sys.exec");
      return { action: "shell.exec", args };
    },
  },
  {
    id: "git.query",
    domain: "git",
    description: "Inspect repository status, diff, or log.",
    ops: ["status", "diff", "log"],
    route: (op, args) => {
      const normalized = requireOp(op, ["status", "diff", "log"], "git.query");
      return { action: `git.${normalized}`, args };
    },
  },
  {
    id: "git.mutate",
    domain: "git",
    description: "Stage, commit, pull, push, or apply a patch.",
    ops: ["add", "commit", "pull", "push", "patch"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["add", "commit", "pull", "push", "patch"],
        "git.mutate",
      );
      return { action: `git.${normalized}`, args };
    },
  },
  {
    id: "tx.manage",
    domain: "transaction",
    description: "Create, inspect, rollback, complete, or list checkpoints.",
    ops: ["begin", "status", "list", "rollback", "complete"],
    route: (op, args) => {
      const normalized = requireOp(
        op,
        ["begin", "status", "list", "rollback", "complete"],
        "tx.manage",
      );
      return { action: `tx.${normalized}`, args };
    },
  },
];

const byId = new Map(definitions.map((definition) => [definition.id, definition]));

export function getPrimitiveCatalog() {
  return definitions.map(({ route: _route, ...definition }) => definition);
}

export function resolvePrimitive(
  primitive: string,
  op: string,
  args: JsonObject = {},
) {
  const definition = byId.get(primitive);
  if (!definition) {
    throw new Error(
      `Unknown primitive "${primitive}". Call primitive_catalog for supported primitives.`,
    );
  }

  const routed = definition.route(op, args);
  const validated = validateRoutedAction(routed.action, routed.args);
  return {
    primitive,
    op,
    domain: definition.domain,
    description: definition.description,
    routedAction: routed.action,
    validation: validated,
  };
}

export async function executePrimitive(
  primitive: string,
  op: string,
  args: JsonObject = {},
) {
  const resolved = resolvePrimitive(primitive, op, args);
  const executed = await executeRoutedAction(
    resolved.routedAction,
    resolved.validation.args,
  );
  return {
    primitive,
    op,
    routedAction: resolved.routedAction,
    provider: executed.provider,
    contract: executed.contract,
    resourceWaitMs: executed.resourceWaitMs,
    durationMs: executed.durationMs,
    result: executed.result,
  };
}
