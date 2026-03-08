"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function MonitoringPage() {
  const [realTimeEnabled, setRealTimeEnabled] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30000);

  const { data: systemHealth, isLoading: healthLoading } = trpc.monitoring.getSystemHealth.useQuery(
    undefined,
    { refetchInterval: realTimeEnabled ? refreshInterval : false }
  );

  const { data: gatewayStatus, isLoading: gatewayLoading } = trpc.monitoring.getGatewayStatus.useQuery(
    undefined,
    { refetchInterval: realTimeEnabled ? refreshInterval : false }
  );

  const { data: sessions, isLoading: sessionsLoading } = trpc.monitoring.getAgentSessions.useQuery(
    {},
    { refetchInterval: realTimeEnabled ? refreshInterval : false }
  );

  const { data: cronJobs, isLoading: cronLoading } = trpc.monitoring.getCronJobs.useQuery(
    {},
    { refetchInterval: realTimeEnabled ? refreshInterval : false }
  );

  const { data: performance, isLoading: performanceLoading } = trpc.monitoring.getPerformanceMetrics.useQuery(
    { timeRange: '1h' },
    { refetchInterval: realTimeEnabled ? refreshInterval : false }
  );

  const startRealTimeMonitoring = trpc.monitoring.startRealTimeMonitoring.useMutation();
  const stopRealTimeMonitoring = trpc.monitoring.stopRealTimeMonitoring.useMutation();
  const triggerSync = trpc.sync.manualSync.useMutation();
  const syncStatus = trpc.sync.checkSyncStatus.useQuery();

  const handleToggleRealTime = async () => {
    if (realTimeEnabled) {
      await stopRealTimeMonitoring.mutateAsync();
      setRealTimeEnabled(false);
    } else {
      await startRealTimeMonitoring.mutateAsync({ intervalMs: refreshInterval });
      setRealTimeEnabled(true);
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'text-green-600 bg-green-100';
      case 'unhealthy': return 'text-red-600 bg-red-100';
      default: return 'text-yellow-600 bg-yellow-100';
    }
  };

  const formatTimestamp = (date: string | Date) => {
    return new Date(date).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Real-Time Monitoring</h1>
          <p className="text-gray-600">Monitor OpenClaw agents, sessions, and performance</p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center sm:gap-4">
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="w-full px-3 py-2 border rounded-md sm:w-auto"
          >
            <option value={15000}>15 seconds</option>
            <option value={30000}>30 seconds</option>
            <option value={60000}>1 minute</option>
          </select>

          <button
            onClick={async () => {
              try {
                const result = await triggerSync.mutateAsync();
                alert(`✅ Sync successful! Synced ${result.agentCount} agents: ${result.agentNames.join(', ')}`);
                window.location.reload();
              } catch (error) {
                alert(`❌ Sync failed: ${error}`);
              }
            }}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium sm:w-auto"
            disabled={triggerSync.isPending}
          >
            {triggerSync.isPending ? 'Syncing...' : 'Sync from OpenClaw'}
          </button>

          <button
            onClick={handleToggleRealTime}
            className={`w-full px-4 py-2 rounded-md font-medium sm:w-auto ${
              realTimeEnabled
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            disabled={startRealTimeMonitoring.isPending || stopRealTimeMonitoring.isPending}
          >
            {realTimeEnabled ? 'Stop Monitoring' : 'Start Real-Time'}
          </button>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-900">Sync Status</h3>
          <div className="mt-2 text-lg font-semibold">
            {syncStatus.isLoading ? "…" : syncStatus.data?.inSync ? "✅ In sync" : "❌ Out of sync"}
          </div>
          <div className="text-sm text-gray-600">
            DB: {syncStatus.data?.databaseAgents ?? 0} · Live: {syncStatus.data?.liveAgents ?? 0}
          </div>
          {syncStatus.data?.error && (
            <div className="mt-2 text-xs text-red-600 break-words">{syncStatus.data.error}</div>
          )}
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">System Health</h3>
            <div 
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                systemHealth ? getHealthColor(systemHealth.overallHealth) : 'text-gray-600 bg-gray-100'
              }`}
            >
              {healthLoading ? 'Loading...' : systemHealth?.overallHealth || 'Unknown'}
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold">
            {healthLoading ? '...' : systemHealth?.timestamp ? formatTimestamp(systemHealth.timestamp) : 'No data'}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-900">Gateway Status</h3>
          <div className="mt-2 flex items-center space-x-2">
            <div 
              className={`w-3 h-3 rounded-full ${
                gatewayStatus?.online ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-lg font-semibold">
              {gatewayLoading ? 'Loading...' : gatewayStatus?.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            Response: {gatewayStatus?.responseTime || 0}ms
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-900">Active Sessions</h3>
          <div className="mt-2 text-2xl font-bold">
            {sessionsLoading ? '...' : sessions?.filter(s => s.status === 'active').length || 0}
          </div>
          <div className="text-sm text-gray-600">
            of {sessions?.length || 0} total
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-900">Cron Jobs</h3>
          <div className="mt-2 text-2xl font-bold">
            {cronLoading ? '...' : cronJobs?.filter(j => j.enabled).length || 0}
          </div>
          <div className="text-sm text-gray-600">
            enabled, {cronJobs?.filter(j => j.lastStatus === 'failure').length || 0} failed
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {performance && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-bold mb-4">Performance Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h4 className="text-sm font-medium text-gray-900">Response Time</h4>
              <div className="text-2xl font-bold">
                {formatDuration(performance.current.averageResponseTime)}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-900">Failure Rate</h4>
              <div className="text-2xl font-bold">
                {formatPercentage(performance.current.failureRate)}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-900">Tokens/min</h4>
              <div className="text-2xl font-bold">
                {performance.current.tokensPerMinute.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      {sessions && sessions.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-bold mb-4">Active Sessions</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Session ID</th>
                  <th className="text-left py-2">Agent</th>
                  <th className="text-left py-2">Model</th>
                  <th className="text-left py-2">Tokens</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b">
                    <td className="py-2 font-mono text-sm">
                      {session.id.length > 30 ? `${session.id.slice(0, 30)}...` : session.id}
                    </td>
                    <td className="py-2">{session.agentId}</td>
                    <td className="py-2">{session.model}</td>
                    <td className="py-2">
                      {session.tokensUsed.toLocaleString()} / {session.tokensTotal.toLocaleString()}
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div 
                          className="bg-blue-600 h-2 rounded-full" 
                          style={{ width: `${(session.tokensUsed / session.tokensTotal) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        session.status === 'active' ? 'bg-green-100 text-green-800' :
                        session.status === 'error' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="py-2 text-sm">
                      {formatTimestamp(session.lastActivity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cron Jobs */}
      {cronJobs && cronJobs.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-bold mb-4">Scheduled Tasks</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Name</th>
                  <th className="text-left py-2">Schedule</th>
                  <th className="text-left py-2">Agent</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Last Run</th>
                  <th className="text-left py-2">Next Run</th>
                </tr>
              </thead>
              <tbody>
                {cronJobs.map((job) => (
                  <tr key={job.id} className="border-b">
                    <td className="py-2 font-medium">{job.name}</td>
                    <td className="py-2 font-mono text-sm">{job.schedule}</td>
                    <td className="py-2">{job.agentId}</td>
                    <td className="py-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        job.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {job.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {job.lastStatus && (
                        <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                          job.lastStatus === 'success' ? 'bg-green-100 text-green-800' :
                          job.lastStatus === 'failure' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {job.lastStatus}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-sm">
                      {job.lastRun ? formatTimestamp(job.lastRun) : 'Never'}
                    </td>
                    <td className="py-2 text-sm">
                      {job.nextRun ? formatTimestamp(job.nextRun) : 'Not scheduled'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
