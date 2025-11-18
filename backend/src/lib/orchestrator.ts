export type OrchestratorMode = 'mock' | 'docker' | 'k8s';

export type StartInstanceInput = {
  instanceId: string;
  imageRef?: string | null;
  cpuMilli?: number;
  memMiB?: number;
};

export type StopInstance = (instanceId: string) => Promise<{ ok: boolean; mode?: string }>;

export type OrchestratorLog = {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  msg: string;
};

export type MetricPoint = { ts: string; value: number };

export type MetricsWindow = '1m' | '5m' | '15m' | (string & {});

export type StartInstance = (input: StartInstanceInput) => Promise<{ ok: boolean; mode?: string }>;
export type GetLogs = (instanceId: string, tail?: number) => Promise<{ items: OrchestratorLog[] }>;
export type GetMetrics = (instanceId: string, window?: MetricsWindow) => Promise<{ cpu: MetricPoint[]; memMiB: MetricPoint[] }>;

export interface OrchestratorDriver {
  startInstance: StartInstance;
  stopInstance: StopInstance;
  getLogs: GetLogs;
  getMetrics: GetMetrics;
}

export const orchestratorMode: OrchestratorMode = (process.env.ORCHESTRATOR_MODE?.toLowerCase() as OrchestratorMode) || 'mock';

import {
  startInstance as runtimeStart,
  stopInstance as runtimeStop,
  getLogs as runtimeLogs,
  getMetrics as runtimeMetrics
} from './orchestrator.js';

export const startInstance: StartInstance = runtimeStart as StartInstance;
export const stopInstance: StopInstance = runtimeStop as StopInstance;
export const getLogs: GetLogs = runtimeLogs as GetLogs;
export const getMetrics: GetMetrics = runtimeMetrics as GetMetrics;
