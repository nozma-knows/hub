import type { toolConnections } from "@/db/schema";

export type ProviderKey = "slack" | "linear";

export type ConnectionRecord = typeof toolConnections.$inferSelect;

export type ProviderAuthUrlInput = {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
};

export type ExchangeCodeInput = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type ProviderTokenResult = {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt?: Date;
  externalAccountId?: string;
  metadata?: Record<string, unknown>;
};

export type OpenClawBindingInput = {
  decryptedAccessToken: string;
  decryptedRefreshToken?: string;
  scopeOverrides?: {
    capabilities?: string[];
    constraints?: Record<string, unknown>;
  };
};

export type ProviderBinding = {
  provider: ProviderKey;
  capabilities: string[];
  credentials: Record<string, unknown>;
  constraints?: Record<string, unknown>;
};

export interface ToolProvider {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly authType: "oauth2";

  getAuthUrl(input: ProviderAuthUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResult>;
  refreshIfNeeded(input: {
    connection: ConnectionRecord;
    decryptedAccessToken: string;
    decryptedRefreshToken?: string;
  }): Promise<ProviderTokenResult | null>;
  revoke(input: { decryptedAccessToken: string }): Promise<void>;
  listCapabilities(): string[];
  buildOpenClawToolBindings(input: OpenClawBindingInput): ProviderBinding;
}
