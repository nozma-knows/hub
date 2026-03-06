import { env } from "@/lib/env";
import type {
  ExchangeCodeInput,
  OpenClawBindingInput,
  ProviderAuthUrlInput,
  ProviderTokenResult,
  ToolProvider
} from "@/lib/providers/types";

export class SlackProvider implements ToolProvider {
  readonly key = "slack" as const;
  readonly displayName = "Slack";
  readonly authType = "oauth2" as const;

  getAuthUrl(input: ProviderAuthUrlInput): string {
    if (!env.SLACK_CLIENT_ID) {
      throw new Error("SLACK_CLIENT_ID is not configured");
    }

    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      scope: env.SLACK_SCOPES,
      redirect_uri: input.redirectUri,
      state: input.state
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ProviderTokenResult> {
    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
      throw new Error("Slack OAuth credentials are not configured");
    }

    const body = new URLSearchParams({
      code: input.code,
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      redirect_uri: input.redirectUri
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
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
        botUserId: payload.bot_user_id
      }
    };
  }

  async refreshIfNeeded(): Promise<ProviderTokenResult | null> {
    return null;
  }

  async revoke(input: { decryptedAccessToken: string }): Promise<void> {
    const body = new URLSearchParams({
      token: input.decryptedAccessToken
    });

    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
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
        accessToken: input.decryptedAccessToken
      },
      constraints: input.scopeOverrides?.constraints
    };
  }
}
