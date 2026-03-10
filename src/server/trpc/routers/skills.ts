import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hubSkillInstalls } from "@/db/schema";
// (installer runs in background worker)
import { createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const timeRangeSchema = z.enum(["1h", "6h", "24h", "7d"]);

export type ClawhubSkillResult = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  installSpec?: string;
  requirements?: string;
};

export const skillsRouter = createTrpcRouter({
  searchClawhub: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().min(1).max(25).optional().default(10)
      })
    )
    .query(async ({ input }) => {
      // Use the official ClawHub CLI for vector search.
      // This avoids scraping and keeps behavior aligned with OpenClaw tooling.
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const q = input.query.trim();
      if (!q) return { results: [] as ClawhubSkillResult[] };

      const cmd = "bunx";
      const args = ["--bun", "clawhub@latest", "search", q, "--limit", String(input.limit), "--no-input"];

      let stdout = "";
      try {
        const res: any = await execFileAsync(cmd, args, {
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024
        });
        stdout = String(res?.stdout ?? "");
      } catch (err: any) {
        const out = String(err?.stdout ?? "");
        const eout = String(err?.stderr ?? "");
        throw new Error(`Clawhub search failed: ${String(err?.message ?? err)}\n${(out + "\n" + eout).trim()}`);
      }

      // Output format:
      // slug  Name  (score)
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !l.startsWith("Resolving dependencies") && !l.startsWith("Resolved") && !l.startsWith("Saved lockfile"))
        .filter((l) => !l.startsWith("- Searching"));

      const results: ClawhubSkillResult[] = [];
      for (const line of lines) {
        const m = line.match(/^([^\s]+)\s+(.+?)\s+\(([-0-9.]+)\)\s*$/);
        if (!m) continue;
        const slug = m[1];
        const name = m[2];
        results.push({
          id: slug,
          name,
          installSpec: `clawhub:${slug}`
        });
      }

      // Enrich with public metadata (summary, owner, latest version)
      const enriched = await Promise.all(
        results.map(async (r) => {
          try {
            const apiBase = "https://wry-manatee-359.convex.site";
            const url = new URL(`/api/v1/skills/${encodeURIComponent(r.id)}`, apiBase);
            const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
            if (!res.ok) return r;
            const json = (await res.json()) as any;
            return {
              ...r,
              description: typeof json?.skill?.summary === "string" ? json.skill.summary : r.description,
              author: typeof json?.owner?.handle === "string" ? json.owner.handle : r.author,
              version: typeof json?.latestVersion?.version === "string" ? json.latestVersion.version : r.version
            } as ClawhubSkillResult;
          } catch {
            return r;
          }
        })
      );

      return { results: enriched };
    }),

  listInstalls: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(50) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.hubSkillInstalls.findMany({
        where: eq(hubSkillInstalls.workspaceId, ctx.workspace.id),
        orderBy: (t, { desc: descOrder }) => [descOrder(t.updatedAt)],
        limit: input.limit
      });
    }),

  getInstall: protectedProcedure
    .input(z.object({ installId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.hubSkillInstalls.findFirst({
        where: and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, input.installId))
      });
      if (!row) throw new Error("Install not found");
      return row;
    }),

  installFromClawhub: protectedProcedure
    .input(
      z.object({
        clawhubSkillId: z.string().min(1),
        name: z.string().min(1).optional(),
        author: z.string().optional(),
        version: z.string().optional(),
        installSpec: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.installSpec) {
        throw new Error("Missing installSpec for skill");
      }

      const versionKey = input.version?.trim() ?? "";

      // Persist intent first (so UI can show it immediately).
      // Actual installation happens asynchronously in the background worker.
      const [created] = await ctx.db
        .insert(hubSkillInstalls)
        .values({
          workspaceId: ctx.workspace.id,
          source: "clawhub",
          clawhubSkillId: input.clawhubSkillId,
          name: input.name,
          author: input.author,
          version: input.version,
          versionKey,
          installSpec: input.installSpec,
          status: "queued",
          statusDetail: "Queued",
          progress: 0,
          error: null,
          logs: null,
          lockId: null,
          lockExpiresAt: null,
          attempts: 0,
          createdByUserId: ctx.user?.id,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [hubSkillInstalls.workspaceId, hubSkillInstalls.source, hubSkillInstalls.clawhubSkillId, hubSkillInstalls.versionKey],
          set: {
            name: input.name,
            author: input.author,
            version: input.version,
            installSpec: input.installSpec,
            status: "queued",
            statusDetail: "Queued",
            progress: 0,
            error: null,
            logs: null,
            lockId: null,
            lockExpiresAt: null,
            attempts: 0,
            updatedAt: new Date()
          }
        })
        .returning();

      return { ok: true, installId: created.id, status: created.status as any };
    })
});
