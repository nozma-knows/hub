import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { oauthStates, toolConnections, toolProviderAppCredentials, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { decryptString, encryptString } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureProviderSeeds, getProviderByKey, getProviders } from "@/lib/providers/registry";
import { randomState } from "@/lib/utils";
import { adminProcedure, createTrpcRouter, protectedProcedure } from "@/server/trpc/init";

export const providersRouter = createTrpcRouter({
  getAppConfigStatus: adminProcedure.query(async ({ ctx }) => {
    await ensureProviderSeeds();

    const providerRows = await ctx.db.query.toolProviders.findMany({
      orderBy: (table, { asc }) => [asc(table.name)]
    });

    const rows = await Promise.all(
      providerRows.map(async (providerRow) => {
        const appCreds = await ctx.db.query.toolProviderAppCredentials.findFirst({
          where: and(
            eq(toolProviderAppCredentials.workspaceId, ctx.workspace.id),
            eq(toolProviderAppCredentials.providerId, providerRow.id)
          )
        });

        return {
          providerKey: providerRow.key,
          providerName: providerRow.name,
          configured: Boolean(appCreds),
          scopes: appCreds?.scopes ?? []
        };
      })
    );

    return rows;
  }),

  upsertAppCredentials: adminProcedure
    .input(
      z.object({
        providerKey: z.enum(["slack", "linear"]),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        scopes: z.array(z.string()).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProviderSeeds();

      const providerRow = await ctx.db.query.toolProviders.findFirst({
        where: eq(toolProviders.key, input.providerKey)
      });

      if (!providerRow) {
        throw new Error("Provider not seeded");
      }

      await ctx.db
        .insert(toolProviderAppCredentials)
        .values({
          workspaceId: ctx.workspace.id,
          providerId: providerRow.id,
          encryptedClientId: encryptString(input.clientId),
          encryptedClientSecret: encryptString(input.clientSecret),
          scopes: input.scopes,
          updatedBy: ctx.user!.id,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [toolProviderAppCredentials.workspaceId, toolProviderAppCredentials.providerId],
          set: {
            encryptedClientId: encryptString(input.clientId),
            encryptedClientSecret: encryptString(input.clientSecret),
            scopes: input.scopes,
            updatedBy: ctx.user!.id,
            updatedAt: new Date()
          }
        });

      await logAuditEvent({
        workspaceId: ctx.workspace.id,
        eventType: "providers.app_credentials.upsert",
        actorUserId: ctx.user!.id,
        providerKey: input.providerKey,
        result: "success",
        details: {
          scopes: input.scopes
        }
      });

      return { success: true };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureProviderSeeds();

    const providerRows = await ctx.db.query.toolProviders.findMany({
      orderBy: (table, { asc }) => [asc(table.name)]
    });

    const output = await Promise.all(
      providerRows.map(async (providerRow) => {
        const connection = await ctx.db.query.toolConnections.findFirst({
          where: and(
            eq(toolConnections.providerId, providerRow.id),
            eq(toolConnections.workspaceId, ctx.workspace.id),
            eq(toolConnections.userId, ctx.user!.id)
          )
        });

        const appCreds = await ctx.db.query.toolProviderAppCredentials.findFirst({
          where: and(
            eq(toolProviderAppCredentials.workspaceId, ctx.workspace.id),
            eq(toolProviderAppCredentials.providerId, providerRow.id)
          )
        });

        return {
          ...providerRow,
          connected: Boolean(connection),
          appConfigured: Boolean(appCreds),
          scopes: connection?.scopes ?? [],
          expiresAt: connection?.expiresAt ?? null,
          externalAccountId: connection?.externalAccountId ?? null,
          metadata: connection?.metadata ?? {}
        };
      })
    );

    return output;
  }),

  beginConnect: adminProcedure
    .input(
      z.object({
        providerKey: z.enum(["slack", "linear"]),
        redirectPath: z.string().default("/integrations")
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = getProviderByKey(input.providerKey);
      const state = randomState();

      await db.insert(oauthStates).values({
        workspaceId: ctx.workspace.id,
        providerKey: provider.key,
        state,
        userId: ctx.user!.id,
        redirectPath: input.redirectPath,
        expiresAt: new Date(Date.now() + 1000 * 60 * 10)
      });

      const providerRow = await ctx.db.query.toolProviders.findFirst({
        where: eq(toolProviders.key, provider.key)
      });
      if (!providerRow) {
        throw new Error("Provider not seeded");
      }

      const appCreds = await ctx.db.query.toolProviderAppCredentials.findFirst({
        where: and(
          eq(toolProviderAppCredentials.workspaceId, ctx.workspace.id),
          eq(toolProviderAppCredentials.providerId, providerRow.id)
        )
      });

      if (!appCreds) {
        throw new Error(`${provider.displayName} is not configured for this workspace.`);
      }

      const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/oauth/${provider.key}/callback`;
      const authorizationUrl = provider.getAuthUrl(
        {
          state,
          redirectUri
        },
        {
          clientId: decryptString(appCreds.encryptedClientId),
          clientSecret: decryptString(appCreds.encryptedClientSecret),
          scopes: appCreds.scopes
        }
      );

      return {
        url: authorizationUrl
      };
    }),

  disconnect: adminProcedure
    .input(
      z.object({
        providerKey: z.enum(["slack", "linear"])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = getProviderByKey(input.providerKey);
      const providerRow = await ctx.db.query.toolProviders.findFirst({
        where: eq(toolProviders.key, provider.key)
      });

      if (!providerRow) {
        return { success: true };
      }

      const connection = await ctx.db.query.toolConnections.findFirst({
        where: and(
          eq(toolConnections.providerId, providerRow.id),
          eq(toolConnections.workspaceId, ctx.workspace.id),
          eq(toolConnections.userId, ctx.user!.id)
        )
      });

      if (connection) {
        const accessToken = decryptString(connection.encryptedAccessToken);
        await provider.revoke({ decryptedAccessToken: accessToken });

        await ctx.db
          .delete(toolConnections)
          .where(
            and(
              eq(toolConnections.providerId, providerRow.id),
              eq(toolConnections.workspaceId, ctx.workspace.id),
              eq(toolConnections.userId, ctx.user!.id)
            )
          );

        await logAuditEvent({
          workspaceId: ctx.workspace.id,
          eventType: "providers.disconnect",
          actorUserId: ctx.user!.id,
          providerKey: provider.key,
          result: "success"
        });
      }

      return { success: true };
    }),

  health: adminProcedure
    .input(
      z.object({
        providerKey: z.enum(["slack", "linear"])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = getProviderByKey(input.providerKey);
      const providerRow = await ctx.db.query.toolProviders.findFirst({
        where: eq(toolProviders.key, provider.key)
      });

      if (!providerRow) {
        return {
          connected: false,
          healthy: false,
          reason: "provider_not_seeded"
        };
      }

      const connection = await ctx.db.query.toolConnections.findFirst({
        where: and(
          eq(toolConnections.providerId, providerRow.id),
          eq(toolConnections.workspaceId, ctx.workspace.id),
          eq(toolConnections.userId, ctx.user!.id)
        )
      });

      if (!connection) {
        return {
          connected: false,
          healthy: false,
          reason: "not_connected"
        };
      }

      if (connection.expiresAt && connection.expiresAt.getTime() < Date.now()) {
        const decryptedAccessToken = decryptString(connection.encryptedAccessToken);
        const decryptedRefreshToken = connection.encryptedRefreshToken
          ? decryptString(connection.encryptedRefreshToken)
          : undefined;

        const appCreds = await ctx.db.query.toolProviderAppCredentials.findFirst({
          where: and(
            eq(toolProviderAppCredentials.workspaceId, ctx.workspace.id),
            eq(toolProviderAppCredentials.providerId, providerRow.id)
          )
        });

        if (!appCreds) {
          return {
            connected: true,
            healthy: false,
            reason: "app_not_configured"
          };
        }

        const refreshed = await provider.refreshIfNeeded(
          {
            connection,
            decryptedAccessToken,
            decryptedRefreshToken
          },
          {
            clientId: decryptString(appCreds.encryptedClientId),
            clientSecret: decryptString(appCreds.encryptedClientSecret),
            scopes: appCreds.scopes
          }
        );

        if (!refreshed) {
          return {
            connected: true,
            healthy: false,
            reason: "token_expired"
          };
        }

        await ctx.db
          .update(toolConnections)
          .set({
            encryptedAccessToken: encryptString(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken
              ? encryptString(refreshed.refreshToken)
              : connection.encryptedRefreshToken,
            scopes: refreshed.scopes,
            expiresAt: refreshed.expiresAt,
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

      return {
        connected: true,
        healthy: true
      };
    })
});
