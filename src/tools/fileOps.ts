import fs from "node:fs/promises";
import path from "node:path";
import {
  assertAllowedExistingPath,
  assertAllowedTargetPath,
} from "../security/pathGuard.js";
import { requireCapability } from "../security/capabilities.js";

const DEFAULT_MAX_RESULTS = 200;

export async function getFileInfo(inputPath: string) {
  const safePath = await assertAllowedExistingPath(inputPath);
  const stat = await fs.stat(safePath);
  return {
    path: safePath,
    type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
    mode: (stat.mode & 0o777).toString(8),
  };
}

export async function searchFiles(
  rootPath: string,
  query: string,
  maxResults = DEFAULT_MAX_RESULTS,
) {
  const root = await assertAllowedExistingPath(rootPath);
  const needle = query.toLowerCase();
  const results: Array<{ path: string; type: "file" | "directory" }> = [];

  async function walk(dir: string) {
    if (results.length >= maxResults) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(root, fullPath);

      if (relative.toLowerCase().includes(needle)) {
        results.push({
          path: fullPath,
          type: entry.isDirectory() ? "directory" : "file",
        });
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(root);
  return results;
}

export async function createDirectory(inputPath: string, recursive = true) {
  requireCapability("ALLOW_WRITE", true);
  const safePath = await assertAllowedTargetPath(inputPath);
  await fs.mkdir(safePath, { recursive });
  return { path: safePath, created: true };
}

export async function writeFile(
  inputPath: string,
  content: string,
  overwrite = true,
  createParents = true,
) {
  requireCapability("ALLOW_WRITE", true);
  const safePath = await assertAllowedTargetPath(inputPath);

  if (createParents) {
    await fs.mkdir(path.dirname(safePath), { recursive: true });
  }

  if (!overwrite) {
    try {
      await fs.access(safePath);
      throw new Error("File already exists and overwrite=false.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("overwrite=false")) throw error;
    }
  }

  await fs.writeFile(safePath, content, { encoding: "utf8" });
  return { path: safePath, bytes: Buffer.byteLength(content, "utf8") };
}

export async function appendFile(inputPath: string, content: string) {
  requireCapability("ALLOW_WRITE", true);
  const safePath = await assertAllowedTargetPath(inputPath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.appendFile(safePath, content, { encoding: "utf8" });
  return { path: safePath, bytesAppended: Buffer.byteLength(content, "utf8") };
}

export async function editFile(
  inputPath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
) {
  requireCapability("ALLOW_WRITE", true);
  const safePath = await assertAllowedExistingPath(inputPath);
  const original = await fs.readFile(safePath, "utf8");

  if (!original.includes(oldText)) {
    throw new Error("old_text was not found; no changes were made.");
  }

  let updated: string;
  let replacements: number;

  if (replaceAll) {
    replacements = original.split(oldText).length - 1;
    updated = original.split(oldText).join(newText);
  } else {
    replacements = 1;
    updated = original.replace(oldText, newText);
  }

  await fs.writeFile(safePath, updated, "utf8");
  return { path: safePath, replacements };
}

export async function movePath(sourcePath: string, destinationPath: string) {
  requireCapability("ALLOW_WRITE", true);
  const source = await assertAllowedExistingPath(sourcePath);
  const destination = await assertAllowedTargetPath(destinationPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
  return { source, destination };
}

export async function copyPath(sourcePath: string, destinationPath: string, recursive = true) {
  requireCapability("ALLOW_WRITE", true);
  const source = await assertAllowedExistingPath(sourcePath);
  const destination = await assertAllowedTargetPath(destinationPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive, force: true });
  return { source, destination };
}

export async function deletePath(inputPath: string, recursive = false) {
  requireCapability("ALLOW_DELETE", false);
  const safePath = await assertAllowedExistingPath(inputPath);
  await fs.rm(safePath, { recursive, force: false });
  return { path: safePath, deleted: true };
}
