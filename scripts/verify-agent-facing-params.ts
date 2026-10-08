import assert from "node:assert/strict";

process.env.OWL_RUNTIME_MODE = "test";

const {
  normalizeProcessOutputTailChars,
  processOutputTailCharsInput,
} = await import("../src/runtime/agentFacingInputs.js");
const { validateRoutedAction } = await import(
  "../src/router/actionRouter.js"
);

const examples: Array<[number | undefined, number]> = [
  [undefined, 20_000],
  [500_000, 200_000],
  [200_001, 200_000],
  [999, 1_000],
  [-40, 1_000],
  [0, 1_000],
  [1_234.8, 1_234],
  [20_000, 20_000],
];
for (const [input, expected] of examples) {
  const parsed = processOutputTailCharsInput.parse(input);
  assert.equal(normalizeProcessOutputTailChars(parsed), expected);
  const routed = validateRoutedAction("shell.output", {
    process_id: "safe-test-process",
    ...(input === undefined ? {} : { tail_chars: input }),
  });
  assert.equal(
    normalizeProcessOutputTailChars(
      (routed.args as { tail_chars?: number }).tail_chars,
    ),
    expected,
  );
}

for (const input of ["500000", NaN, Infinity, -Infinity, {}, null]) {
  assert.equal(
    processOutputTailCharsInput.safeParse(input).success,
    false,
    "Invalid nonnumeric argument must still be rejected",
  );
}
assert.throws(
  () =>
    validateRoutedAction("shell.output", {
      process_id: 123,
      tail_chars: 500_000,
    }),
  "Process identity must continue to be validated",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      mcpInputSchema: "PASS",
      routedActionValidation: "PASS",
      bounds: { min: 1000, max: 200000, default: 20000 },
      valuesClamped: examples.length,
      invalidTypesRejected: 6,
      identityValidation: "PASS",
    },
    null,
    2,
  ),
);
