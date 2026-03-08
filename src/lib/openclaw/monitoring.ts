import { openClawAdapter } from "./adapter";
import { openClawCliAdapter } from "./cli-adapter";
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
  private isPolling = false;

  private async fetchGatewayStatus(): Promise<OpenClawGatewayStatus> {
    try {
      return await openClawCliAdapter.getGatewayStatus();
    } catch (error) {
      console.error('Failed to fetch gateway status from OpenClaw CLI:', error);
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

  private async fetchSessions(): Promise<OpenClawSession[]> {
    try {
      return await openClawCliAdapter.listSessions();
    } catch (error) {
      console.error('Failed to fetch sessions from OpenClaw CLI:', error);
      return [];
    }
  }

  private async fetchCronJobs(): Promise<OpenClawCronJob[]> {
    try {
      return await openClawCliAdapter.listCronJobs();
    } catch (error) {
      console.error('Failed to fetch cron jobs from OpenClaw CLI:', error);
      return [];
    }
  }

  private async fetchPerformanceMetrics(): Promise<OpenClawPerformanceMetrics> {
    try {
      return await openClawCliAdapter.getPerformanceMetrics();
    } catch (error) {
      console.error('Failed to fetch performance metrics from OpenClaw CLI:', error);
      return {
        averageResponseTime: 0,
        totalRequests: 0,
        failureRate: 1,
        tokensPerMinute: 0,
        memoryUsage: 0,
        cpuUsage: 0
      };
    }
  }

  private async gatherMonitoringData(): Promise<OpenClawMonitoringData> {
    try {
      const [agents, sessions, cronJobs, performance, gatewayStatus] = await Promise.all([
        openClawCliAdapter.listAgents(),
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
    const safeIntervalMs = Math.max(intervalMs, 15000);

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    const poll = async () => {
      if (this.isPolling) {
        return;
      }

      this.isPolling = true;
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
      } finally {
        this.isPolling = false;
      }
    };

    this.pollInterval = setInterval(() => {
      void poll();
    }, safeIntervalMs);

    void poll();
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
