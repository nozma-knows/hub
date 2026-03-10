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
              description: typeof d?.skill?.summary === "string" ? d.skill.summary : r.description
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
