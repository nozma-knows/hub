import os from "node:os";
import fs from "node:fs/promises";

export type HubHostInfo = {
  hostname: string;
  platform: string;
  arch: string;
  kernel?: string;
  cpus: number;
  loadAvg: [number, number, number];
  uptimeSec: number;
  memory: {
    total: number;
    free: number;
    used: number;
  };
  swap?: {
    total: number;
    free: number;
    used: number;
  };
  diskRoot?: {
    total: number;
    free: number;
    used: number;
  };
};

function parseMeminfo(meminfo: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of meminfo.split("\n")) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB/i);
    if (!match) continue;
    out[match[1]] = Number(match[2]) * 1024;
  }
  return out;
}

async function readSwapFromProc(): Promise<HubHostInfo["swap"] | undefined> {
  try {
    const meminfo = await fs.readFile("/proc/meminfo", "utf8");
    const m = parseMeminfo(meminfo);
    if (!m.SwapTotal) return undefined;
    const total = m.SwapTotal ?? 0;
    const free = m.SwapFree ?? 0;
    return { total, free, used: Math.max(0, total - free) };
  } catch {
    return undefined;
  }
}

async function readKernel(): Promise<string | undefined> {
  try {
    return await fs.readFile("/proc/sys/kernel/osrelease", "utf8").then((s) => s.trim());
  } catch {
    return undefined;
  }
}

async function readDiskRoot(): Promise<HubHostInfo["diskRoot"] | undefined> {
  // Use statvfs via `df`? Node doesn't expose statvfs, so read from /proc/mounts + fallback to df.
  // Keep it simple + low overhead: parse `df -B1 /` once.
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("df", ["-B1", "/"], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return undefined;
    const cols = lines[1].trim().split(/\s+/);
    // Filesystem 1B-blocks Used Available Use% Mounted
    if (cols.length < 6) return undefined;
    const total = Number(cols[1]);
    const used = Number(cols[2]);
    const free = Number(cols[3]);
    if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(free)) return undefined;
    return { total, used, free };
  } catch {
    return undefined;
  }
}

export async function getHostInfo(): Promise<HubHostInfo> {
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus()?.length ?? 0;
  const [l1, l5, l15] = os.loadavg() as [number, number, number];
  const uptimeSec = os.uptime();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);

  const [kernel, swap, diskRoot] = await Promise.all([readKernel(), readSwapFromProc(), readDiskRoot()]);

  return {
    hostname,
    platform,
    arch,
    kernel,
    cpus,
    loadAvg: [l1, l5, l15],
    uptimeSec,
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
    },
    swap,
    diskRoot,
  };
}
