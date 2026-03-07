import { createHash, randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { sleep } from "@/lib/utils";
import type {
  CreateAgentInput,
  InvokeAgentInput,
  OpenClawAgent,
  OpenClawAgentConfig,
  UpdateAgentInput
} from "@/lib/openclaw/types";

type OpenClawSdkClient = {
  agents: {
    list: () => Promise<unknown>;
    get: (id: string) => Promise<unknown>;
    create: (input: unknown, opts?: { idempotencyKey?: string }) => Promise<unknown>;
    update: (id: string, input: unknown, opts?: { idempotencyKey?: string }) => Promise<unknown>;
    delete: (id: string, opts?: { idempotencyKey?: string }) => Promise<void>;
    validateBehavior: (input: unknown) => Promise<{ valid: boolean; issues?: string[] }>;
    invoke: (id: string, input: unknown) => Promise<unknown>;
  };
};

class OpenClawError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "OpenClawError";
    this.statusCode = statusCode;
  }
}

const dynamicImport = new Function(
  "moduleName",
  "return import(moduleName)"
) as (moduleName: string) => Promise<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toHttpBaseUrl(value: string): string {
  if (value.startsWith("ws://")) {
    return `http://${value.slice("ws://".length)}`;
  }
  if (value.startsWith("wss://")) {
    return `https://${value.slice("wss://".length)}`;
  }
  return value;
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function firstStringFromRecord(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = firstString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function checksumBehavior(input: { model: string; instructions: string; runtimeConfig?: Record<string, unknown> }): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32);
}

function extractAgentRows(payload: unknown): { recognized: boolean; rows: unknown[] } {
  if (Array.isArray(payload)) {
    return { recognized: true, rows: payload };
  }

  if (!isRecord(payload)) {
    return { recognized: false, rows: [] };
  }

  const topLevelCollections = ["data", "agents", "items", "results", "result"] as const;
  for (const key of topLevelCollections) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return { recognized: true, rows: value };
    }
  }

  if (isRecord(payload.data)) {
    for (const key of ["agents", "items", "results", "result"] as const) {
      const value = payload.data[key];
      if (Array.isArray(value)) {
        return { recognized: true, rows: value };
      }
    }
  }

  return { recognized: false, rows: [] };
}

function parseAgentRecord(value: unknown): OpenClawAgent | null {
  if (!isRecord(value)) {
    return null;
  }

  const id =
    firstStringFromRecord(value, ["id", "agentId", "slug", "key"]) ??
    firstString(value.name) ??
    "";
  if (!id) {
    return null;
  }

  const statusSource = value.status ?? value.state ?? value.health;
  let status = "ready";
  if (typeof statusSource === "string" && statusSource.trim().length > 0) {
    status = statusSource;
  } else if (typeof statusSource === "boolean") {
    status = statusSource ? "healthy" : "unhealthy";
  }

  return {
    id,
    name: firstStringFromRecord(value, ["name", "displayName", "title"]) ?? id,
    status,
    version: firstStringFromRecord(value, ["version", "openclawVersion", "revision"]),
    behaviorChecksum: firstStringFromRecord(value, ["behaviorChecksum", "checksum"])
  };
}

function parseAgentCollection(payload: unknown): { recognized: boolean; agents: OpenClawAgent[] } {
  const { recognized, rows } = extractAgentRows(payload);
  if (!recognized) {
    return { recognized: false, agents: [] };
  }

  const agents = rows.map((row) => parseAgentRecord(row)).filter((row): row is OpenClawAgent => row !== null);
  return { recognized: true, agents };
}

function unwrapAgentPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  if (isRecord(payload.agent)) {
    return payload.agent;
  }

  if (isRecord(payload.data)) {
    return payload.data;
  }

  return payload;
}

function asAgent(value: unknown): OpenClawAgent {
  const parsed = parseAgentRecord(unwrapAgentPayload(value));
  if (parsed) {
    return parsed;
  }

  throw new OpenClawError("OpenClaw returned an invalid agent payload.", 502);
}

class Circuit {
  private failures = 0;
  private openedAt: number | null = null;

  canRun(): boolean {
    if (this.failures < env.OPENCLAW_CIRCUIT_THRESHOLD) {
      return true;
    }

    if (!this.openedAt) {
      this.openedAt = Date.now();
      return false;
    }

    if (Date.now() - this.openedAt > env.OPENCLAW_CIRCUIT_COOLDOWN_MS) {
      this.failures = 0;
      this.openedAt = null;
      return true;
    }

    return false;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.failures >= env.OPENCLAW_CIRCUIT_THRESHOLD && !this.openedAt) {
      this.openedAt = Date.now();
    }
  }
}

export class OpenClawAdapter {
  private readonly configuredBaseUrl = env.OPENCLAW_BASE_URL.replace(/\/$/, "");
  private readonly httpBaseUrl = toHttpBaseUrl(this.configuredBaseUrl);
  private readonly apiKey = env.OPENCLAW_API_KEY;
  private readonly circuit = new Circuit();
  private sdkClientPromise: Promise<OpenClawSdkClient | null> | null = null;

  private async sdkClient(): Promise<OpenClawSdkClient | null> {
    if (!this.sdkClientPromise) {
      this.sdkClientPromise = dynamicImport(env.OPENCLAW_SDK_PACKAGE)
        .then((mod) => {
          const OpenClawCtor = mod.OpenClaw as
            | (new (config: Record<string, unknown>) => OpenClawSdkClient)
            | undefined;
          if (!OpenClawCtor) {
            return null;
          }

          return new OpenClawCtor({
            apiKey: this.apiKey,
            baseUrl: this.configuredBaseUrl,
            timeoutMs: env.OPENCLAW_TIMEOUT_MS
          });
        })
        .catch(() => null);
    }

    return this.sdkClientPromise;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.circuit.canRun()) {
      throw new OpenClawError("OpenClaw circuit is open. Retry after cooldown.", 503);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= env.OPENCLAW_RETRIES; attempt += 1) {
      try {
        const result = await operation();
        this.circuit.onSuccess();
        return result;
      } catch (error) {
        lastError = error;
        this.circuit.onFailure();

        if (
          error instanceof OpenClawError &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          break;
        }

        if (attempt === env.OPENCLAW_RETRIES) {
          break;
        }

        const backoff = Math.min(250 * 2 ** attempt, 2000);
        await sleep(backoff);
      }
    }

    if (lastError instanceof OpenClawError) {
      throw lastError;
    }

    throw new OpenClawError(
      lastError instanceof Error ? lastError.message : "OpenClaw operation failed",
      500
    );
  }

  private async restFetch<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.OPENCLAW_TIMEOUT_MS);
    const requestUrl = `${this.httpBaseUrl}${path}`;

    const response = await fetch(requestUrl, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${this.apiKey}`,
        "x-api-key": this.apiKey,
        "x-gateway-token": this.apiKey,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(init.headers ?? {})
      },
      signal: controller.signal
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new OpenClawError(`OpenClaw HTTP ${response.status}: ${details}`, response.status);
    }

    if (response.status === 204) {
      return null as T;
    }

    const text = await response.text();
    if (!text) {
      return null as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private isUnsupportedEndpoint(error: unknown): boolean {
    return (
      error instanceof OpenClawError &&
      (error.statusCode === 404 || error.statusCode === 405 || error.statusCode === 501)
    );
  }

  private async firstCompatibleResponse<T>(input: {
    paths: string[];
    parse: (payload: unknown) => T | undefined;
    init?: RequestInit;
    idempotencyKey?: string;
  }): Promise<T> {
    let lastError: unknown;

    for (const path of input.paths) {
      try {
        const payload = await this.restFetch<unknown>(path, input.init, input.idempotencyKey);
        const parsed = input.parse(payload);
        if (parsed !== undefined) {
          return parsed;
        }
        lastError = new OpenClawError(`Unsupported payload shape from ${path}.`, 502);
      } catch (error) {
        if (this.isUnsupportedEndpoint(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw new OpenClawError(
      lastError instanceof Error
        ? lastError.message
        : "OpenClaw did not expose a compatible API endpoint for this operation.",
      502
    );
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    return this.withRetry(async () => {
      const sdk = await this.sdkClient();
      if (sdk) {
        const result = await sdk.agents.list();
        const parsed = parseAgentCollection(result);
        if (parsed.recognized) {
          return parsed.agents;
        }
      }

      return this.firstCompatibleResponse({
        paths: ["/agents", "/api/agents", "/v1/agents", "/control/agents", "/api/control/agents", "/v1/control/agents"],
        parse: (payload) => {
          const parsed = parseAgentCollection(payload);
          return parsed.recognized ? parsed.agents : undefined;
        }
      });
    });
  }

  async getAgent(agentId: string): Promise<OpenClawAgent> {
    return this.withRetry(async () => {
      const sdk = await this.sdkClient();
      if (sdk) {
        return asAgent(await sdk.agents.get(agentId));
      }

      const encodedAgentId = encodeURIComponent(agentId);
      return this.firstCompatibleResponse({
        paths: [
          `/agents/${encodedAgentId}`,
          `/api/agents/${encodedAgentId}`,
          `/v1/agents/${encodedAgentId}`,
          `/control/agents/${encodedAgentId}`,
          `/api/control/agents/${encodedAgentId}`,
          `/v1/control/agents/${encodedAgentId}`
        ],
        parse: (payload) => {
          try {
            return asAgent(payload);
          } catch {
            return undefined;
          }
        }
      });
    });
  }

  async createAgent(input: CreateAgentInput): Promise<OpenClawAgent> {
    return this.withRetry(async () => {
      const idempotencyKey = randomUUID();
      const sdk = await this.sdkClient();
      if (sdk) {
        return asAgent(await sdk.agents.create(input, { idempotencyKey }));
      }

      return this.firstCompatibleResponse({
        paths: ["/agents", "/api/agents", "/v1/agents", "/control/agents", "/api/control/agents", "/v1/control/agents"],
        init: { method: "POST", body: JSON.stringify(input) },
        idempotencyKey,
        parse: (payload) => {
          try {
            return asAgent(payload);
          } catch {
            return undefined;
          }
        }
      });
    });
  }

  async updateAgent(agentId: string, input: UpdateAgentInput): Promise<OpenClawAgent> {
    return this.withRetry(async () => {
      const idempotencyKey = randomUUID();
      const sdk = await this.sdkClient();
      if (sdk) {
        return asAgent(await sdk.agents.update(agentId, input, { idempotencyKey }));
      }

      const encodedAgentId = encodeURIComponent(agentId);
      return this.firstCompatibleResponse({
        paths: [
          `/agents/${encodedAgentId}`,
          `/api/agents/${encodedAgentId}`,
          `/v1/agents/${encodedAgentId}`,
          `/control/agents/${encodedAgentId}`,
          `/api/control/agents/${encodedAgentId}`,
          `/v1/control/agents/${encodedAgentId}`
        ],
        init: {
          method: "PATCH",
          body: JSON.stringify(input)
        },
        idempotencyKey,
        parse: (payload) => {
          try {
            return asAgent(payload);
          } catch {
            return undefined;
          }
        }
      });
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    return this.withRetry(async () => {
      const idempotencyKey = randomUUID();
      const sdk = await this.sdkClient();
      if (sdk) {
        await sdk.agents.delete(agentId, { idempotencyKey });
        return;
      }

      const encodedAgentId = encodeURIComponent(agentId);
      const paths = [
        `/agents/${encodedAgentId}`,
        `/api/agents/${encodedAgentId}`,
        `/v1/agents/${encodedAgentId}`,
        `/control/agents/${encodedAgentId}`,
        `/api/control/agents/${encodedAgentId}`,
        `/v1/control/agents/${encodedAgentId}`
      ];

      let lastError: unknown;
      for (const path of paths) {
        try {
          await this.restFetch(path, { method: "DELETE" }, idempotencyKey);
          return;
        } catch (error) {
          if (this.isUnsupportedEndpoint(error)) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }

      throw new OpenClawError(
        lastError instanceof Error
          ? lastError.message
          : "OpenClaw did not expose a compatible delete endpoint.",
        502
      );
    });
  }

  async validateAgentBehavior(input: {
    model: string;
    instructions: string;
    runtimeConfig?: Record<string, unknown>;
  }): Promise<{ valid: boolean; issues: string[]; checksum: string }> {
    return this.withRetry(async () => {
      const checksum = checksumBehavior(input);
      const sdk = await this.sdkClient();
      if (sdk) {
        const result = await sdk.agents.validateBehavior(input);
        return { valid: result.valid, issues: result.issues ?? [], checksum };
      }

      try {
        const result = await this.firstCompatibleResponse({
          paths: ["/agents/validate-behavior", "/api/agents/validate-behavior", "/v1/agents/validate-behavior"],
          init: {
            method: "POST",
            body: JSON.stringify(input)
          },
          parse: (payload) => {
            if (!isRecord(payload)) {
              return undefined;
            }

            const valid = payload.valid;
            if (typeof valid !== "boolean") {
              return undefined;
            }

            const issues = Array.isArray(payload.issues)
              ? payload.issues.filter((issue): issue is string => typeof issue === "string")
              : [];
            return { valid, issues };
          }
        });

        return { valid: result.valid, issues: result.issues, checksum };
      } catch (error) {
        if (this.isUnsupportedEndpoint(error)) {
          return { valid: true, issues: [], checksum };
        }
        throw error;
      }
    });
  }

  async invokeAgent(agentId: string, input: InvokeAgentInput): Promise<Record<string, unknown>> {
    return this.withRetry(async () => {
      const sdk = await this.sdkClient();
      if (sdk) {
        const result = await sdk.agents.invoke(agentId, input);
        return result as Record<string, unknown>;
      }

      const encodedAgentId = encodeURIComponent(agentId);

      try {
        return await this.firstCompatibleResponse({
          paths: [
            `/agents/${encodedAgentId}/invoke`,
            `/api/agents/${encodedAgentId}/invoke`,
            `/v1/agents/${encodedAgentId}/invoke`,
            `/control/agents/${encodedAgentId}/invoke`,
            `/api/control/agents/${encodedAgentId}/invoke`,
            `/v1/control/agents/${encodedAgentId}/invoke`
          ],
          init: {
            method: "POST",
            body: JSON.stringify(input)
          },
          parse: (payload) => (isRecord(payload) ? payload : undefined)
        });
      } catch (error) {
        if (!this.isUnsupportedEndpoint(error)) {
          throw error;
        }
      }

      return this.firstCompatibleResponse({
        paths: ["/v1/responses"],
        init: {
          method: "POST",
          body: JSON.stringify({
            agentId,
            input: input.prompt,
            metadata: {
              source: "openclaw-hub",
              toolBindingCount: input.toolBindings.length
            },
            toolBindings: input.toolBindings
          })
        },
        parse: (payload) => {
          if (isRecord(payload)) {
            return payload;
          }
          return {
            output: payload
          };
        }
      });
    });
  }

  async getAgentConfig(agentId: string): Promise<OpenClawAgentConfig> {
    return this.withRetry(async () => {
      const encodedAgentId = encodeURIComponent(agentId);
      try {
        return await this.firstCompatibleResponse({
          paths: [
            `/agents/${encodedAgentId}/config`,
            `/api/agents/${encodedAgentId}/config`,
            `/v1/agents/${encodedAgentId}/config`,
            `/control/agents/${encodedAgentId}/config`,
            `/api/control/agents/${encodedAgentId}/config`,
            `/v1/control/agents/${encodedAgentId}/config`
          ],
          parse: (payload) => {
            if (!isRecord(payload)) {
              return undefined;
            }
            const filesValue = payload.files;
            if (!Array.isArray(filesValue)) {
              return undefined;
            }

            const files = filesValue
              .map((file) => {
                if (!isRecord(file)) {
                  return null;
                }
                const path = firstString(file.path);
                const content = firstString(file.content);
                if (!path || content === undefined) {
                  return null;
                }
                return { path, content };
              })
              .filter((row): row is { path: string; content: string } => row !== null);

            return {
              agentId,
              files,
              readOnly: Boolean(payload.readOnly)
            };
          }
        });
      } catch (error) {
        if (!this.isUnsupportedEndpoint(error)) {
          throw error;
        }
      }

      const fallback = await this.getAgent(agentId);
      return {
        agentId,
        readOnly: true,
        files: [
          {
            path: "instructions.md",
            content: `# ${fallback.name}\n\nOpenClaw config endpoint is unavailable on this gateway.`
          }
        ]
      };
    });
  }

  async updateAgentConfig(input: OpenClawAgentConfig): Promise<OpenClawAgentConfig> {
    return this.withRetry(async () => {
      const encodedAgentId = encodeURIComponent(input.agentId);
      return this.firstCompatibleResponse({
        paths: [
          `/agents/${encodedAgentId}/config`,
          `/api/agents/${encodedAgentId}/config`,
          `/v1/agents/${encodedAgentId}/config`,
          `/control/agents/${encodedAgentId}/config`,
          `/api/control/agents/${encodedAgentId}/config`,
          `/v1/control/agents/${encodedAgentId}/config`
        ],
        init: {
          method: "PUT",
          body: JSON.stringify({
            files: input.files
          })
        },
        parse: (payload) => {
          if (!isRecord(payload) || !Array.isArray(payload.files)) {
            return undefined;
          }
          const files = payload.files
            .map((row) => {
              if (!isRecord(row)) {
                return null;
              }
              const path = firstString(row.path);
              const content = firstString(row.content);
              if (!path || content === undefined) {
                return null;
              }
              return { path, content };
            })
            .filter((row): row is { path: string; content: string } => row !== null);
          return {
            agentId: input.agentId,
            files,
            readOnly: Boolean(payload.readOnly)
          };
        }
      });
    });
  }
}

export const openClawAdapter = new OpenClawAdapter();
