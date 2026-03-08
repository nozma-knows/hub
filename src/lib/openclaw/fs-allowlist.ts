import path from "node:path";
import fs from "node:fs/promises";

export function expandHome(p: string): string {
  if (p.startsWith("~\/")) {
    return path.join(process.env.HOME || "/root", p.slice(2));
  }
  if (p === "~") return process.env.HOME || "/root";
  return p;
}

export function isSubpath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== "..");
}

export async function resolveSafeRoot(inputRoot: string): Promise<string> {
  const expanded = expandHome(inputRoot);
  const real = await fs.realpath(expanded);

  // Hard safety boundary: we only allow editing inside ~/.openclaw
  const openclawRoot = await fs.realpath(path.join(process.env.HOME || "/root", ".openclaw"));
  if (!isSubpath(openclawRoot, real)) {
    throw new Error(`Path root is outside allowed boundary: ${inputRoot}`);
  }

  return real;
}

export async function resolveSafeFile(root: string, relativePath: string): Promise<string> {
  if (relativePath.includes("\0")) throw new Error("Invalid path");

  const rel = relativePath.replace(/^\/+/, "");
  const joined = path.join(root, rel);

  const realRoot = await fs.realpath(root);
  // Note: the file might not exist yet (for writes), so resolve parent.
  const parent = path.dirname(joined);
  const realParent = await fs.realpath(parent);

  if (!isSubpath(realRoot, realParent)) {
    throw new Error("Path escapes allowed root");
  }

  return joined;
}
