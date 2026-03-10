import { trpcServer } from "@hono/trpc-server";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";

import { oauthStates, toolConnections, toolProviderAppCredentials, toolProviders } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { decryptString, encryptString } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureProviderSeeds, getProviderByKey } from "@/lib/providers/registry";
import { appRouter } from "@/server/trpc";
import { createTrpcContext } from "@/server/trpc/context";
import { startReconciliationSync } from "@/server/sync";
import { startDispatcher } from "@/server/dispatcher";
import { startSkillInstaller } from "@/server/skill-installer";

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

honoApp.post("/stt/transcribe", async (c) => {
  const ctx = await createTrpcContext(c);
  if (!ctx.user || !ctx.workspace) return c.json({ error: "unauthorized" }, 401);
  if (!env.OPENAI_API_KEY) return c.json({ error: "OPENAI_API_KEY not configured" }, 500);

  const body = await c.req.parseBody();
  const file = body["file"] as unknown as File | undefined;
  if (!file) return c.json({ error: "missing file" }, 400);

  // Convert to a Blob for Node fetch FormData
  const ab = await file.arrayBuffer();
  const blob = new Blob([ab], { type: file.type || "application/octet-stream" });

  const form = new FormData();
  form.append("file", blob, file.name || "audio");
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: form as any
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return c.json({ error: "transcription_failed", detail: txt }, 500);
  }

  const raw = await resp.text();
  // Sometimes providers return JSON even when we asked for text; handle both.
  let text = raw;
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed && typeof parsed.text === "string") text = parsed.text;
  } catch {
    // ignore
  }

  return c.json({ text });
});

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

    const providerRow = await db.query.toolProviders.findFirst({
      where: eq(toolProviders.key, provider.key)
    });

    if (!providerRow) {
      throw new Error("Provider seed missing");
    }

    const appCreds = await db.query.toolProviderAppCredentials.findFirst({
      where: and(
        eq(toolProviderAppCredentials.workspaceId, oauthState.workspaceId),
        eq(toolProviderAppCredentials.providerId, providerRow.id)
      )
    });

    if (!appCreds) {
      throw new Error(`${provider.displayName} is not configured for this workspace.`);
    }

    const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/oauth/${provider.key}/callback`;
    const tokenResult = await provider.exchangeCode(
      {
        code,
        redirectUri,
        codeVerifier: oauthState.codeVerifier ?? undefined
      },
      {
        clientId: decryptString(appCreds.encryptedClientId),
        clientSecret: decryptString(appCreds.encryptedClientSecret),
        scopes: appCreds.scopes
      }
    );

    await db
      .insert(toolConnections)
      .values({
        providerId: providerRow.id,
        workspaceId: oauthState.workspaceId,
        userId: oauthState.userId,
        encryptedAccessToken: encryptString(tokenResult.accessToken),
        encryptedRefreshToken: tokenResult.refreshToken ? encryptString(tokenResult.refreshToken) : null,
        scopes: tokenResult.scopes,
        expiresAt: tokenResult.expiresAt,
        externalAccountId: tokenResult.externalAccountId,
        metadata: tokenResult.metadata ?? {},
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [toolConnections.providerId, toolConnections.workspaceId, toolConnections.userId],
        set: {
          encryptedAccessToken: encryptString(tokenResult.accessToken),
          encryptedRefreshToken: tokenResult.refreshToken ? encryptString(tokenResult.refreshToken) : null,
          scopes: tokenResult.scopes,
          expiresAt: tokenResult.expiresAt,
          externalAccountId: tokenResult.externalAccountId,
          metadata: tokenResult.metadata ?? {},
          updatedAt: new Date()
        }
      });

    await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

    await logAuditEvent({
      workspaceId: oauthState.workspaceId,
      eventType: "providers.connect",
      actorUserId: oauthState.userId,
      providerKey: provider.key,
      result: "success"
    });

    return c.redirect(`${env.NEXT_PUBLIC_APP_URL}${oauthState.redirectPath}?provider=${provider.key}&status=connected`);
  } catch (error) {
    return c.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/integrations?status=oauth_failed&error=${encodeURIComponent(
        error instanceof Error ? error.message : "unknown"
      )}`
    );
  }
});

// Avoid starting background intervals during Next.js build/trace steps.
const nextPhase = process.env.NEXT_PHASE;
if (nextPhase !== "phase-production-build") {
  startReconciliationSync();
  startDispatcher();
  startSkillInstaller();
}
