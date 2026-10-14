import { envFlag } from "../security/capabilities.js";
import { configuredRoots, runtimeOwnedRoots } from "../security/pathGuard.js";
import type { ComputerProvider, ProviderStatus } from "./types.js";
import { browserProvider } from "./browserProvider.js";
import { desktopProvider } from "./desktopProvider.js";
import { publishMockCapability } from "./publishMockProvider.js";
import {officialPilotCapability} from "./publishOfficialProvider.js";

class StaticProvider implements ComputerProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly statusFn: () => Promise<ProviderStatus>,
  ) {}

  status(): Promise<ProviderStatus> {
    return this.statusFn();
  }
}

const filesystemProvider = new StaticProvider("filesystem", "Filesystem", async () => ({
  id: "filesystem",
  label: "Filesystem",
  enabled: configuredRoots().length > 0,
  available: configuredRoots().length > 0,
  capabilities: ["filesystem"],
  executionTargets: ["host"],
  details: {
    allowedDirectories: configuredRoots(),
    runtimeOwnedDirectories: runtimeOwnedRoots(),
    write: envFlag("ALLOW_WRITE", true),
    delete: envFlag("ALLOW_DELETE", false),
  },
}));

const shellProvider = new StaticProvider("shell", "Shell", async () => ({
  id: "shell",
  label: "Shell",
  enabled: envFlag("ALLOW_SHELL", false),
  available: true,
  capabilities: ["shell"],
  executionTargets: ["host"],
  details: { enabledBy: "ALLOW_SHELL" },
}));

const gitProvider = new StaticProvider("git", "Git", async () => ({
  id: "git",
  label: "Git",
  enabled: true,
  available: true,
  capabilities: ["git"],
  executionTargets: ["host"],
  details: {
    push: envFlag("ALLOW_GIT_PUSH", true),
  },
}));

const transactionProvider = new StaticProvider("transaction", "Transaction", async () => ({
  id: "transaction",
  label: "Transaction",
  enabled: envFlag("ALLOW_ROLLBACK", false),
  available: true,
  capabilities: ["transaction"],
  executionTargets: ["host"],
  details: {
    rollback: envFlag("ALLOW_ROLLBACK", false),
  },
}));

const publishMockStatusProvider = new StaticProvider("publish-mock", "Publish Mock (test only)", async () => {
  const capability=publishMockCapability();
  return { id:"publish-mock",label:"Publish Mock (test only)",
    enabled:capability.enabled, available:capability.available,
    capabilities:["publish-mock"],executionTargets:["host"],
    details:{livePublishingEnabled:false,transport:"none",actions:capability.actions} };
});
const officialPilotProvider=new StaticProvider("publish-official-test","Publish Official Protocol (test only)",
 async()=>{const cap=officialPilotCapability();return {
 id:"publish-official-test",label:"Publish Official Protocol (test only)",
 enabled:cap.enabled,available:true,capabilities:["publish-official-test"],
 executionTargets:["host"],details:{liveTransport:false,productionEnabled:false,oauthConnected:false}
 };});
const providers: ComputerProvider[] = [
  filesystemProvider,
  shellProvider,
  gitProvider,
  transactionProvider,
  browserProvider,
  desktopProvider,
  publishMockStatusProvider,
  officialPilotProvider,
];

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  return await Promise.all(providers.map((provider) => provider.status()));
}
