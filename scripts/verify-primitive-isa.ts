import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrimitiveCatalog,
  PRIMITIVE_ABI_VERSION,
} from "../src/primitives/primitiveRuntime.js";
import {
  PRIMITIVE_ABI_V1_FROZEN,
} from "../src/primitives/primitiveAbiV1Manifest.js";

const catalog = getPrimitiveCatalog();
const canonical = catalog.filter((entry: any) => entry.canonical === true);
const aliases = catalog.filter((entry: any) => entry.canonical === false);

const ids = canonical.map((entry: any) => entry.id);
assert.equal(new Set(ids).size, ids.length, "Canonical Primitive IDs must be unique.");

for (const entry of canonical as any[]) {
  assert.equal(
    entry.abiVersion,
    PRIMITIVE_ABI_VERSION,
    `${entry.id} has the wrong ABI version.`,
  );
  assert.ok(
    ["experimental", "candidate", "stable", "deprecated"].includes(entry.stability),
    `${entry.id} has invalid stability metadata.`,
  );
  assert.ok(
    ["core", "admin", "privileged"].includes(entry.tier),
    `${entry.id} has invalid tier metadata.`,
  );

  for (const [op, metadata] of Object.entries(entry.opMetadata ?? {})) {
    const opMeta = metadata as any;
    if (opMeta.deprecated) {
      assert.ok(
        typeof opMeta.replacement === "string" && opMeta.replacement.length > 0,
        `${entry.id}(${op}) is deprecated without a replacement.`,
      );
    }
  }
}

for (const alias of aliases as any[]) {
  assert.equal(alias.deprecated, true, `${alias.id} alias must be deprecated.`);
  assert.ok(alias.replacement, `${alias.id} alias must declare a replacement.`);
  assert.ok(
    ids.includes(alias.canonicalId),
    `${alias.id} alias points to missing canonical primitive ${alias.canonicalId}.`,
  );
}

const byId = new Map(catalog.map((entry: any) => [entry.id, entry]));

for (const [id, frozen] of Object.entries(
  PRIMITIVE_ABI_V1_FROZEN.primitives,
)) {
  const current = byId.get(id) as any;
  assert.ok(current, `Frozen Primitive ${id} was removed.`);
  assert.equal(current.canonical, true, `${id} must remain canonical.`);
  assert.equal(current.abiVersion, 1, `${id} changed ABI version.`);
  assert.equal(current.stability, "stable", `${id} must remain stable.`);
  assert.equal(current.tier, frozen.tier, `${id} changed tier.`);
  for (const op of frozen.ops) {
    assert.ok(
      current.ops.includes(op),
      `Frozen Primitive operation ${id}(${op}) was removed or renamed.`,
    );
  }
}

assert.equal((byId.get("sys.exec") as any)?.tier, "privileged");
assert.equal((byId.get("admin.permission") as any)?.tier, "admin");
assert.equal((byId.get("admin.permission") as any)?.stability, "experimental");
assert.equal((byId.get("fs.query") as any)?.canonical, false);
assert.equal((byId.get("fs.query") as any)?.replacement, "fs.stat");
assert.ok((byId.get("fs.stat") as any)?.ops.includes("get"));
assert.ok((byId.get("vision.capture") as any)?.ops.includes("page"));
assert.ok(
  (byId.get("clipboard") as any)?.ops.includes("write_file"),
  "clipboard(write_file) must remain available for native attachment workflows.",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillSource = fs.readFileSync(
  path.join(root, "src", "skills", "skillRuntime.ts"),
  "utf8",
);

assert.ok(
  !skillSource.includes("executeRoutedAction"),
  "Built-in Skills must not execute L0.5 routed actions directly.",
);
assert.ok(
  skillSource.includes("executePrimitive"),
  "Built-in Skills must execute through the L1 Primitive ISA.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      primitiveAbiVersion: PRIMITIVE_ABI_VERSION,
      canonicalPrimitives: canonical.length,
      frozenStablePrimitives: Object.keys(
        PRIMITIVE_ABI_V1_FROZEN.primitives,
      ).length,
      aliases: aliases.map((entry: any) => ({
        id: entry.id,
        replacement: entry.replacement,
      })),
      tiers: canonical.reduce(
        (acc: Record<string, number>, entry: any) => {
          acc[entry.tier] = (acc[entry.tier] ?? 0) + 1;
          return acc;
        },
        {},
      ),
      skillsExecuteThroughPrimitiveIsa: true,
    },
    null,
    2,
  ),
);
