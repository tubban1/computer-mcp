import { scopedCapabilityAllows } from "./scopedCapabilities.js";
export function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function requireCapability(name: string, defaultValue = false): void {
  if (!envFlag(name, defaultValue) && !scopedCapabilityAllows(name)) {
    throw new Error(
      `${name} is disabled by OWL Runtime policy. Set ${name}=true in the active OWL Runtime environment configuration and restart that OWL Runtime process to apply it.`,
    );
  }
}
