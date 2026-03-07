export type OpenClawAgent = {
  id: string;
  name: string;
  status: string;
  version?: string;
  behaviorChecksum?: string;
};

export type OpenClawAgentConfig = {
  agentId: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  readOnly?: boolean;
};

export type AgentBehaviorInput = {
  model: string;
  instructions: string;
  runtimeConfig?: Record<string, unknown>;
};

export type CreateAgentInput = {
  name: string;
  behavior: AgentBehaviorInput;
};

export type UpdateAgentInput = Partial<CreateAgentInput>;

export type ToolBinding = {
  provider: string;
  capabilities: string[];
  credentials: Record<string, unknown>;
  constraints?: Record<string, unknown>;
};

export type InvokeAgentInput = {
  prompt: string;
  toolBindings: ToolBinding[];
};
