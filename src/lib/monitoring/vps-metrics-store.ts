import os from "node:os";
import fs from "node:fs/promises";

import type { HubHostInfo } from "@/lib/system-info";
import { getHostInfo } from "@/lib/system-info";

export type VpsMetricPoint = {
  ts: string; // ISO
  cpuUsage: number; // 0..1
  load1: number;
  memUsed: number;
  memTotal: number;
  diskUsed?: number;
  diskTotal?: number;
  netRxBytes?: number;
  netTxBytes?: number;
};

function sumCpuTimes(cpus: os.CpuInfo[]) {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

async function readNetDevTotals(): Promise<{ rxBytes: number; txBytes: number } | null> {
  try {
    const raw = await fs.readFile("/proc/net/dev", "utf8");
    const lines = raw.split("\n").slice(2);
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [ifacePart, rest] = trimmed.split(":");
      if (!rest) continue;
      const iface = ifacePart.trim();
      // Ignore loopback
      if (iface === "lo") continue;
      const cols = rest.trim().split(/\s+/);
      // rx bytes is col[0], tx bytes is col[8]
      const rxBytes = Number(cols[0]);
      const txBytes = Number(cols[8]);
      if (Number.isFinite(rxBytes)) rx += rxBytes;
      if (Number.isFinite(txBytes)) tx += txBytes;
    }
    return { rxBytes: rx, txBytes: tx };
  } catch {
    return null;
  }
}

export class VpsMetricsStore {
  private interval: NodeJS.Timeout | null = null;
  private points: VpsMetricPoint[] = [];

  private lastCpu: { idle: number; total: number } | null = null;
  private lastNet: { rxBytes: number; txBytes: number } | null = null;

  start(intervalMs: number) {
    const safe = Math.max(10_000, intervalMs);
    if (this.interval) return;

    const tick = async () => {
      const cpus = os.cpus();
      const cpuTimes = sumCpuTimes(cpus);
      const cpuUsage = this.lastCpu
        ? Math.max(0, Math.min(1, 1 - (cpuTimes.idle - this.lastCpu.idle) / (cpuTimes.total - this.lastCpu.total || 1)))
        : 0;
      this.lastCpu = cpuTimes;

      const host: HubHostInfo = await getHostInfo();
      const net = await readNetDevTotals();
      if (net) this.lastNet = net;

      const p: VpsMetricPoint = {
        ts: new Date().toISOString(),
        cpuUsage,
        load1: host.loadAvg[0] ?? 0,
        memUsed: host.memory.used,
        memTotal: host.memory.total,
        diskUsed: host.diskRoot?.used,
        diskTotal: host.diskRoot?.total,
        netRxBytes: net?.rxBytes,
        netTxBytes: net?.txBytes
      };

      this.points.push(p);

      // Keep bounded history. Default: 7 days @ 60s => 10080 points.
      const maxPoints = Number(process.env.HUB_VPS_METRICS_MAX_POINTS ?? 12_000);
      if (this.points.length > maxPoints) {
        this.points.splice(0, this.points.length - maxPoints);
      }
    };

    this.interval = setInterval(() => void tick(), safe);
    void tick();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  getPoints(): VpsMetricPoint[] {
    return this.points;
  }
}

export const vpsMetricsStore = new VpsMetricsStore();
