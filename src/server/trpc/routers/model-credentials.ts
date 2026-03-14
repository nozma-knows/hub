import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { modelProviderCredentials } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { encryptString } from "@/lib/crypto";
import { env } from "@/lib/env";
import {
  getAvailableModels,
  supportedModelProviders,
  type SupportedModelProvider,
} from "@/lib/model-catalog";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

const providerSchema = z.enum(["openai", "anthropic"]);

export const modelCredentialsRouter = createTrpcRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.modelProviderCredentials.findMany({
      where: eq(modelProviderCredentials.workspaceId, ctx.workspace.id),
      orderBy: (table, { asc }) => [asc(table.providerKey), asc(table.label)],
    });

    return rows.map((row) => ({
      id: row.id,
      providerKey: row.providerKey,
      label: row.label,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }),

  upsert: adminProcedure
    .input(
      z.object({
        providerKey: providerSchema,
        apiKey: z.string().min(10),
        label: z.string().min(1).default("default"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const encryptedApiKey = encryptString(input.apiKey);

      await ctx.db
        .insert(modelProviderCredentials)
        .values({
          workspaceId: ctx.workspace.id,
          providerKey: input.providerKey,
          encryptedApiKey,
          label: input.label,
          createdBy: ctx.user!.id,
          updatedBy: ctx.user!.id,
        })
        .onConflictDoUpdate({
          target: [
            modelProviderCredentials.workspaceId,
            modelProviderCredentials.providerKey,
            modelProviderCredentials.label,
          ],
          set: {
            encryptedApiKey,
            updatedBy: ctx.user!.id,
            updatedAt: new Date(),
          },
        });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "model_credentials.upsert",
        actorUserId: ctx.user!.id,
        result: "success",
        details: {
          providerKey: input.providerKey,
          label: input.label,
        },
      });

      return { success: true };
    }),

  remove: adminProcedure
    .input(
      z.object({
        providerKey: providerSchema,
        label: z.string().min(1).default("default"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(modelProviderCredentials)
        .where(
          and(
            eq(modelProviderCredentials.workspaceId, ctx.workspace.id),
            eq(modelProviderCredentials.providerKey, input.providerKey),
            eq(modelProviderCredentials.label, input.label)
          )
        );

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "model_credentials.remove",
        actorUserId: ctx.user!.id,
        result: "success",
        details: {
          providerKey: input.providerKey,
          label: input.label,
        },
      });

      return { success: true };
    }),

  seedFromEnv: adminProcedure.mutation(async ({ ctx }) => {
    const seeds: Array<{ providerKey: SupportedModelProvider; apiKey: string | undefined }> = [
      { providerKey: "openai", apiKey: env.OPENAI_API_KEY },
      { providerKey: "anthropic", apiKey: env.ANTHROPIC_API_KEY },
    ];

    const seeded: string[] = [];
    for (const seed of seeds) {
      if (!seed.apiKey) {
        continue;
      }

      const encryptedApiKey = encryptString(seed.apiKey);
      await ctx.db
        .insert(modelProviderCredentials)
        .values({
          workspaceId: ctx.workspace.id,
          providerKey: seed.providerKey,
          encryptedApiKey,
          label: "default",
          createdBy: ctx.user!.id,
          updatedBy: ctx.user!.id,
        })
        .onConflictDoUpdate({
          target: [
            modelProviderCredentials.workspaceId,
            modelProviderCredentials.providerKey,
            modelProviderCredentials.label,
          ],
          set: {
            encryptedApiKey,
            updatedBy: ctx.user!.id,
            updatedAt: new Date(),
          },
        });
      seeded.push(seed.providerKey);
    }

    await logAuditEvent({
      workspaceId: ctx.workspace.id,
      eventType: "model_credentials.seed_env",
      actorUserId: ctx.user!.id,
      result: "success",
      details: {
        seeded,
      },
    });

    return { seeded };
  }),

  providers: protectedProcedure.query(() => supportedModelProviders()),

  listAvailableModels: protectedProcedure
    .input(
      z.object({
        providerKey: providerSchema,
        forceRefresh: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const models = await getAvailableModels({
        workspaceId: ctx.workspace.id,
        provider: input.providerKey,
        forceRefresh: input.forceRefresh,
      });
      return models;
    }),
});
