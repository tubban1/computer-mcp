import { scopedCapabilityAllows } from "./scopedCapabilities.js";
export function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function requireCapability(name: string, defaultValue = false): void {
  // A shell can delete via rm, Node, Python, subprocesses or indirection.
  // A Delete=Ask policy must not be bypassed through Shell=On.
  if(name==="ALLOW_SHELL" && process.env.OWL_APPROVAL_MODE==="enforce"){
    const actions=new Set((process.env.OWL_APPROVAL_ACTIONS||
      "fs.delete,tx.rollback")
      .split(",").map(action=>action.trim()).filter(Boolean));
    if(actions.has("fs.delete") &&
      !["shell.exec","shell.start","shell.input","shell.kill"]
        .every(action=>actions.has(action)))
      throw new Error("OWL_SHELL_DELETE_REVIEW_CONFLICT: Shell must also be Ask or Off while Delete is Ask.");
  }
  if (!envFlag(name, defaultValue) && !scopedCapabilityAllows(name)) {
    throw new Error(
      `${name} is disabled by OWL Runtime policy. Set ${name}=true in the active OWL Runtime environment configuration and restart that OWL Runtime process to apply it.`,
    );
  }
}
