import { openClawAdapter } from "./adapter";
import type { 
  OpenClawAgent, 
  OpenClawSession, 
  OpenClawCronJob,
  OpenClawPerformanceMetrics,
  OpenClawGatewayStatus 
} from "./types";

export interface OpenClawMonitoringData {
  agents: OpenClawAgent[];
  sessions: OpenClawSession[];
  cronJobs: OpenClawCronJob[];
  performance: OpenClawPerformanceMetrics;
  gatewayStatus: OpenClawGatewayStatus;
  timestamp: Date;
}

export class OpenClawMonitor {
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSnapshot: OpenClawMonitoringData | null = null;
  private callbacks: ((data: OpenClawMonitoringData) => void)[] = [];

  private async fetchGatewayStatus(): Promise<OpenClawGatewayStatus> {
    try {
      // Try to get gateway status from the dashboard endpoint
      const response = await fetch(`${process.env.OPENCLAW_BASE_URL}/`, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.OPENCLAW_API_KEY}`,
          'x-api-key': process.env.OPENCLAW_API_KEY,
        }
      });

      return {
        online: response.ok,
        responseTime: 0, // We'll implement proper timing later
        version: 'unknown',
        load: 0,
        memory: { used: 0, total: 0 },
        uptime: 0
      };
    } catch (error) {
      return {
        online: false,
        responseTime: 0,
        version: 'unknown',
        load: 0,
        memory: { used: 0, total: 0 },
        uptime: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async fetchSessions(): Promise<OpenClawSession[]> {
    // For now, return mock data since we need to figure out the session API
    // This will be replaced with actual OpenClaw session API calls
    return [
      {
        id: 'agent:main:main',
        agentId: 'main',
        kind: 'direct',
        model: 'claude-sonnet-4-20250514',
        tokensUsed: 75000,
        tokensTotal: 200000,
        lastActivity: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        status: 'active'
      }
    ];
  }

  private async fetchCronJobs(): Promise<OpenClawCronJob[]> {
    // Mock data for now - we'll implement actual cron job API calls
    return [
      {
        id: '44ba1e8d-1da9-4ef9-8bc4-996fd7e8c23e',
        name: 'Daily Tech & AI Briefing',
        schedule: '0 13 * * *',
        enabled: true,
        nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastRun: new Date(Date.now() - 16 * 60 * 60 * 1000),
        lastStatus: 'success',
        agentId: 'main'
      }
    ];
  }

  private async fetchPerformanceMetrics(): Promise<OpenClawPerformanceMetrics> {
    // Mock data for now
    return {
      averageResponseTime: 150,
      totalRequests: 1250,
      failureRate: 0.02,
      tokensPerMinute: 850,
      memoryUsage: 0.65,
      cpuUsage: 0.23
    };
  }

  private async gatherMonitoringData(): Promise<OpenClawMonitoringData> {
    try {
      const [agents, sessions, cronJobs, performance, gatewayStatus] = await Promise.all([
        openClawAdapter.listAgents(),
        this.fetchSessions(),
        this.fetchCronJobs(),
        this.fetchPerformanceMetrics(),
        this.fetchGatewayStatus()
      ]);

      return {
        agents,
        sessions,
        cronJobs,
        performance,
        gatewayStatus,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Failed to gather monitoring data:', error);
      
      // Return fallback data
      return {
        agents: [],
        sessions: [],
        cronJobs: [],
        performance: {
          averageResponseTime: 0,
          totalRequests: 0,
          failureRate: 1,
          tokensPerMinute: 0,
          memoryUsage: 0,
          cpuUsage: 0
        },
        gatewayStatus: {
          online: false,
          responseTime: 0,
          version: 'unknown',
          load: 0,
          memory: { used: 0, total: 0 },
          uptime: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
        timestamp: new Date()
      };
    }
  }

  async getCurrentSnapshot(): Promise<OpenClawMonitoringData> {
    if (!this.lastSnapshot) {
      this.lastSnapshot = await this.gatherMonitoringData();
    }
    return this.lastSnapshot;
  }

  startRealTimeMonitoring(intervalMs: number = 30000): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(async () => {
      try {
        const newData = await this.gatherMonitoringData();
        this.lastSnapshot = newData;
        
        // Notify all subscribers
        this.callbacks.forEach(callback => {
          try {
            callback(newData);
          } catch (error) {
            console.error('Monitoring callback error:', error);
          }
        });
      } catch (error) {
        console.error('Real-time monitoring error:', error);
      }
    }, intervalMs);

    // Get initial data
    this.gatherMonitoringData().then(data => {
      this.lastSnapshot = data;
      this.callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Initial monitoring callback error:', error);
        }
      });
    });
  }

  stopRealTimeMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  subscribe(callback: (data: OpenClawMonitoringData) => void): () => void {
    this.callbacks.push(callback);
    
    // Send current data immediately if available
    if (this.lastSnapshot) {
      try {
        callback(this.lastSnapshot);
      } catch (error) {
        console.error('Subscription callback error:', error);
      }
    }

    // Return unsubscribe function
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }
}

export const openClawMonitor = new OpenClawMonitor();