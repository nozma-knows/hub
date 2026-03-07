import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { agentInvocations, agentToolPermissions, toolConnections, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { decryptString, encryptString } from "@/lib/crypto";
import { openClawAdapter } from "@/lib/openclaw/adapter";
import { getProviderByKey } from "@/lib/providers/registry";
import type { ProviderBinding, ProviderKey } from "@/lib/providers/types";
import { createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const actionsRouter = createTrpcRouter({
  invoke: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        prompt: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const correlationId = randomUUID();
      const startedAt = Date.now();

      const allowedRows = await ctx.db
        .select({
          providerId: agentToolPermissions.providerId,
          scopeOverrides: agentToolPermissions.scopeOverrides,
          providerKey: toolProviders.key
        })
        .from(agentToolPermissions)
        .innerJoin(toolProviders, eq(toolProviders.id, agentToolPermissions.providerId))
        .where(
          and(
            eq(agentToolPermissions.workspaceId, ctx.workspace.id),
            eq(agentToolPermissions.agentId, input.agentId),
            eq(agentToolPermissions.isAllowed, true)
          )
        );

      const toolBindings: ProviderBinding[] = [];

      for (const row of allowedRows) {
        const provider = getProviderByKey(row.providerKey as ProviderKey);
        const connection = await ctx.db.query.toolConnections.findFirst({
          where: and(
            eq(toolConnections.providerId, row.providerId),
            eq(toolConnections.workspaceId, ctx.workspace.id),
            eq(toolConnections.userId, ctx.user!.id)
          )
        });

        if (!connection) {
          continue;
        }

        let accessToken = decryptString(connection.encryptedAccessToken);
        let refreshToken = connection.encryptedRefreshToken
          ? decryptString(connection.encryptedRefreshToken)
          : undefined;

        const refreshed = await provider.refreshIfNeeded({
          connection,
          decryptedAccessToken: accessToken,
          decryptedRefreshToken: refreshToken
        });

        if (refreshed) {
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken ?? refreshToken;

          await ctx.db
            .update(toolConnections)
            .set({
              encryptedAccessToken: encryptString(accessToken),
              encryptedRefreshToken: refreshToken ? encryptString(refreshToken) : null,
              expiresAt: refreshed.expiresAt,
              scopes: refreshed.scopes,
              updatedAt: new Date()
            })
            .where(
              and(
                eq(toolConnections.id, connection.id),
                eq(toolConnections.workspaceId, ctx.workspace.id),
                eq(toolConnections.userId, ctx.user!.id)
              )
            );
        }

        toolBindings.push(
          provider.buildOpenClawToolBindings({
            decryptedAccessToken: accessToken,
            decryptedRefreshToken: refreshToken,
            scopeOverrides: row.scopeOverrides
          })
        );
      }

      const result = await openClawAdapter.invokeAgent(input.agentId, {
        prompt: input.prompt,
        toolBindings
      });

      const usageRaw =
        (typeof result.usage === "object" && result.usage !== null
          ? (result.usage as Record<string, unknown>)
          : {}) || {};

      const promptTokens =
        typeof usageRaw.promptTokens === "number"
          ? usageRaw.promptTokens
          : typeof usageRaw.input_tokens === "number"
            ? usageRaw.input_tokens
            : null;
      const completionTokens =
        typeof usageRaw.completionTokens === "number"
          ? usageRaw.completionTokens
          : typeof usageRaw.output_tokens === "number"
            ? usageRaw.output_tokens
            : null;
      const totalTokens =
        typeof usageRaw.totalTokens === "number"
          ? usageRaw.totalTokens
          : typeof usageRaw.total_tokens === "number"
            ? usageRaw.total_tokens
            : promptTokens !== null && completionTokens !== null
              ? promptTokens + completionTokens
              : null;

      const outputString = typeof result.output === "string" ? result.output : JSON.stringify(result);
      await ctx.db.insert(agentInvocations).values({
        workspaceId: ctx.workspace.id,
        correlationId,
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        promptHash: createHash("sha256").update(input.prompt).digest("hex"),
        outputHash: createHash("sha256").update(outputString).digest("hex"),
        promptTokens,
        completionTokens,
        totalTokens,
        durationMs: Date.now() - startedAt,
        result: "success",
        usageRaw,
        requestMeta: {
          toolBindingCount: toolBindings.length
        }
      });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        correlationId,
        eventType: "agents.invoke",
        actorUserId: ctx.user!.id,
        agentId: input.agentId,
        result: "success",
        details: {
          toolBindingCount: toolBindings.length
        }
      });

      return {
        result,
        toolBindingCount: toolBindings.length
      };
    })
});
