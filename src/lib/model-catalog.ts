import { and, eq, gt } from "drizzle-orm";

import { modelCatalogCache, modelProviderCredentials } from "@/db/schema";
import { decryptString } from "@/lib/crypto";
import { db } from "@/lib/db";

export type SupportedModelProvider = "openai" | "anthropic";

export type ModelDescriptor = {
  id: string;
  name?: string;
  contextWindow?: number;
};

const CACHE_TTL_MS = 1000 * 60 * 30;

export function supportedModelProviders(): SupportedModelProvider[] {
  return ["openai", "anthropic"];
}

async function fetchOpenAiModels(apiKey: string): Promise<ModelDescriptor[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAI model fetch failed (${response.status})`);
  }
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data ?? [])
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id))
    .sort()
    .map((id) => ({ id }));
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelDescriptor[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic model fetch failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; display_name?: string; context_window?: number }>;
  };
  return (payload.data ?? [])
    .flatMap((row): ModelDescriptor[] => {
      if (!row.id) {
        return [];
      }
      return [
        {
          id: row.id,
          name: row.display_name,
          contextWindow: row.context_window,
        },
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModelsForProvider(input: {
  provider: SupportedModelProvider;
  apiKey: string;
}): Promise<ModelDescriptor[]> {
  if (input.provider === "openai") {
    return fetchOpenAiModels(input.apiKey);
  }
  return fetchAnthropicModels(input.apiKey);
}

export async function getAvailableModels(input: {
  workspaceId: string;
  provider: SupportedModelProvider;
  forceRefresh?: boolean;
}): Promise<ModelDescriptor[]> {
  if (!input.forceRefresh) {
    const cached = await db.query.modelCatalogCache.findFirst({
      where: and(
        eq(modelCatalogCache.workspaceId, input.workspaceId),
        eq(modelCatalogCache.providerKey, input.provider),
        gt(modelCatalogCache.expiresAt, new Date())
      ),
    });

    if (cached) {
      return cached.models;
    }
  }

  const credential = await db.query.modelProviderCredentials.findFirst({
    where: and(
      eq(modelProviderCredentials.workspaceId, input.workspaceId),
      eq(modelProviderCredentials.providerKey, input.provider),
      eq(modelProviderCredentials.label, "default")
    ),
  });

  if (!credential) {
    return [];
  }

  const apiKey = decryptString(credential.encryptedApiKey);
  const models = await fetchModelsForProvider({
    provider: input.provider,
    apiKey,
  });

  await db
    .insert(modelCatalogCache)
    .values({
      workspaceId: input.workspaceId,
      providerKey: input.provider,
      models,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [modelCatalogCache.workspaceId, modelCatalogCache.providerKey],
      set: {
        models,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        updatedAt: new Date(),
      },
    });

  return models;
}
