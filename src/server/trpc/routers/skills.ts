import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { hubSkillInstalls } from "@/db/schema";
import { openClawCliAdapter } from "@/lib/openclaw/cli-adapter";
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
      // NOTE: Clawhub does not currently expose a documented API in this repo.
      // We intentionally do not scrape HTML. This endpoint is a stub until we have
      // an official API route/SDK to query.
      const baseUrl = process.env.CLAWHUB_API_BASE_URL;
      if (!baseUrl) {
        return {
          results: [] as ClawhubSkillResult[],
          warning: "Clawhub search API not configured (set CLAWHUB_API_BASE_URL)."
        };
      }

      // Expected API shape: GET /skills/search?q=...&limit=...
      const url = new URL("/skills/search", baseUrl);
      url.searchParams.set("q", input.query);
      url.searchParams.set("limit", String(input.limit));

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" }
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Clawhub search failed: ${res.status} ${text.slice(0, 180)}`);
      }

      const json = (await res.json()) as any;
      const results = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];

      return {
        results: results.map((r: any) => ({
          id: String(r.id ?? r.slug ?? r.skillId ?? ""),
          name: String(r.name ?? r.title ?? r.id ?? ""),
          description: typeof r.description === "string" ? r.description : undefined,
          author: typeof r.author === "string" ? r.author : undefined,
          version: typeof r.version === "string" ? r.version : undefined,
          installSpec: typeof r.installSpec === "string" ? r.installSpec : undefined,
          requirements: typeof r.requirements === "string" ? r.requirements : undefined
        }))
      };
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
        installSpec: z.string().min(1).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Persist intent first (so UI can show "installing" immediately)
      const [created] = await ctx.db
        .insert(hubSkillInstalls)
        .values({
          workspaceId: ctx.workspace.id,
          source: "clawhub",
          clawhubSkillId: input.clawhubSkillId,
          name: input.name,
          author: input.author,
          version: input.version,
          installSpec: input.installSpec,
          status: "installing",
          createdByUserId: ctx.user?.id,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [hubSkillInstalls.workspaceId, hubSkillInstalls.source, hubSkillInstalls.clawhubSkillId, hubSkillInstalls.version],
          set: {
            name: input.name,
            author: input.author,
            installSpec: input.installSpec,
            status: "installing",
            error: null,
            updatedAt: new Date()
          }
        })
        .returning();

      // Install mechanism: use OpenClaw plugin installer (path/archive/npm spec)
      // This is gated behind env so we don't accidentally install code without explicit ops approval.
      if ((process.env.HUB_SKILL_INSTALL_ENABLED ?? "false").toLowerCase() !== "true") {
        await ctx.db
          .update(hubSkillInstalls)
          .set({
            status: "failed",
            error: "Install disabled (set HUB_SKILL_INSTALL_ENABLED=true)",
            updatedAt: new Date()
          })
          .where(and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, created.id)));

        return { ok: false, installId: created.id, status: "failed" as const };
      }

      if (!input.installSpec) {
        await ctx.db
          .update(hubSkillInstalls)
          .set({ status: "failed", error: "Missing installSpec for skill", updatedAt: new Date() })
          .where(and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, created.id)));
        return { ok: false, installId: created.id, status: "failed" as const };
      }

      try {
        const cmd = [
          "openclaw plugins install",
          input.installSpec,
          "--json"
        ].join(" ");

        const out = await openClawCliAdapter.runCommand(cmd, { timeoutMs: 5 * 60_000 });

        await ctx.db
          .update(hubSkillInstalls)
          .set({
            status: "installed",
            error: null,
            logs: out.slice(0, 50_000),
            installedAt: new Date(),
            updatedAt: new Date()
          })
          .where(and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, created.id)));

        return { ok: true, installId: created.id, status: "installed" as const };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.db
          .update(hubSkillInstalls)
          .set({
            status: "failed",
            error: msg.slice(0, 4000),
            updatedAt: new Date()
          })
          .where(and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, created.id)));

        return { ok: false, installId: created.id, status: "failed" as const };
      }
    })
});
