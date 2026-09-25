import path from "node:path";
import fs from "node:fs/promises";

function configuredRoots(): string[] {
  return (process.env.ALLOWED_DIRECTORIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
}

export async function assertAllowedPath(inputPath: string): Promise<string> {
  const roots = configuredRoots();
  if (roots.length === 0) {
    throw new Error("No ALLOWED_DIRECTORIES configured. Refusing filesystem access.");
  }

  const requested = path.resolve(inputPath);
  let realRequested: string;
  try {
    realRequested = await fs.realpath(requested);
  } catch {
    throw new Error("Path does not exist.");
  }

  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      continue;
    }
    const relative = path.relative(realRoot, realRequested);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return realRequested;
    }
  }

  throw new Error("Access denied: path is outside ALLOWED_DIRECTORIES.");
}
