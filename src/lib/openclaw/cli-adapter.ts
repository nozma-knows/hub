import { exec } from "child_process";
import { promisify } from "util";
import type {
  OpenClawAgent,
  OpenClawSession,
  OpenClawCronJob,
  OpenClawPerformanceMetrics,
  OpenClawGatewayStatus
} from "./types";

const execAsync = promisify(exec);

export class OpenClawCliAdapter {
  private async runCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 15000, // 15 second timeout
        maxBuffer: 1024 * 1024 // 1MB max output
      });
      
      if (stderr && !stderr.includes('warning:') && !stderr.includes('info:')) {
        console.warn('OpenClaw CLI stderr:', stderr);
      }
      
      return stdout.trim();
    } catch (error) {
      console.error('OpenClaw CLI command failed:', command, error);
      throw new Error(`OpenClaw CLI error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    const output = await this.runCommand('openclaw agents list');
    const agents: OpenClawAgent[] = [];
    
    // Parse the output format
    const lines = output.split('\n');
    let currentAgent: Partial<OpenClawAgent> | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Agent name line: "- main (default)"
      if (trimmed.startsWith('- ')) {
        if (currentAgent?.id) {
          agents.push({
            id: currentAgent.id,
            name: currentAgent.name || currentAgent.id,
            status: currentAgent.status || 'ready',
            version: currentAgent.version,
            behaviorChecksum: currentAgent.behaviorChecksum
          });
        }
        
        const match = trimmed.match(/^- (\w+)(.*)$/);
        if (match) {
          currentAgent = {
            id: match[1],
            name: match[1],
            status: 'ready'
          };
        }
      }
      
      // Identity line: "  Identity: 🐨 Kodi (IDENTITY.md)"
      if (trimmed.startsWith('Identity:') && currentAgent) {
        const identityMatch = trimmed.match(/Identity: (?:🐨\s+)?(.+?)(?:\s+\([^)]+\))?$/);
        if (identityMatch) {
          currentAgent.name = identityMatch[1].trim();
        }
      }
      
      // Model line: "  Model: anthropic/claude-sonnet-4-20250514"
      if (trimmed.startsWith('Model:') && currentAgent) {
        const modelMatch = trimmed.match(/Model: (.+)$/);
        if (modelMatch) {
          currentAgent.version = modelMatch[1];
        }
      }
    }
    
    // Add the last agent if exists
    if (currentAgent?.id) {
      agents.push({
        id: currentAgent.id,
        name: currentAgent.name || currentAgent.id,
        status: currentAgent.status || 'ready',
        version: currentAgent.version,
        behaviorChecksum: currentAgent.behaviorChecksum
      });
    }
    
    return agents;
  }

  async listSessions(): Promise<OpenClawSession[]> {
    const output = await this.runCommand('openclaw sessions list');
    const sessions: OpenClawSession[] = [];
    
    const lines = output.split('\n');
    let inSessionData = false;
    
    for (const line of lines) {
      if (line.includes('Kind') && line.includes('Key') && line.includes('Model')) {
        inSessionData = true;
        continue;
      }
      
      if (!inSessionData) continue;
      
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Parse session line: "direct agent:main:main 1m ago claude-sonnet-4-20250514 116k/200k (58%) system id:..."
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;
      
      const kind = parts[0];
      const sessionId = parts[1];
      const ageStr = parts[2] + ' ' + parts[3]; // "1m ago"
      
      let model = '';
      let tokensStr = '';
      let modelIndex = 4;
      
      // Find where model starts (looking for a model-like string)
      for (let i = 4; i < parts.length; i++) {
        if (parts[i].includes('claude-') || parts[i].includes('gpt-') || parts[i].includes('anthropic/')) {
          model = parts[i];
          modelIndex = i;
          break;
        }
      }
      
      // Find tokens (format like "116k/200k")
      for (let i = modelIndex + 1; i < parts.length; i++) {
        if (parts[i].includes('/') && (parts[i].includes('k') || parts[i].includes('M'))) {
          tokensStr = parts[i];
          break;
        }
      }
      
      // Parse tokens
      let tokensUsed = 0;
      let tokensTotal = 0;
      
      if (tokensStr) {
        const tokenMatch = tokensStr.match(/(\d+(?:\.\d+)?)([kM]?)\/(\d+(?:\.\d+)?)([kM]?)/);
        if (tokenMatch) {
          const [, usedNum, usedUnit, totalNum, totalUnit] = tokenMatch;
          
          tokensUsed = parseFloat(usedNum) * (usedUnit === 'k' ? 1000 : usedUnit === 'M' ? 1000000 : 1);
          tokensTotal = parseFloat(totalNum) * (totalUnit === 'k' ? 1000 : totalUnit === 'M' ? 1000000 : 1);
        }
      }
      
      // Determine agent ID from session ID
      let agentId = 'unknown';
      if (sessionId.startsWith('agent:')) {
        const agentMatch = sessionId.match(/^agent:([^:]+)/);
        if (agentMatch) {
          agentId = agentMatch[1];
        }
      }
      
      // Calculate last activity (rough estimation)
      let lastActivity = new Date();
      if (ageStr.includes('m ago')) {
        const minutes = parseInt(ageStr);
        lastActivity = new Date(Date.now() - minutes * 60 * 1000);
      } else if (ageStr.includes('h ago')) {
        const hours = parseInt(ageStr);
        lastActivity = new Date(Date.now() - hours * 60 * 60 * 1000);
      }
      
      sessions.push({
        id: sessionId,
        agentId,
        kind: kind as OpenClawSession['kind'],
        model: model || 'unknown',
        tokensUsed: Math.round(tokensUsed),
        tokensTotal: Math.round(tokensTotal),
        lastActivity,
        status: 'active'
      });
    }
    
    return sessions;
  }

  async listCronJobs(): Promise<OpenClawCronJob[]> {
    const output = await this.runCommand('openclaw cron list');
    const jobs: OpenClawCronJob[] = [];
    
    const lines = output.split('\n');
    let inJobData = false;
    
    for (const line of lines) {
      if (line.includes('ID') && line.includes('Name') && line.includes('Schedule')) {
        inJobData = true;
        continue;
      }
      
      if (!inJobData) continue;
      
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Parse job line: "44ba1e8d-1da9-4ef9-8bc4-996fd7e8c23e Daily Tech & AI Briefing cron 0 13 * * * @ UTC in 6h 17h ago ok isolated main"
      const parts = trimmed.split(/\s+/);
      if (parts.length < 6) continue;
      
      const id = parts[0];
      
      // Find the schedule part (starts with "cron")
      let scheduleStart = -1;
      let scheduleEnd = -1;
      
      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === 'cron') {
          scheduleStart = i + 1;
          // Find end of schedule (before "in" or "never" or similar)
          for (let j = i + 1; j < parts.length; j++) {
            if (parts[j] === 'in' || parts[j] === 'never' || parts[j] === '@') {
              scheduleEnd = j;
              break;
            }
          }
          break;
        }
      }
      
      let schedule = '';
      if (scheduleStart > 0 && scheduleEnd > scheduleStart) {
        schedule = parts.slice(scheduleStart, scheduleEnd).join(' ');
      }
      
      // Extract name (between ID and "cron")
      let name = '';
      if (scheduleStart > 1) {
        name = parts.slice(1, scheduleStart - 1).join(' ');
      }
      
      // Find status, agent etc.
      let status: OpenClawCronJob['lastStatus'] = undefined;
      let agentId = 'unknown';
      let enabled = true;
      
      // Look for status indicators
      for (const part of parts) {
        if (part === 'ok' || part === 'success') status = 'success';
        if (part === 'failure' || part === 'error') status = 'failure';
        if (part === 'timeout') status = 'timeout';
        if (part === 'disabled') enabled = false;
      }
      
      // Agent ID is usually the last part
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart !== 'ok' && lastPart !== 'error' && lastPart !== 'isolated') {
          agentId = lastPart;
        }
      }
      
      jobs.push({
        id,
        name: name || 'Unnamed Job',
        schedule,
        enabled,
        lastStatus: status,
        agentId,
        nextRun: undefined, // Would need more parsing to extract timing
        lastRun: undefined,
        runCount: undefined,
        averageDuration: undefined
      });
    }
    
    return jobs;
  }

  async getPerformanceMetrics(): Promise<OpenClawPerformanceMetrics> {
    // For now, return basic metrics. We could parse from openclaw status later
    return {
      averageResponseTime: 150,
      totalRequests: 1250,
      failureRate: 0.01,
      tokensPerMinute: 850,
      memoryUsage: 0.45,
      cpuUsage: 0.15
    };
  }

  async getGatewayStatus(): Promise<OpenClawGatewayStatus> {
    try {
      const output = await this.runCommand('openclaw gateway status');
      const isOnline = !output.includes('not running') && !output.includes('error');
      
      // Parse version from status
      let version = 'unknown';
      const versionMatch = output.match(/OpenClaw ([^\s]+)/);
      if (versionMatch) {
        version = versionMatch[1];
      }
      
      return {
        online: isOnline,
        responseTime: 25, // Rough estimate since CLI is fast
        version,
        load: 0.2,
        memory: { used: 512 * 1024 * 1024, total: 2048 * 1024 * 1024 }, // Mock data
        uptime: 3600 // Mock data
      };
    } catch (error) {
      return {
        online: false,
        responseTime: 0,
        version: 'unknown',
        load: 0,
        memory: { used: 0, total: 0 },
        uptime: 0,
        error: error instanceof Error ? error.message : 'Gateway offline'
      };
    }
  }
}

export const openClawCliAdapter = new OpenClawCliAdapter();