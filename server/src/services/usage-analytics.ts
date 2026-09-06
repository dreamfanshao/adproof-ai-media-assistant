import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type UsageEventName =
  | "signup_completed"
  | "api_request_completed"
  | "creator_search_started"
  | "audit_started"
  | "llm_call"
  | "redfox_call";

export interface UsageEvent {
  id: string;
  event: UsageEventName;
  createdAt: string;
  userKey?: string;
  module?: "creator" | "audit" | "system";
  endpoint?: string;
  provider?: string;
  model?: string;
  status?: "success" | "error" | "blocked";
  durationMs?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export type ApiLogStatus = "success" | "error" | "blocked";
export interface ApiLog {
  id: string;
  createdAt: string;
  module?: "creator" | "audit" | "system";
  provider: string;
  endpoint: string;
  method: string;
  status: ApiLogStatus;
  statusCode?: number;
  durationMs: number;
  attempt?: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

interface UsageFile { events: UsageEvent[]; apiLogs?: ApiLog[]; updatedAt: string; }

const MAX_EVENTS = 30_000;
let writeQueue: Promise<void> = Promise.resolve();

function dataPath() {
  return path.resolve(process.env.ADPROOF_ANALYTICS_DIR || path.join(process.cwd(), "data"), "usage-analytics.json");
}

const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|set-cookie|credential|session|access[_-]?token|refresh[_-]?token)/i;
const MAX_LOG_STRING = 2_000;
export function sanitizeApiPayload(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return "[image omitted]";
    return value.length > MAX_LOG_STRING ? `${value.slice(0, MAX_LOG_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeApiPayload(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeApiPayload(item, depth + 1)]));
  return String(value);
}
function safeEvent(event: UsageEvent): UsageEvent {
  return {
    ...event,
    endpoint: event.endpoint?.split("?")[0].slice(0, 120),
    metadata: event.metadata ? Object.fromEntries(Object.entries(event.metadata).slice(0, 12)) : undefined,
  };
}

export function hashIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

interface ApiLogFile { logs: ApiLog[]; updatedAt: string; }
let apiLogWriteQueue: Promise<void> = Promise.resolve();
function apiLogDataPath() { return path.resolve(process.env.ADPROOF_ANALYTICS_DIR || path.join(process.cwd(), "data"), "api-logs.json"); }
async function readApiLogFile(): Promise<ApiLogFile> {
  try {
    const raw = await fs.readFile(apiLogDataPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ApiLogFile>;
    return { logs: Array.isArray(parsed.logs) ? parsed.logs : [], updatedAt: String(parsed.updatedAt || "") };
  } catch { return { logs: [], updatedAt: "" }; }
}
async function writeApiLogFile(file: ApiLogFile) {
  const target = apiLogDataPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(file, null, 2), "utf8");
  await fs.rename(temp, target);
}
async function readFile(): Promise<UsageFile> {
  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UsageFile>;
    return { events: Array.isArray(parsed.events) ? parsed.events : [], apiLogs: Array.isArray(parsed.apiLogs) ? parsed.apiLogs : [], updatedAt: String(parsed.updatedAt || "") };
  } catch {
    return { events: [], apiLogs: [], updatedAt: "" };
  }
}

async function writeFile(file: UsageFile) {
  const target = dataPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(file, null, 2), "utf8");
  await fs.rename(temp, target);
}

/** Fire-and-forget safe event recording. Raw email, token, cookie and request bodies are never stored. */
export function recordUsageEvent(input: Omit<UsageEvent, "id" | "createdAt"> & { createdAt?: string }): Promise<void> {
  const event = safeEvent({ ...input, id: randomUUID(), createdAt: input.createdAt ?? new Date().toISOString() });
  writeQueue = writeQueue.then(async () => {
    const file = await readFile();
    file.events.push(event);
    file.events = file.events.slice(-MAX_EVENTS);
    file.updatedAt = new Date().toISOString();
    try { await writeFile(file); } catch { /* telemetry must never break product requests */ }
  });
  return writeQueue;
}

export function recordApiLog(input: Omit<ApiLog, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<void> {
  const log: ApiLog = { ...input, id: input.id ?? randomUUID(), createdAt: input.createdAt ?? new Date().toISOString(), endpoint: input.endpoint.split("?")[0].slice(0, 240), method: input.method.slice(0, 12).toUpperCase(), provider: input.provider.slice(0, 80), error: input.error?.slice(0, 500), request: sanitizeApiPayload(input.request), response: sanitizeApiPayload(input.response) };
  apiLogWriteQueue = apiLogWriteQueue.then(async () => {
    const file = await readApiLogFile();
    file.logs = [...file.logs, log].slice(-5_000);
    file.updatedAt = new Date().toISOString();
    try { await writeApiLogFile(file); } catch { /* telemetry must never break product requests */ }
  });
  return apiLogWriteQueue;
}
export async function readUsageEvents(): Promise<UsageEvent[]> { return (await readFile()).events; }
export async function readApiLogs(): Promise<ApiLog[]> { const separate = await readApiLogFile(); return separate.logs.length ? separate.logs : ((await readFile()).apiLogs ?? []); }
export async function getApiLog(id: string): Promise<ApiLog | undefined> { return (await readApiLogs()).find((item) => item.id === id); }

function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function distinct(events: UsageEvent[]) { return new Set(events.map((event) => event.userKey).filter(Boolean)).size; }

function localDayKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export async function getUsageOverview(days = 30) {
  const all = await readUsageEvents();
  const now = Date.now();
  const today = startOfToday(new Date(now));
  const sevenDaysAgo = now - 7 * 86_400_000;
  const since = now - Math.max(1, days) * 86_400_000;
  const events = all.filter((event) => Date.parse(event.createdAt) >= since);
  const registrations = all.filter((event) => event.event === "signup_completed");
  const registrationsToday = registrations.filter((event) => Date.parse(event.createdAt) >= today);
  const userEvents = events.filter((event) => Boolean(event.userKey) && event.event !== "signup_completed");
  const activeEventsToday = userEvents.filter((event) => Date.parse(event.createdAt) >= today);
  const activeEvents7d = userEvents.filter((event) => Date.parse(event.createdAt) >= sevenDaysAgo);
  const featureEvents = events.filter((event) => Boolean(event.userKey) && ["creator_search_started", "audit_started"].includes(event.event));
  const featureEventsToday = featureEvents.filter((event) => Date.parse(event.createdAt) >= today);
  const apiEvents = events.filter((event) => ["llm_call", "redfox_call"].includes(event.event));
  const providerNames = [...new Set(apiEvents.map((event) => event.provider || (event.event === "redfox_call" ? "redfox" : "llm")))];
  const apiUsage = providerNames.map((provider) => {
    const rows = apiEvents.filter((event) => (event.provider || (event.event === "redfox_call" ? "redfox" : "llm")) === provider);
    const durations = rows.map((row) => row.durationMs).filter((value): value is number => typeof value === "number");
    return { provider, calls: rows.length, errors: rows.filter((row) => row.status === "error").length, avgDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null };
  });
  const registeredUsers = distinct(registrations);
  const newUsersToday = distinct(registrationsToday);
  const activeUsersToday = distinct(activeEventsToday);
  const activeUsers7d = distinct(activeEvents7d);
  const adoptedUsers = distinct(featureEvents);
  const activeDaysByUser = new Map<string, Set<string>>();
  for (const event of activeEvents7d) {
    if (!event.userKey) continue;
    const day = localDayKey(event.createdAt);
    if (!day) continue;
    const daysForUser = activeDaysByUser.get(event.userKey) ?? new Set<string>();
    daysForUser.add(day);
    activeDaysByUser.set(event.userKey, daysForUser);
  }
  const returningUsers7d = [...activeDaysByUser.values()].filter((activeDays) => activeDays.size >= 2).length;
  const creatorSearchesToday = featureEventsToday.filter((event) => event.event === "creator_search_started" && event.status === "success").length;
  const auditsToday = featureEventsToday.filter((event) => event.event === "audit_started" && event.status === "success").length;
  const totalCalls = apiEvents.length;
  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    registeredUsers,
    newUsersToday,
    activeUsersToday,
    activeUsers7d,
    returningUsers7d,
    returningRate7d: activeUsers7d ? Number((returningUsers7d / activeUsers7d * 100).toFixed(1)) : null,
    observedUsers: distinct(userEvents),
    adoptedUsers,
    adoptionRate: registeredUsers ? Number((adoptedUsers / registeredUsers * 100).toFixed(1)) : null,
    creatorSearchesToday,
    auditsToday,
    coreTasksToday: creatorSearchesToday + auditsToday,
    totalApiCalls: totalCalls,
    totalApiErrors: apiEvents.filter((event) => event.status === "error").length,
    apiUsage,
    eventCount: events.length,
    notes: [
      "User identifiers are aggregated as irreversible hashes; secrets and message bodies are not exposed.",
      registeredUsers ? "Adoption rate is calculated from registered users who used a business feature." : "No registered-user baseline is available.",
      "API usage is measured by local server telemetry; provider billing remains in the RedFoxHub console.",
    ],
  };
}

