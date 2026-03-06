import { env } from "@/lib/env";
import type {
  ConnectionRecord,
  ExchangeCodeInput,
  OpenClawBindingInput,
  ProviderAuthUrlInput,
  ProviderTokenResult,
  ToolProvider
} from "@/lib/providers/types";

function dateFromExpiresIn(expiresIn?: number): Date | undefined {
  if (!expiresIn) {
    return undefined;
  }

  return new Date(Date.now() + expiresIn * 1000);
}

export class LinearProvider implements ToolProvider {
  readonly key = "linear" as const;
  readonly displayName = "Linear";
  readonly authType = "oauth2" as const;

  getAuthUrl(input: ProviderAuthUrlInput): string {
    if (!env.LINEAR_CLIENT_ID) {
      throw new Error("LINEAR_CLIENT_ID is not configured");
    }

    const params = new URLSearchParams({
      client_id: env.LINEAR_CLIENT_ID,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: env.LINEAR_SCOPES,
      state: input.state
    });

    return `https://linear.app/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResult> {
    if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
      throw new Error("Linear OAuth credentials are not configured");
    }

    const payload = {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: env.LINEAR_CLIENT_ID,
      client_secret: env.LINEAR_CLIENT_SECRET
    };

    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!response.ok || !body.access_token) {
      throw new Error("Linear OAuth exchange failed");
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      scopes: (body.scope ?? env.LINEAR_SCOPES).split(" ").filter(Boolean),
      expiresAt: dateFromExpiresIn(body.expires_in)
    };
  }

  async refreshIfNeeded(input: {
    connection: ConnectionRecord;
    decryptedAccessToken: string;
    decryptedRefreshToken?: string;
  }): Promise<ProviderTokenResult | null> {
    if (!input.connection.expiresAt || input.connection.expiresAt.getTime() > Date.now() + 60_000) {
      return null;
    }

    if (!input.decryptedRefreshToken) {
      return null;
    }

    if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
      throw new Error("Linear OAuth credentials are not configured");
    }

    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: input.decryptedRefreshToken,
        client_id: env.LINEAR_CLIENT_ID,
        client_secret: env.LINEAR_CLIENT_SECRET
      })
    });

    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!response.ok || !body.access_token) {
      throw new Error("Linear token refresh failed");
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? input.decryptedRefreshToken,
      scopes: (body.scope ?? env.LINEAR_SCOPES).split(" ").filter(Boolean),
      expiresAt: dateFromExpiresIn(body.expires_in)
    };
  }

  async revoke(): Promise<void> {
    // Linear does not currently expose a universal OAuth revoke endpoint.
  }

  listCapabilities(): string[] {
    return ["search_issues", "read_issue", "create_issue", "update_issue", "comment_issue"];
  }

  buildOpenClawToolBindings(input: OpenClawBindingInput) {
    const capabilities = input.scopeOverrides?.capabilities?.length
      ? input.scopeOverrides.capabilities
      : this.listCapabilities();

    return {
      provider: this.key,
      capabilities,
      credentials: {
        accessToken: input.decryptedAccessToken,
        refreshToken: input.decryptedRefreshToken
      },
      constraints: input.scopeOverrides?.constraints
    };
  }
}
