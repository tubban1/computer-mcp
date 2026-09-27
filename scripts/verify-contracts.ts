import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.EMBEDDING_PROVIDER = "feature-hash";
process.env.EMBEDDING_FALLBACK_PROVIDER = "feature-hash";

const { AGENTOS_RUNTIME_CONTRACTS, AGENTOS_DEPRECATION_POLICY } =
  await import("../src/runtime/contractVersions.js");
const { AGENTOS_RUNTIME_VERSION } =
  await import("../src/runtime/runtimeVersion.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
) as { version?: string };
assert.equal(
  packageJson.version,
  AGENTOS_RUNTIME_VERSION,
  "package.json and Runtime version constant must match.",
);
const {
  PRIMITIVE_ABI_V1_FROZEN,
} = await import("../src/primitives/primitiveAbiV1Manifest.js");
const {
  getPrimitiveCatalog,
  PRIMITIVE_ABI_VERSION,
} = await import("../src/primitives/primitiveRuntime.js");
const {
  getSkillCatalog,
  SKILL_ABI_VERSION,
} = await import("../src/skills/skillRuntime.js");
const {
  getSessionAdapterContract,
  SESSION_ADAPTER_CONTRACT_VERSION,
} = await import("../src/runtime/sessionAdapters.js");
const {
  EMBEDDING_PROVIDER_CONTRACT_VERSION,
  getEmbeddingProviderStatus,
  legacyFeatureHashDescriptor,
} = await import("../src/runtime/embeddingProvider.js");
const {
  getWorkspaceLeaseStorageInfo,
  WORKSPACE_LEASE_CONTRACT_VERSION,
} = await import("../src/runtime/workspaceLeaseManager.js");
const {
  getWorkspaceHandoffStorageInfo,
} = await import("../src/runtime/workspaceHandoffStore.js");

assert.equal(PRIMITIVE_ABI_VERSION, 1);
assert.equal(
  AGENTOS_RUNTIME_CONTRACTS.primitiveAbi.version,
  PRIMITIVE_ABI_VERSION,
);
assert.equal(AGENTOS_RUNTIME_CONTRACTS.primitiveAbi.status, "stable");
assert.equal(SKILL_ABI_VERSION, AGENTOS_RUNTIME_CONTRACTS.skillAbi.version);
assert.equal(
  SESSION_ADAPTER_CONTRACT_VERSION,
  AGENTOS_RUNTIME_CONTRACTS.sessionAdapter.version,
);
assert.equal(
  EMBEDDING_PROVIDER_CONTRACT_VERSION,
  AGENTOS_RUNTIME_CONTRACTS.embeddingProvider.version,
);
assert.equal(
  WORKSPACE_LEASE_CONTRACT_VERSION,
  AGENTOS_RUNTIME_CONTRACTS.workspaceLease.version,
);

for (const contract of Object.values(AGENTOS_RUNTIME_CONTRACTS)) {
  assert.equal(contract.version, 1);
  assert.equal(contract.status, "stable");
  assert.equal(contract.compatibility, "additive-1.x");
}

const catalog = getPrimitiveCatalog() as any[];
const byId = new Map(catalog.map((entry) => [entry.id, entry]));
const frozenEntries = Object.entries(PRIMITIVE_ABI_V1_FROZEN.primitives);

for (const [id, frozen] of frozenEntries) {
  const current = byId.get(id);
  assert.ok(current, `Frozen Primitive ${id} was removed.`);
  assert.equal(current.canonical, true, `${id} must remain canonical.`);
  assert.equal(current.abiVersion, 1, `${id} changed ABI version.`);
  assert.equal(current.stability, "stable", `${id} is no longer stable.`);
  assert.equal(current.tier, frozen.tier, `${id} changed tier.`);
  for (const op of frozen.ops) {
    assert.ok(
      current.ops.includes(op),
      `Frozen Primitive operation ${id}(${op}) was removed or renamed.`,
    );
  }
}

const admin = byId.get("admin.permission");
assert.ok(admin);
assert.equal(admin.canonical, true);
assert.equal(admin.tier, "admin");
assert.equal(admin.stability, "experimental");
for (const op of PRIMITIVE_ABI_V1_FROZEN.experimentalExtensions[
  "admin.permission"
].ops) {
  assert.ok(admin.ops.includes(op));
}

for (const [aliasId, frozen] of Object.entries(
  PRIMITIVE_ABI_V1_FROZEN.compatibilityAliases,
)) {
  const alias = byId.get(aliasId);
  assert.ok(alias, `1.x compatibility alias ${aliasId} was removed.`);
  assert.equal(alias.canonical, false);
  assert.equal(alias.deprecated, true);
  assert.equal(alias.canonicalId, frozen.canonicalId);
  assert.equal(alias.replacement, frozen.replacement);
  for (const op of frozen.ops) assert.ok(alias.ops.includes(op));
}

for (const [primitiveId, operations] of Object.entries(
  PRIMITIVE_ABI_V1_FROZEN.deprecatedOperations,
)) {
  const primitive = byId.get(primitiveId);
  assert.ok(primitive);
  for (const [op, replacement] of Object.entries(operations)) {
    const metadata = primitive.opMetadata?.[op];
    assert.equal(metadata?.deprecated, true);
    assert.equal(metadata?.replacement, replacement);
    assert.ok(
      primitive.ops.includes(op),
      `Deprecated 1.x operation ${primitiveId}(${op}) was removed too early.`,
    );
  }
}

const stableCanonicalIds = new Set(
  frozenEntries.map(([id]) => id),
);
const skills = getSkillCatalog() as any[];
assert.ok(skills.length > 0);
for (const skill of skills) {
  for (const field of [
    "skillVersion",
    "requiredPrimitiveAbi",
    "requiredPrimitives",
    "executionMode",
    "memoryPolicy",
    "contract",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(skill, field),
      `Skill ${skill.id} lost required Skill ABI field ${field}.`,
    );
  }
  assert.ok(typeof skill.skillVersion === "string" && skill.skillVersion.length > 0);
  assert.equal(skill.requiredPrimitiveAbi, 1);
  assert.ok(["inline", "durable"].includes(skill.executionMode));
  assert.deepEqual(Object.keys(skill.memoryPolicy).sort(), [
    "episodic",
    "semanticPromotion",
    "staging",
    "working",
  ]);
  assert.equal(skill.memoryPolicy.working, "runtime");
  assert.equal(skill.memoryPolicy.staging, "available_when_durable");
  assert.equal(skill.memoryPolicy.episodic, "task_events_when_durable");
  assert.equal(skill.memoryPolicy.semanticPromotion, "manual");

  for (const primitive of skill.requiredPrimitives) {
    assert.ok(
      stableCanonicalIds.has(primitive) || primitive === "admin.permission",
      `Skill ${skill.id} depends on non-v1 Primitive ${primitive}.`,
    );
  }

  for (const field of [
    "riskLevel",
    "idempotent",
    "sideEffects",
    "requiresVerification",
    "retryPolicy",
    "resources",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(skill.contract, field),
      `Skill ${skill.id} lost contract field ${field}.`,
    );
  }
}

const sessionContract = getSessionAdapterContract();
assert.equal(sessionContract.version, SESSION_ADAPTER_CONTRACT_VERSION);
for (const operation of [
  "adapters",
  "bind",
  "identify",
  "capture_latest",
  "send",
  "resolve_pending",
  "rebind",
  "list",
  "delete",
]) {
  assert.ok(sessionContract.operations.includes(operation));
}
for (const identityCheck of [
  "adapter_id",
  "normalized_conversation_url",
  "session_fingerprint",
]) {
  assert.ok(sessionContract.requiredIdentityChecks.includes(identityCheck));
}
for (const receipt of [
  "capture_digest",
  "send_digest",
  "turn_counter",
]) {
  assert.ok(sessionContract.receipts.includes(receipt));
}

const embeddingStatus = getEmbeddingProviderStatus();
assert.equal(
  embeddingStatus.contractVersion,
  EMBEDDING_PROVIDER_CONTRACT_VERSION,
);
assert.equal(embeddingStatus.providerId, "feature-hash");
assert.equal(embeddingStatus.normalized, true);
const descriptor = legacyFeatureHashDescriptor();
assert.deepEqual(Object.keys(descriptor).sort(), [
  "configFingerprint",
  "dimensions",
  "model",
  "normalized",
  "providerId",
]);
assert.equal(descriptor.providerId, "feature-hash");
assert.equal(descriptor.normalized, true);
assert.ok(descriptor.dimensions > 0);

const workspace = getWorkspaceLeaseStorageInfo();
assert.equal(workspace.contractVersion, WORKSPACE_LEASE_CONTRACT_VERSION);
assert.equal(workspace.durable, true);
assert.equal(workspace.writeOwnershipOnly, true);
assert.equal(workspace.readWhileWriteOwned, true);
assert.equal(workspace.hierarchicalWorkspaceConflicts, true);
assert.equal(workspace.orphanSessionLeaseReclamation, true);
assert.equal(workspace.sameRuntimeDisconnectedSessionReclamation, true);

const handoff = getWorkspaceHandoffStorageInfo();
assert.equal(handoff.durable, true);
assert.equal(handoff.silentLeaseStealing, false);
assert.equal(handoff.requiresExplicitHandoffConfirmation, true);
assert.equal(handoff.requiresExplicitTakeoverConfirmation, true);

assert.equal(AGENTOS_DEPRECATION_POLICY.majorRemovalOnly, true);
assert.equal(AGENTOS_DEPRECATION_POLICY.oneMinorNoticeMinimum, true);
assert.equal(AGENTOS_DEPRECATION_POLICY.stableIdsCannotBeRepurposed, true);
assert.equal(AGENTOS_DEPRECATION_POLICY.additiveOptionalFieldsAllowed, true);
assert.equal(AGENTOS_DEPRECATION_POLICY.additiveOperationsAllowed, true);

console.log(
  JSON.stringify(
    {
      ok: true,
      runtimeVersion: AGENTOS_RUNTIME_VERSION,
      contracts: AGENTOS_RUNTIME_CONTRACTS,
      frozenPrimitiveCount: frozenEntries.length,
      experimentalExtensions: ["admin.permission"],
      compatibilityAliases: Object.keys(
        PRIMITIVE_ABI_V1_FROZEN.compatibilityAliases,
      ),
      skillAbiVersion: SKILL_ABI_VERSION,
      skillCount: skills.length,
      sessionAdapterContractVersion: SESSION_ADAPTER_CONTRACT_VERSION,
      embeddingProviderContractVersion: EMBEDDING_PROVIDER_CONTRACT_VERSION,
      workspaceLeaseContractVersion: WORKSPACE_LEASE_CONTRACT_VERSION,
      additive1xCompatibility: true,
      deprecatedPathsRetained: true,
    },
    null,
    2,
  ),
);
