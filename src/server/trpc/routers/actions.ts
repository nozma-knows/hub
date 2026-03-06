import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { agentToolPermissions, toolConnections, toolProviders } from "@/db/schema";
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
            eq(toolConnections.userId, ctx.user.id)
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
            .where(eq(toolConnections.id, connection.id));
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

      await logAuditEvent({
        eventType: "agents.invoke",
        actorUserId: ctx.user.id,
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
