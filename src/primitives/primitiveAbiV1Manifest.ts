export type FrozenPrimitiveContract = {
  tier: "core" | "privileged";
  ops: readonly string[];
};

export const PRIMITIVE_ABI_V1_FROZEN = {
  version: 1,
  status: "stable",
  compatibility: "additive-1.x",
  primitives: {
    "provider.status": { tier: "core", ops: ["get"] },
    "vision.capture": {
      tier: "core",
      ops: ["screen", "region", "window", "page"],
    },
    "vision.ocr": { tier: "core", ops: ["window"] },
    "ui.query": {
      tier: "core",
      ops: ["tree", "find", "frontmost", "bounds"],
    },
    "pointer.click": { tier: "core", ops: ["coordinate", "element"] },
    "keyboard.type": { tier: "core", ops: ["text"] },
    "keyboard.press": { tier: "core", ops: ["key"] },
    clipboard: {
      tier: "core",
      ops: [
        "read",
        "write",
        "info",
        "snapshot",
        "restore",
        "wait_change",
        "copy_selection",
      ],
    },
    "app.lifecycle": {
      tier: "core",
      ops: [
        "launch",
        "frontmost",
        "bounds",
        "helper_status",
        "request_permissions",
      ],
    },
    "web.open": { tier: "core", ops: ["navigate"] },
    "web.query": { tier: "core", ops: ["snapshot", "find", "tabs"] },
    "web.act": { tier: "core", ops: ["click", "type", "use_tab"] },
    "web.transfer": { tier: "core", ops: ["upload", "screenshot"] },
    "web.session": {
      tier: "core",
      ops: ["tabs", "use_tab", "new_tab", "close"],
    },
    "fs.read": { tier: "core", ops: ["one", "many"] },
    "fs.write": {
      tier: "core",
      ops: ["write", "append", "edit", "batch_edit"],
    },
    "fs.list": { tier: "core", ops: ["directory", "tree"] },
    "fs.stat": { tier: "core", ops: ["get", "info"] },
    "fs.manage": {
      tier: "core",
      ops: ["mkdir", "move", "copy", "delete"],
    },
    "fs.search": { tier: "core", ops: ["names"] },
    "process.manage": {
      tier: "core",
      ops: ["start", "list", "input", "output", "kill"],
    },
    "sys.exec": { tier: "privileged", ops: ["run"] },
    "git.query": { tier: "core", ops: ["status", "diff", "log"] },
    "git.mutate": {
      tier: "core",
      ops: ["add", "commit", "pull", "push", "patch"],
    },
    "tx.manage": {
      tier: "core",
      ops: ["begin", "status", "list", "rollback", "complete"],
    },
  } satisfies Record<string, FrozenPrimitiveContract>,
  experimentalExtensions: {
    "admin.permission": {
      tier: "admin",
      ops: ["status", "request"],
    },
  },
  compatibilityAliases: {
    "fs.query": {
      canonicalId: "fs.stat",
      replacement: "fs.stat",
      ops: ["get", "info"],
    },
  },
  deprecatedOperations: {
    "ui.query": {
      frontmost: "app.lifecycle(frontmost)",
      bounds: "app.lifecycle(bounds)",
    },
    "app.lifecycle": {
      helper_status: "admin.permission(status)",
      request_permissions: "admin.permission(request)",
    },
    "web.query": {
      tabs: "web.session(tabs)",
    },
    "web.act": {
      use_tab: "web.session(use_tab)",
    },
    "web.transfer": {
      screenshot: "vision.capture(page)",
    },
    "fs.stat": {
      info: "fs.stat(get)",
    },
  },
} as const;

export type PrimitiveAbiV1FrozenId =
  keyof typeof PRIMITIVE_ABI_V1_FROZEN.primitives;
