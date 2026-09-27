import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = path.join(root, "macos-runtime-host");
const [source, plist, icon, baselineText, installer, installProduction, upgradeProduction] =
  await Promise.all([
    fs.readFile(path.join(hostDir, "ComputerMCPRuntime.swift"), "utf8"),
    fs.readFile(path.join(hostDir, "Info.plist"), "utf8"),
    fs.readFile(path.join(hostDir, "ComputerMCPRuntime.png")),
    fs.readFile(path.join(hostDir, "production-baseline.json"), "utf8"),
    fs.readFile(path.join(root, "scripts", "install-macos-runtime-host.sh"), "utf8"),
    fs.readFile(path.join(root, "scripts", "install-production-runtime.sh"), "utf8"),
    fs.readFile(path.join(root, "scripts", "upgrade-production-runtime.sh"), "utf8"),
  ]);

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const fingerprint = sha256(
  `${sha256(source)}\n${sha256(plist)}\n${sha256(icon)}\n`,
);

const baseline = JSON.parse(baselineText) as {
  runtimeHostVersion: string;
  bundleId: string;
  sourceFingerprint: string;
  productionPolicy: string;
};

assert.equal(baseline.bundleId, "fan.fde.computermcp.runtime");
assert.equal(baseline.runtimeHostVersion, "1.0.0");
assert.equal(
  baseline.productionPolicy,
  "preserve-installed-runtime-host-through-computer-mcp-1.x",
);
assert.equal(fingerprint, baseline.sourceFingerprint);

assert.match(plist, /<string>fan\.fde\.computermcp\.runtime<\/string>/);
assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>ComputerMCPRuntime<\/string>/);
assert.match(installer, /INSTALL_APP="\$HOME\/Applications\/Computer MCP Runtime\.app"/);
assert.match(installer, /SOURCE_FINGERPRINT=/);
assert.match(installer, /ALLOW_UNVERSIONED_RUNTIME_HOST_UPDATE/);
assert.match(installer, /Full Disk Access/);
assert.match(installProduction, /Computer MCP Runtime\.app\/Contents\/MacOS\/ComputerMCPRuntime/);
assert.match(upgradeProduction, /Computer MCP Runtime\.app\/Contents\/MacOS\/ComputerMCPRuntime/);
assert.match(installProduction, /exec "\$RUNTIME_HOST_BIN" "\$NODE_BIN"/);
assert.match(upgradeProduction, /exec "\$RUNTIME_HOST_BIN" "\$NODE_BIN"/);
assert.match(upgradeProduction, /Stable Computer MCP Runtime Host is not installed/);

console.log(
  JSON.stringify(
    {
      ok: true,
      stableRuntimeHostPath: "~/Applications/Computer MCP Runtime.app",
      bundleId: baseline.bundleId,
      runtimeHostVersion: baseline.runtimeHostVersion,
      iconPackaged: true,
      sourceFingerprint: fingerprint,
      serverPromotionPreservesRuntimeHost: true,
      fullDiskAccessBoundToStableHost: true,
    },
    null,
    2,
  ),
);
