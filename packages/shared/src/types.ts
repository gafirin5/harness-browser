import type { AgentStatus, LogLevel, ProviderType, TaskStatus } from './constants.js';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Provider {
  id: number;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  defaultModel: string;
  costPer1kTokens: string;
  isActive: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: number;
  code: string;
  name: string;
  endpointUrl: string;
  providerId: number;
  providerName: string | null;
  providerActive: boolean | null;
  status: AgentStatus;
  maxConcurrency: number;
  activeTasksCount: number;
  isActive: boolean;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: 1 | 2 | 3;
  status: TaskStatus;
  tokenUsed: number;
  costPer1kSnapshot: string;
  costUsd: string;
  cancelReason: string | null;
  errorMessage: string | null;
  result: string | null;
  retryOfTaskId: number | null;
  agentId: number;
  agentCode: string | null;
  agentName: string | null;
  agentActive: boolean | null;
  providerId: number;
  providerName: string | null;
  providerActive: boolean | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskLog {
  id: number;
  taskId: number;
  userId: number | null;
  actorType: 'USER' | 'SYSTEM' | 'AGENT';
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  logLevel: LogLevel;
  message: string;
  createdAt: string;
}

export interface DashboardAlert {
  type: 'AGENT_OFFLINE' | 'TASK_FAILED';
  id: number;
  label: string;
  since: string;
}

export interface DashboardSummary {
  agentsActive: number;
  tasksRunning: number;
  tasksFailedToday: number;
  costTodayUsd: string;
  alerts: DashboardAlert[];
  recentLogs: Array<{
    id: number;
    taskId: number;
    taskCode: string;
    logLevel: LogLevel;
    message: string;
    createdAt: string;
  }>;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
