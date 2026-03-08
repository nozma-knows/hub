export type OpenClawAgent = {
  id: string;
  name: string;
  status: string;
  version?: string;
  behaviorChecksum?: string;
  workspacePath?: string;
  agentDir?: string;
  model?: string;
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

// Real-time monitoring types
export type OpenClawSession = {
  id: string;
  agentId: string;
  kind: 'direct' | 'cron' | 'spawn' | 'webhook';
  model: string;
  tokensUsed: number;
  tokensTotal: number;
  lastActivity: Date;
  status: 'active' | 'idle' | 'ended' | 'error';
  errorMessage?: string;
};

export type OpenClawCronJob = {
  id: string;
  name: string;
  schedule: string; // Cron expression
  enabled: boolean;
  nextRun?: Date;
  lastRun?: Date;
  lastStatus?: 'success' | 'failure' | 'timeout' | 'pending';
  agentId: string;
  errorMessage?: string;
  runCount?: number;
  averageDuration?: number;
};

export type OpenClawPerformanceMetrics = {
  averageResponseTime: number; // ms
  totalRequests: number;
  failureRate: number; // 0-1
  tokensPerMinute: number;
  memoryUsage: number; // 0-1
  cpuUsage: number; // 0-1
};

export type OpenClawGatewayStatus = {
  online: boolean;
  responseTime: number; // ms
  version: string;
  load: number; // 0-1
  memory: {
    used: number; // bytes
    total: number; // bytes
  };
  uptime: number; // seconds
  error?: string;
};
