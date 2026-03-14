"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type Point = { x: number; y: number; meta?: any };

function toPath(points: Point[], w: number, h: number, pad: number) {
  if (points.length === 0) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const sx = (x: number) => {
    if (maxX === minX) return pad;
    return pad + ((x - minX) / (maxX - minX)) * (w - pad * 2);
  };
  const sy = (y: number) => {
    if (maxY === minY) return h - pad;
    // invert
    return h - pad - ((y - minY) / (maxY - minY)) * (h - pad * 2);
  };

  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const x = sx(p.x);
    const y = sy(p.y);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

export function LineChart(props: {
  title: string;
  points: Array<{ x: number; y: number; label?: string }>;
  valueLabel?: (y: number) => string;
  className?: string;
}) {
  const w = 560;
  const h = 140;
  const pad = 12;

  const pts = useMemo(() => props.points.map((p) => ({ x: p.x, y: p.y, meta: p })), [props.points]);
  const path = useMemo(() => toPath(pts, w, h, pad), [pts]);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const hover = hoverIdx != null ? pts[hoverIdx] : null;

  return (
    <div className={cn("rounded-lg border bg-card p-4", props.className)}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{props.title}</div>
        {hover ? (
          <div className="text-xs text-muted-foreground">
            {hover.meta?.label ? `${hover.meta.label} · ` : ""}
            {props.valueLabel ? props.valueLabel(hover.y) : hover.y}
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        {pts.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No data yet.
          </div>
        ) : (
          <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" onMouseLeave={() => setHoverIdx(null)}>
            <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" />
            {pts.map((p, idx) => {
              const xs = pts.map((pp) => pp.x);
              const ys = pts.map((pp) => pp.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const sx = (x: number) =>
                maxX === minX ? pad : pad + ((x - minX) / (maxX - minX)) * (w - pad * 2);
              const sy = (y: number) =>
                maxY === minY ? h - pad : h - pad - ((y - minY) / (maxY - minY)) * (h - pad * 2);
              const cx = sx(p.x);
              const cy = sy(p.y);
              return (
                <circle
                  key={idx}
                  cx={cx}
                  cy={cy}
                  r={hoverIdx === idx ? 4 : 2.5}
                  className={cn(hoverIdx === idx ? "fill-primary" : "fill-primary/60")}
                  onMouseMove={() => setHoverIdx(idx)}
                />
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
