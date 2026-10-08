import { z } from "zod";

// Limits belong to the execution boundary, not MCP argument validation.
// Finite numbers outside this range are harmless: normalize them instead
// of rejecting the entire agent tool call.
export const processOutputTailCharsInput = z
  .number()
  .finite()
  .describe("Requested log tail size in characters; values are clamped to 1000-200000.")
  .optional();

export function normalizeProcessOutputTailChars(
  value: number | undefined,
): number {
  const requested = value ?? 20_000;
  if (!Number.isFinite(requested)) {
    throw new Error("INVALID_TAIL_CHARS: requested tail length must be finite.");
  }
  return Math.min(200_000, Math.max(1_000, Math.trunc(requested)));
}
