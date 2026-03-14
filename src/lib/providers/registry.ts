import { and, eq } from "drizzle-orm";

import { toolConnections, toolProviders } from "@/db/schema";
import { db } from "@/lib/db";
import { LinearProvider } from "@/lib/providers/linear";
import { SlackProvider } from "@/lib/providers/slack";
import type { ProviderKey, ToolProvider } from "@/lib/providers/types";

const providers: ToolProvider[] = [new SlackProvider(), new LinearProvider()];

export function getProviders(): ToolProvider[] {
  return providers;
}

export function getProviderByKey(key: string): ToolProvider {
  const provider = providers.find((item) => item.key === key);
  if (!provider) {
    throw new Error(`Unsupported provider: ${key}`);
  }

  return provider;
}

export async function ensureProviderSeeds(): Promise<void> {
  for (const provider of providers) {
    const exists = await db.query.toolProviders.findFirst({
      where: eq(toolProviders.key, provider.key),
    });

    if (!exists) {
      await db.insert(toolProviders).values({
        key: provider.key,
        name: provider.displayName,
        authType: provider.authType,
        capabilitiesSchema: {
          capabilities: provider.listCapabilities(),
        },
      });
    }
  }
}

export async function getUserConnectionForProvider(params: {
  providerKey: ProviderKey;
  userId: string;
}) {
  const provider = await db.query.toolProviders.findFirst({
    where: eq(toolProviders.key, params.providerKey),
  });

  if (!provider) {
    return null;
  }

  const connection = await db.query.toolConnections.findFirst({
    where: and(eq(toolConnections.providerId, provider.id), eq(toolConnections.userId, params.userId)),
  });

  if (!connection) {
    return null;
  }

  return {
    provider,
    connection,
  };
}
