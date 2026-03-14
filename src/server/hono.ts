import { trpcServer } from "@hono/trpc-server";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";

import {
  hubChannels,
  hubMessageAttachments,
  hubMessages,
  hubThreads,
  oauthStates,
  toolConnections,
  toolProviderAppCredentials,
  toolProviders,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { decryptString, encryptString } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureProviderSeeds, getProviderByKey } from "@/lib/providers/registry";
import { appRouter } from "@/server/trpc";
import { createTrpcContext } from "@/server/trpc/context";
import { startReconciliationSync } from "@/server/sync";
import { startDispatcher } from "@/server/dispatcher";
import { startMediaGc } from "@/server/media-gc";
// (skill installer runs in dispatcher worker)

export const honoApp = new Hono().basePath("/api");

honoApp.get("/health", async (c) => {
  await ensureProviderSeeds();
  const count = await db.$count(toolProviders);
  return c.json({
    ok: true,
    providerCount: count,
    timestamp: new Date().toISOString(),
  });
});

honoApp.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_, c) => createTrpcContext(c),
  })
);

honoApp.post("/media/upload", async (c) => {
  const ctx = await createTrpcContext(c);
  if (!ctx.user || !ctx.workspace) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.parseBody();
  const file = body["file"] as unknown as File | undefined;
  if (!file) return c.json({ error: "missing_file" }, 400);

  const mime = (file.type || "").toLowerCase();
  const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (!allowed.has(mime)) return c.json({ error: "unsupported_type", mime }, 400);

  const maxBytes = Number(process.env.HUB_MEDIA_MAX_BYTES ?? 10 * 1024 * 1024);
  const ab = await file.arrayBuffer();
  if (ab.byteLength > maxBytes) return c.json({ error: "file_too_large", maxBytes }, 413);

  const mediaDir = process.env.HUB_MEDIA_DIR ?? "/root/.openclaw/hub-media";
  await mkdir(mediaDir, { recursive: true });

  const safeName = (file.name || "image").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);

  const id = randomUUID();
  const ext =
    mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : "jpg";
  const rel = `${ctx.workspace.id}/${id}.${ext}`;
  const full = path.join(mediaDir, rel);
  await mkdir(path.dirname(full), { recursive: true });

  const buf = Buffer.from(ab);
  await writeFile(full, buf);

  let dims: { width?: number; height?: number } = {};
  try {
    dims = imageSize(buf) as any;
  } catch {
    // ignore
  }

  const [row] = await db
    .insert(hubMessageAttachments)
    .values({
      id,
      workspaceId: ctx.workspace.id,
      messageId: null,
      createdByUserId: ctx.user.id,
      kind: "image",
      storagePath: rel,
      originalName: safeName,
      mimeType: mime,
      sizeBytes: ab.byteLength,
      width: typeof dims.width === "number" ? dims.width : null,
      height: typeof dims.height === "number" ? dims.height : null,
    })
    .returning();

  return c.json({
    id: row?.id ?? id,
    kind: "image",
    mimeType: mime,
    sizeBytes: ab.byteLength,
    width: typeof dims.width === "number" ? dims.width : null,
    height: typeof dims.height === "number" ? dims.height : null,
    originalName: safeName,
    url: `/api/media/${id}`,
  });
});

honoApp.get("/media/:id", async (c) => {
  const ctx = await createTrpcContext(c);
  if (!ctx.user || !ctx.workspace) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const att = await db.query.hubMessageAttachments.findFirst({
    where: and(eq(hubMessageAttachments.workspaceId, ctx.workspace.id), eq(hubMessageAttachments.id, id)),
  });
  if (!att) return c.notFound();
  if (!att.messageId) return c.json({ error: "not_attached" }, 404);

  // Authorization: user must have access to the message's thread/channel.
  const msg = await db.query.hubMessages.findFirst({
    where: and(eq(hubMessages.workspaceId, ctx.workspace.id), eq(hubMessages.id, att.messageId)),
  });
  if (!msg) return c.notFound();

  const thread = await db.query.hubThreads.findFirst({
    where: and(eq(hubThreads.workspaceId, ctx.workspace.id), eq(hubThreads.id, msg.threadId)),
  });
  if (!thread) return c.notFound();

  const channel = await db.query.hubChannels.findFirst({
    where: and(eq(hubChannels.workspaceId, ctx.workspace.id), eq(hubChannels.id, thread.channelId)),
  });
  if (!channel) return c.notFound();

  if (channel.kind === "dm" && channel.dmOwnerUserId !== ctx.user.id) {
    return c.json({ error: "forbidden" }, 403);
  }

  const mediaDir = process.env.HUB_MEDIA_DIR ?? "/root/.openclaw/hub-media";
  const full = path.join(mediaDir, att.storagePath);
  const data = await readFile(full);

  c.header("Content-Type", att.mimeType);
  c.header("Content-Length", String(data.byteLength));
  c.header("Cache-Control", "private, max-age=3600");
  c.header("Content-Disposition", `inline; filename=\"${(att.originalName ?? "image").replace(/\"/g, "")}\"`);
  return c.body(data);
});

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
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: form as any,
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
      ),
    });

    if (!oauthState || !oauthState.userId) {
      return c.redirect(`${env.NEXT_PUBLIC_APP_URL}/integrations?status=invalid_state`);
    }

    const providerRow = await db.query.toolProviders.findFirst({
      where: eq(toolProviders.key, provider.key),
    });

    if (!providerRow) {
      throw new Error("Provider seed missing");
    }

    const appCreds = await db.query.toolProviderAppCredentials.findFirst({
      where: and(
        eq(toolProviderAppCredentials.workspaceId, oauthState.workspaceId),
        eq(toolProviderAppCredentials.providerId, providerRow.id)
      ),
    });

    if (!appCreds) {
      throw new Error(`${provider.displayName} is not configured for this workspace.`);
    }

    const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/oauth/${provider.key}/callback`;
    const tokenResult = await provider.exchangeCode(
      {
        code,
        redirectUri,
        codeVerifier: oauthState.codeVerifier ?? undefined,
      },
      {
        clientId: decryptString(appCreds.encryptedClientId),
        clientSecret: decryptString(appCreds.encryptedClientSecret),
        scopes: appCreds.scopes,
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
        updatedAt: new Date(),
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
          updatedAt: new Date(),
        },
      });

    await db.delete(oauthStates).where(eq(oauthStates.id, oauthState.id));

    await logAuditEvent({
      workspaceId: oauthState.workspaceId,
      eventType: "providers.connect",
      actorUserId: oauthState.userId,
      providerKey: provider.key,
      result: "success",
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

// Avoid starting background intervals during Next.js build/trace steps.
const nextPhase = process.env.NEXT_PHASE;
if (nextPhase !== "phase-production-build") {
  // These are safe to run in-process for single-instance deployments.
  // For multi-instance web scaling, disable them via env so only a single worker runs loops.
  if (env.HUB_SYNC_ENABLED) {
    startReconciliationSync();
  }

  // Dispatcher has its own HUB_DISPATCHER_ENABLED gate inside startDispatcher().
  startDispatcher();

  if (env.HUB_MEDIA_GC_ENABLED) {
    startMediaGc();
  }

  // startSkillInstaller(); (handled by dispatcher worker)
}
