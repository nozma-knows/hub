declare module "@openclaw/sdk" {
  export class OpenClaw {
    constructor(config: Record<string, unknown>);
    agents: {
      list: () => Promise<{ data: unknown[] }>;
      get: (id: string) => Promise<unknown>;
      create: (input: unknown, opts?: { idempotencyKey?: string }) => Promise<unknown>;
      update: (id: string, input: unknown, opts?: { idempotencyKey?: string }) => Promise<unknown>;
      delete: (id: string, opts?: { idempotencyKey?: string }) => Promise<void>;
      validateBehavior: (input: unknown) => Promise<{ valid: boolean; issues?: string[] }>;
      invoke: (id: string, input: unknown) => Promise<unknown>;
    };
  }
}
