import type {
  ExchangeCodeInput,
  OpenClawBindingInput,
  ProviderAuthUrlInput,
  ProviderTokenResult,
  ToolProvider,
} from "@/lib/providers/types";

export class SlackProvider implements ToolProvider {
  readonly key = "slack" as const;
  readonly displayName = "Slack";
  readonly authType = "oauth2" as const;

  getAuthUrl(
    input: ProviderAuthUrlInput,
    app: import("@/lib/providers/types").ProviderAppCredentials
  ): string {
    const params = new URLSearchParams({
      client_id: app.clientId,
      scope: app.scopes.join(","),
      redirect_uri: input.redirectUri,
      state: input.state,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode(
    input: ExchangeCodeInput,
    app: import("@/lib/providers/types").ProviderAppCredentials
  ): Promise<ProviderTokenResult> {
    const body = new URLSearchParams({
      code: input.code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: input.redirectUri,
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      scope?: string;
      team?: { id?: string; name?: string };
      bot_user_id?: string;
    };

    if (!response.ok || !payload.ok || !payload.access_token) {
      throw new Error(`Slack OAuth failed: ${payload.error ?? response.statusText}`);
    }

    return {
      accessToken: payload.access_token,
      scopes: (payload.scope ?? "").split(",").filter(Boolean),
      externalAccountId: payload.team?.id,
      metadata: {
        teamName: payload.team?.name,
        botUserId: payload.bot_user_id,
      },
    };
  }

  async refreshIfNeeded(
    _input: {
      connection: import("@/lib/providers/types").ConnectionRecord;
      decryptedAccessToken: string;
      decryptedRefreshToken?: string;
    },
    _app: import("@/lib/providers/types").ProviderAppCredentials
  ): Promise<ProviderTokenResult | null> {
    return null;
  }

  async revoke(input: { decryptedAccessToken: string }): Promise<void> {
    const body = new URLSearchParams({
      token: input.decryptedAccessToken,
    });

    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }).catch(() => {
      // tolerate remote revoke failure
    });
  }

  listCapabilities(): string[] {
    return ["send_message", "read_channels", "read_users"];
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
      },
      constraints: input.scopeOverrides?.constraints,
    };
  }
}
