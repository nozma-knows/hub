import fs from "node:fs/promises";
import path from "node:path";

import { resolveSafeFile, resolveSafeRoot } from "@/lib/openclaw/fs-allowlist";

type FileEntry = {
  path: string; // relative path under root
  size: number;
  mtimeMs: number;
};

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

async function walk(root: string, relDir: string, depth: number): Promise<FileEntry[]> {
  if (depth < 0) return [];

  const absDir = await resolveSafeFile(root, relDir || ".");
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  const out: FileEntry[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (ent.name === "node_modules") continue;
    if (ent.name === ".git") continue;

    const rel = relDir ? path.join(relDir, ent.name) : ent.name;
    const abs = path.join(absDir, ent.name);

    if (ent.isDirectory()) {
      // Keep recursion shallow to avoid heavy IO
      if (ent.name === "memory" || ent.name === "agent" || ent.name === "src") {
        out.push(...(await walk(root, rel, depth - 1)));
      }
      continue;
    }

    if (!ent.isFile()) continue;

    const ext = path.extname(ent.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    const stat = await fs.stat(abs);
    out.push({ path: rel.replace(/\\/g, "/"), size: stat.size, mtimeMs: stat.mtimeMs });
  }

  return out;
}

export async function listAgentWorkspaceFiles(input: { workspacePath: string }): Promise<FileEntry[]> {
  const root = await resolveSafeRoot(input.workspacePath);
  const files = await walk(root, "", 2);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function readAgentWorkspaceFile(input: { workspacePath: string; relativePath: string }): Promise<string> {
  const root = await resolveSafeRoot(input.workspacePath);
  const abs = await resolveSafeFile(root, input.relativePath);
  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("File type not allowed");
  const buf = await fs.readFile(abs);
  return buf.toString("utf8");
}

export async function writeAgentWorkspaceFile(input: {
  workspacePath: string;
  relativePath: string;
  content: string;
}): Promise<{ ok: true }> {
  const root = await resolveSafeRoot(input.workspacePath);
  const abs = await resolveSafeFile(root, input.relativePath);
  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("File type not allowed");
  await fs.writeFile(abs, input.content, "utf8");
  return { ok: true };
}
