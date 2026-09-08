import { apiRequest } from "./api-client";

export interface OperationsOverview {
  generatedAt: string;
  registeredUsers: number;
  newUsersToday: number;
  newUsers7d: number;
  activeUsersToday: number;
  activeUsers7d: number;
  returningUsers7d: number;
  returningRate7d: number | null;
  adoptedUsers: number;
  adoptionRate: number | null;
  creatorSearchesToday: number;
  auditsToday: number;
  coreTasksToday: number;
  totalApiCalls: number;
  totalApiErrors: number;
  apiUsage: Array<{ provider: string; calls: number; errors: number; avgDurationMs: number | null }>;
  feedback: { total: number; open: number; inProgress: number; resolved: number; bugs: number };
  notes: string[];
}

export function getOperationsAccess(accessToken: string) {
  return apiRequest<{ data: { isAdmin: boolean } }>("/operations/access", accessToken);
}

export function getOperationsOverview(accessToken: string) {
  return apiRequest<{ data: OperationsOverview }>("/operations/overview", accessToken);
}
