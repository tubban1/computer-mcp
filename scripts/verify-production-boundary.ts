import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRuntimeClientStatus,
} from "../src/runtimeClient/runtimeClient.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [
  pkgText,
  installProduction,
  upgradeProduction,
  installHelper,
  helperPlist,
  helperSource,
  helperBaselineText,
] = await Promise.all([
  fs.readFile(path.join(root, "package.json"), "utf8"),
  fs.readFile(path.join(root, "scripts/install-production-runtime.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/upgrade-production-runtime.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/install-macos-helper.sh"), "utf8"),
  fs.readFile(path.join(root, "macos-helper/Info.plist"), "utf8"),
  fs.readFile(
    path.join(root, "macos-helper/ComputerMCPHelper.swift"),
    "utf8",
  ),
  fs.readFile(
    path.join(root, "macos-helper/production-baseline.json"),
    "utf8",
  ),
]);

const pkg = JSON.parse(pkgText) as {
  scripts?: Record<string, string>;
};

assert.equal(
  pkg.scripts?.["promote:production"],
  "bash scripts/upgrade-production-runtime.sh",
);
assert.equal(
  pkg.scripts?.["upgrade:production"],
  pkg.scripts?.["promote:production"],
);

for (const [name, source] of [
  ["install-production-runtime.sh", installProduction],
  ["upgrade-production-runtime.sh", upgradeProduction],
] as const) {
  assert.doesNotMatch(
    source,
    /install-macos-helper|ComputerMCPHelper|Computer MCP Helper\.app|macos-helper\//,
    `${name} must never install/replace the native Helper.`,
  );
}

for (const automaticHook of [
  "preinstall",
  "postinstall",
  "prepare",
  "prepublish",
  "postpublish",
]) {
  const command = pkg.scripts?.[automaticHook] ?? "";
  assert.doesNotMatch(
    command,
    /promote:production|upgrade:production|install-production-runtime|upgrade-production-runtime/,
    `${automaticHook} must not promote production.`,
  );
}

assert.match(
  helperPlist,
  /<key>CFBundleIdentifier<\/key>\s*<string>fan\.fde\.computermcp\.helper<\/string>/,
);
const helperVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
  helperPlist,
)?.[1];
assert.ok(helperVersion);

const helperBaseline = JSON.parse(helperBaselineText) as {
  helperVersion: string;
  bundleId: string;
  sourceFingerprint: string;
  productionPolicy: string;
};
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const helperSourceFingerprint = sha256(
  `${sha256(helperSource)}\n${sha256(helperPlist)}\n`,
);
assert.equal(helperBaseline.helperVersion, helperVersion);
assert.equal(helperBaseline.bundleId, "fan.fde.computermcp.helper");
assert.equal(
  helperBaseline.productionPolicy,
  "preserve-installed-helper-through-computer-mcp-1.x",
);
assert.equal(
  helperSourceFingerprint,
  helperBaseline.sourceFingerprint,
  "Native Helper source changed from the 1.x production baseline. Bump the independent Helper version, update the baseline deliberately, and verify stable signing/TCC behavior before production promotion.",
);

assert.match(
  installHelper,
  /INSTALL_APP="\$HOME\/Applications\/Computer MCP Helper\.app"/,
);
assert.match(installHelper, /SOURCE_FINGERPRINT=/);
assert.match(installHelper, /ALLOW_UNVERSIONED_HELPER_UPDATE/);
assert.match(installHelper, /COMPUTER_MCP_HELPER_SIGN_IDENTITY/);
assert.match(
  installHelper,
  /Computer MCP Helper is unchanged; preserving the installed app and macOS permission identity/,
);
assert.match(
  installHelper,
  /predates fingerprint tracking/,
);
assert.match(
  installHelper,
  /Preserving it in place to avoid unnecessary macOS TCC permission churn/,
);

const previousMode = process.env.AGENTOS_RUNTIME_MODE;
const previousComputerMode = process.env.COMPUTER_MCP_RUNTIME_MODE;
const previousBackend = process.env.COMPUTER_MCP_RUNTIME_BACKEND;

try {
  process.env.AGENTOS_RUNTIME_MODE = "production";
  delete process.env.COMPUTER_MCP_RUNTIME_MODE;
  process.env.COMPUTER_MCP_RUNTIME_BACKEND = "legacy";
  assert.equal(getRuntimeClientStatus().backend, "legacy");

  process.env.COMPUTER_MCP_RUNTIME_BACKEND = "owl-http";
  assert.throws(
    () => getRuntimeClientStatus(),
    /PRODUCTION_BACKEND_LOCKED/,
  );
} finally {
  if (previousMode === undefined) delete process.env.AGENTOS_RUNTIME_MODE;
  else process.env.AGENTOS_RUNTIME_MODE = previousMode;

  if (previousComputerMode === undefined) {
    delete process.env.COMPUTER_MCP_RUNTIME_MODE;
  } else {
    process.env.COMPUTER_MCP_RUNTIME_MODE = previousComputerMode;
  }

  if (previousBackend === undefined) {
    delete process.env.COMPUTER_MCP_RUNTIME_BACKEND;
  } else {
    process.env.COMPUTER_MCP_RUNTIME_BACKEND = previousBackend;
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      explicitProductionPromotionOnly: true,
      productionScriptsDoNotReplaceHelper: true,
      helperStablePath:
        "~/Applications/Computer MCP Helper.app",
      helperBundleId: "fan.fde.computermcp.helper",
      helperVersion,
      helperIndependentVersioningGuard: true,
      helperSourceFrozenFor1xProduction: true,
      legacySameVersionHelperPreservedInPlace: true,
      helperSourceFingerprint,
      production1xStandaloneBackendLocked: true,
    },
    null,
    2,
  ),
);
