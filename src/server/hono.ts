import { trpcServer } from "@hono/trpc-server";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";

import { oauthStates, toolConnections, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { decryptString, encryptString } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureProviderSeeds, getProviderByKey } from "@/lib/providers/registry";
import { appRouter } from "@/server/trpc";
import { createTrpcContext } from "@/server/trpc/context";
import { startReconciliationSync } from "@/server/sync";

export const honoApp = new Hono().basePath("/api");

honoApp.get("/health", async (c) => {
  await ensureProviderSeeds();
  const count = await db.$count(toolProviders);
  return c.json({
    ok: true,
    providerCount: count,
    timestamp: new Date().toISOString()
  });
});

honoApp.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_, c) => createTrpcContext(c)
  })
);

honoApp.get("/oauth/:provider/callback", async (c) => {
  const providerKey = c.req.param("provider");
  const state = c.req.query("state");
  const code = c.req.query("code");

  if (!state || !code) {
    return c.redirect(`${env.NEXT_PUBLIC_APP_URL}/integrations?status=oauth_failed`);
  }

  try {
    await ensureProviderSeeds();
    const provider = getProviderByKey(providerKey);

    const oauthState = await db.query.oauthStates.findFirst({
      where: and(
        eq(oauthStates.providerKey, provider.key),
        eq(oauthStates.state, state),
        gt(oauthStates.expiresAt, new Date())
      )
    });

    if (!oauthState || !oauthState.userId) {
      return c.redirect(`${env.NEXT_PUBLIC_APP_URL}/integrations?status=invalid_state`);
    }

    const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/oauth/${provider.key}/callback`;
    const tokenResult = await provider.exchangeCode({
      code,
      redirectUri,
      codeVerifier: oauthState.codeVerifier ?? undefined
    });

    const providerRow = await db.query.toolProviders.findFirst({
      where: eq(toolProviders.key, provider.key)
    });

    if (!providerRow) {
      throw new Error("Provider seed missing");
    }

    await db
      .insert(toolConnections)
      .values({
        providerId: providerRow.id,
        userId: oauthState.userId,
        encryptedAccessToken: encryptString(tokenResult.accessToken),
        encryptedRefreshToken: tokenResult.refreshToken
          ? encryptString(tokenResult.refreshToken)
          : null,
        scopes: tokenResult.scopes,
        expiresAt: tokenResult.expiresAt,
        externalAccountId: tokenResult.externalAccountId,
        metadata: tokenResult.metadata ?? {},
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [toolConnections.providerId, toolConnections.userId],
        set: {
          encryptedAccessToken: encryptString(tokenResult.accessToken),
          encryptedRefreshToken: tokenResult.refreshToken
            ? encryptString(tokenResult.refreshToken)
            : null,
          scopes: tokenResult.scopes,
          expiresAt: tokenResult.expiresAt,
          externalAccountId: tokenResult.externalAccountId,
          metadata: tokenResult.metadata ?? {},
          updatedAt: new Date()
        }
      });

    await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

    await logAuditEvent({
      eventType: "providers.connect",
      actorUserId: oauthState.userId,
      providerKey: provider.key,
      result: "success"
    });

    return c.redirect(
      `${env.NEXT_PUBLIC_APP_URL}${oauthState.redirectPath}?provider=${provider.key}&status=connected`
    );
  } catch (error) {
    return c.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/integrations?status=oauth_failed&error=${encodeURIComponent(
        error instanceof Error ? error.message : "unknown"
      )}`
    );
  }
});

startReconciliationSync();
