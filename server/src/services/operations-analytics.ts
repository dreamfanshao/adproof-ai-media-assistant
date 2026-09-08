import type pg from "pg";
import { getUsageOverview } from "./usage-analytics.js";

function chinaStartOfDay(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+08:00`);
}

function chinaDayKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(value);
}

export async function getOperationsOverview(pool: pg.Pool): Promise<Record<string, unknown>> {
  const dayStart = chinaStartOfDay();
  const weekStart = new Date(dayStart.getTime() - 7 * 86_400_000);
  const monthStart = new Date(dayStart.getTime() - 30 * 86_400_000);
  const [registrationResult, eventResult, feedbackResult, usage] = await Promise.all([
    pool.query(
      `select
         count(*)::int as registered_users,
         count(*) filter (where created_at >= $1)::int as new_users_today,
         count(*) filter (where created_at >= $2)::int as new_users_7d
       from public.user_profiles`,
      [dayStart, weekStart],
    ),
    pool.query(
      `select user_key, event, status, created_at
       from private.analytics_events
       where created_at >= $1 and user_key is not null
       order by created_at desc
       limit 30000`,
      [monthStart],
    ),
    pool.query(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'open')::int as open,
         count(*) filter (where status = 'in_progress')::int as in_progress,
         count(*) filter (where status in ('resolved', 'closed'))::int as resolved,
         count(*) filter (where category = 'bug')::int as bugs
       from public.feedback_tickets`,
    ),
    getUsageOverview(30),
  ]);

  const rows = eventResult.rows as Array<{ user_key: string; event: string; status: string | null; created_at: string }>;
  const dayStartMs = dayStart.getTime();
  const weekStartMs = weekStart.getTime();
  const activeToday = new Set<string>();
  const active7d = new Set<string>();
  const activeDays = new Map<string, Set<string>>();
  let searchesToday = 0;
  let auditsToday = 0;
  for (const row of rows) {
    const timestamp = Date.parse(row.created_at);
    if (!Number.isFinite(timestamp)) continue;
    if (timestamp >= weekStartMs) {
      active7d.add(row.user_key);
      const day = chinaDayKey(new Date(timestamp));
      const days = activeDays.get(row.user_key) ?? new Set<string>();
      days.add(day);
      activeDays.set(row.user_key, days);
    }
    if (timestamp >= dayStartMs) {
      activeToday.add(row.user_key);
      if (row.event === "creator_search_started" && row.status === "success") searchesToday += 1;
      if (row.event === "audit_started" && row.status === "success") auditsToday += 1;
    }
  }
  const returningUsers7d = [...activeDays.values()].filter((days) => days.size >= 2).length;
  const registrations = registrationResult.rows[0] ?? {};
  const registeredUsers = Number(registrations.registered_users ?? 0);
  const adoptedUsers = Number(usage.adoptedUsers ?? 0);
  const feedback = feedbackResult.rows[0] ?? {};
  return {
    generatedAt: new Date().toISOString(),
    registeredUsers,
    newUsersToday: Number(registrations.new_users_today ?? 0),
    newUsers7d: Number(registrations.new_users_7d ?? 0),
    activeUsersToday: activeToday.size,
    activeUsers7d: active7d.size,
    returningUsers7d,
    returningRate7d: active7d.size ? Number((returningUsers7d / active7d.size * 100).toFixed(1)) : null,
    adoptedUsers,
    adoptionRate: registeredUsers ? Number((adoptedUsers / registeredUsers * 100).toFixed(1)) : null,
    creatorSearchesToday: searchesToday,
    auditsToday,
    coreTasksToday: searchesToday + auditsToday,
    totalApiCalls: Number(usage.totalApiCalls ?? 0),
    totalApiErrors: Number(usage.totalApiErrors ?? 0),
    apiUsage: usage.apiUsage ?? [],
    feedback: {
      total: Number(feedback.total ?? 0),
      open: Number(feedback.open ?? 0),
      inProgress: Number(feedback.in_progress ?? 0),
      resolved: Number(feedback.resolved ?? 0),
      bugs: Number(feedback.bugs ?? 0),
    },
    notes: [
      "注册人数来自 user_profiles，DAU 来自已登录用户的业务行为事件。",
      "用户标识只保存不可逆哈希，不展示邮箱、Token 或原始请求内容。",
    ],
  };
}
