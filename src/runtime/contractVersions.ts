export const AGENTOS_RUNTIME_CONTRACTS = {
  primitiveAbi: {
    version: 1,
    status: "stable",
    compatibility: "additive-1.x",
  },
  skillAbi: {
    version: 1,
    status: "stable",
    compatibility: "additive-1.x",
  },
  sessionAdapter: {
    version: 1,
    status: "stable",
    compatibility: "additive-1.x",
  },
  embeddingProvider: {
    version: 1,
    status: "stable",
    compatibility: "additive-1.x",
  },
  workspaceLease: {
    version: 1,
    status: "stable",
    compatibility: "additive-1.x",
  },
} as const;

export const AGENTOS_DEPRECATION_POLICY = {
  majorRemovalOnly: true,
  oneMinorNoticeMinimum: true,
  stableIdsCannotBeRepurposed: true,
  additiveOptionalFieldsAllowed: true,
  additiveOperationsAllowed: true,
} as const;
