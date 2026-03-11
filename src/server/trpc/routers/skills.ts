import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { hubAgentSkillPermissions, hubSkillInstalls } from "@/db/schema";
// (installer runs in background worker)
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const timeRangeSchema = z.enum(["1h", "6h", "24h", "7d"]);

export type ClawhubSkillResult = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  installSpec?: string;
  requirements?: string;
  stats?: {
    stars?: number;
    downloads?: number;
    installsAllTime?: number;
    installsCurrent?: number;
  };
  highlighted?: boolean;
  suspicious?: boolean;
};

export const skillsRouter = createTrpcRouter({
  listInstalledSkills: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.execute(sql`
      select distinct on (clawhub_skill_id)
        id,
        clawhub_skill_id,
        name,
        author,
        version,
        install_spec,
        status,
        updated_at
      from hub_skill_installs
      where workspace_id = ${ctx.workspace.id} and status = 'installed'
      order by clawhub_skill_id, updated_at desc
    `);

    return (rows.rows as any[]).map((r) => ({
      id: String(r.id),
      clawhubSkillId: String(r.clawhub_skill_id),
      name: r.name ? String(r.name) : String(r.clawhub_skill_id),
      author: r.author ? String(r.author) : null,
      version: r.version ? String(r.version) : null,
      installSpec: r.install_spec ? String(r.install_spec) : null,
      updatedAt: r.updated_at
    }));
  }),

  agentSkillAccessList: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.hubAgentSkillPermissions.findMany({
        where: and(
          eq(hubAgentSkillPermissions.workspaceId, ctx.workspace.id),
          eq(hubAgentSkillPermissions.agentId, input.agentId)
        )
      });
      return rows;
    }),

  agentSkillAccessSet: adminProcedure
    .input(z.object({ agentId: z.string().min(1), clawhubSkillId: z.string().min(1), isAllowed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(hubAgentSkillPermissions)
        .values({
          workspaceId: ctx.workspace.id,
          agentId: input.agentId,
          clawhubSkillId: input.clawhubSkillId,
          isAllowed: input.isAllowed,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [hubAgentSkillPermissions.workspaceId, hubAgentSkillPermissions.agentId, hubAgentSkillPermissions.clawhubSkillId],
          set: { isAllowed: input.isAllowed, updatedAt: new Date() }
        });

      return { ok: true };
    }),

  inspectClawhub: protectedProcedure
    .input(z.object({ slug: z.string().min(1), version: z.string().optional() }))
    .query(async ({ input }) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const args = [
        "--bun",
        "clawhub@latest",
        "inspect",
        input.slug,
        "--json",
        "--files",
        "--file",
        "SKILL.md",
        "--no-input"
      ];
      if (input.version?.trim()) {
        args.splice(4, 0, "--version", input.version.trim());
      }

      let stdout = "";
      try {
        const res: any = await execFileAsync("bunx", args, {
          timeout: 60_000,
          maxBuffer: 3 * 1024 * 1024
        });
        stdout = String(res?.stdout ?? "");
      } catch (err: any) {
        const out = String(err?.stdout ?? "");
        const eout = String(err?.stderr ?? "");
        throw new Error(`Clawhub inspect failed: ${String(err?.message ?? err)}\n${(out + "\n" + eout).trim()}`);
      }

      // Strip bunx noise lines before JSON
      const jsonStart = stdout.indexOf("{");
      if (jsonStart < 0) throw new Error("Clawhub inspect returned no JSON");
      const raw = stdout.slice(jsonStart);
      const data = JSON.parse(raw) as any;

      const files: Array<{ path: string; size: number; sha256?: string; contentType?: string }> =
        Array.isArray(data?.version?.files) ? data.version.files : [];

      return {
        slug: String(data?.skill?.slug ?? input.slug),
        name: String(data?.skill?.displayName ?? input.slug),
        summary: typeof data?.skill?.summary === "string" ? data.skill.summary : null,
        owner: typeof data?.owner?.handle === "string" ? data.owner.handle : null,
        version: typeof data?.version?.version === "string" ? data.version.version : null,
        security: data?.version?.security ?? null,
        files,
        skillMd: typeof data?.file?.content === "string" ? data.file.content : null,
        sourceUrl: data?.owner?.handle ? `https://clawhub.ai/${data.owner.handle}/${input.slug}` : `https://clawhub.ai/${input.slug}`,
        installCmd: `bunx clawhub@latest install ${input.slug} --workdir /root/.openclaw --dir skills --no-input`
      };
    }),
  searchClawhub: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().min(1).max(25).optional().default(10)
      })
    )
    .query(async ({ input }) => {
      // Use the public ClawHub registry API for fast search.
      const apiBase = "https://wry-manatee-359.convex.site";
      const q = input.query.trim();
      if (!q) return { results: [] as ClawhubSkillResult[] };

      const url = new URL("/api/v1/search", apiBase);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(input.limit));

      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Clawhub search failed: ${res.status} ${text.slice(0, 200)}`);
      }

      const json = (await res.json()) as any;
      const rows = Array.isArray(json?.results) ? json.results : [];

      const baseResults: ClawhubSkillResult[] = rows
        .map((r: any) => ({
          id: String(r?.slug ?? "").trim(),
          name: String(r?.displayName ?? r?.slug ?? "").trim(),
          description: typeof r?.summary === "string" ? r.summary : undefined,
          version: typeof r?.version === "string" ? r.version : undefined,
          installSpec: r?.slug ? `clawhub:${String(r.slug)}` : undefined
        }))
        .filter((r: any) => r.id);

      // Enrich with detail metadata (owner handle, latest version)
      const enriched = await Promise.all(
        baseResults.map(async (r) => {
          try {
            const dUrl = new URL(`/api/v1/skills/${encodeURIComponent(r.id)}`, apiBase);
            const dRes = await fetch(dUrl.toString(), { headers: { Accept: "application/json" } });
            if (!dRes.ok) return r;
            const d = (await dRes.json()) as any;
            return {
              ...r,
              author: typeof d?.owner?.handle === "string" ? d.owner.handle : r.author,
              version: typeof d?.latestVersion?.version === "string" ? d.latestVersion.version : r.version,
              description: typeof d?.skill?.summary === "string" ? d.skill.summary : r.description,
              stats: d?.skill?.stats
                ? {
                    stars: Number.isFinite(d.skill.stats.stars) ? Number(d.skill.stats.stars) : undefined,
                    downloads: Number.isFinite(d.skill.stats.downloads) ? Number(d.skill.stats.downloads) : undefined,
                    installsAllTime: Number.isFinite(d.skill.stats.installsAllTime) ? Number(d.skill.stats.installsAllTime) : undefined,
                    installsCurrent: Number.isFinite(d.skill.stats.installsCurrent) ? Number(d.skill.stats.installsCurrent) : undefined
                  }
                : undefined,
              highlighted: Boolean(d?.skill?.badges?.highlighted),
              suspicious: Boolean(d?.moderation?.isSuspicious)
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
    }),

  retryInstall: adminProcedure
    .input(z.object({ installId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.hubSkillInstalls.findFirst({
        where: and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, input.installId))
      });
      if (!row) throw new Error("Install not found");

      await ctx.db
        .update(hubSkillInstalls)
        .set({
          status: "queued",
          statusDetail: "Queued",
          progress: 0,
          error: null,
          lockId: null,
          lockExpiresAt: null,
          updatedAt: new Date()
        })
        .where(and(eq(hubSkillInstalls.workspaceId, ctx.workspace.id), eq(hubSkillInstalls.id, input.installId)));

      return { ok: true };
    })
});
