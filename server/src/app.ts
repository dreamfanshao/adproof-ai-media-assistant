import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createClient } from "@supabase/supabase-js";
import Fastify from "fastify";
import pg from "pg";
import type { ServerConfig } from "./config.js";
import { registerErrorHandlers } from "./errors.js";
import { authPlugin, createSupabaseAuthVerifier, type AuthVerifier } from "./plugins/auth.js";
import { platformConnectionRoutes } from "./routes/platform-connections.js";
import { profileRoutes } from "./routes/profile.js";
import { projectRoutes } from "./routes/projects.js";
import { searchRoutes } from "./routes/search.js";
import { creatorRoutes } from "./routes/creators.js";
import { taskEventRoutes } from "./routes/task-events.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { auditRoutes } from "./routes/audit.js";
import { redfoxCredentialRoutes } from "./routes/redfox-credential.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { createProfileRepository, type ProfileRepository } from "./services/profile-repository.js";
import { hashIdentity, recordUsageEvent } from "./services/usage-analytics.js";
import { createPostgresRedfoxCredentialStore, type RedfoxCredentialStore } from "./services/redfox-credential-service.js";
import { createFeedbackRepository, type FeedbackRepository } from "./services/feedback-repository.js";
import {
  InMemoryXhsConnectionService,
  type XhsConnectionService,
} from "./services/xhs-connection-service.js";
import {
  createSupabaseXhsSessionRepository,
  XhsSessionCipher,
} from "./services/xhs-session-persistence.js";

const { Pool } = pg;

interface BuildAppOptions {
  config: ServerConfig;
  authVerifier?: AuthVerifier;
  profileRepository?: ProfileRepository;
  xhsConnectionService?: XhsConnectionService;
  logger?: boolean;
  redfoxCredentialStore?: RedfoxCredentialStore;
  feedbackRepository?: FeedbackRepository;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.logger ? { redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] } : false,
    trustProxy: "127.0.0.1",
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandlers(app);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: options.config.webOrigins, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(authPlugin, {
    verifier: options.authVerifier ?? createSupabaseAuthVerifier(options.config),
  });
  app.addHook("onRequest", async (request) => { (request as typeof request & { __usageStartedAt?: number }).__usageStartedAt = Date.now(); });
  app.addHook("onResponse", async (request, reply) => {
    const started = (request as typeof request & { __usageStartedAt?: number }).__usageStartedAt ?? Date.now();
    const url = request.url.split("?")[0];
    if (!url.includes("/analytics/")) {
      const module = url.includes("audit") ? "audit" : url.includes("search") || url.includes("creator") ? "creator" : "system";
      const event = request.method === "POST" && url.includes("search-tasks") ? "creator_search_started" : request.method === "POST" && url === "/api/v1/audit-tasks" ? "audit_started" : "api_request_completed";
      void recordUsageEvent({ event, userKey: request.auth?.userId ? hashIdentity(request.auth.userId) : undefined, module, endpoint: url, status: reply.statusCode < 400 ? "success" : reply.statusCode === 429 ? "blocked" : "error", durationMs: Date.now() - started });
    }
  });  const persistence = options.config.supabaseServiceRoleKey && options.config.xhsSessionEncryptionKey
    ? {
        repository: createSupabaseXhsSessionRepository(
          options.config.supabaseUrl,
          options.config.supabaseServiceRoleKey,
        ),
        cipher: new XhsSessionCipher(options.config.xhsSessionEncryptionKey),
      }
    : undefined;
  const xhsConnectionService = options.xhsConnectionService
    ?? new InMemoryXhsConnectionService(persistence);
  app.addHook("onClose", async () => xhsConnectionService.closeAll());

  // pg 直连池：private.jobs / job_events（技术方案：private schema 不暴露给 PostgREST）
  const pool = options.config.databaseUrl
    ? new Pool({ connectionString: options.config.databaseUrl, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
    : null;
  if (pool) {
    pool.on("error", () => app.log.error("PostgreSQL idle connection failed"));
    app.addHook("onClose", async () => pool.end());
  }
  const redfoxCredentialStore = options.redfoxCredentialStore
    ?? (pool && options.config.xhsSessionEncryptionKey
      ? createPostgresRedfoxCredentialStore(pool, options.config.xhsSessionEncryptionKey)
      : undefined);
  await app.register(redfoxCredentialRoutes, {
    prefix: "/api/v1",
    store: redfoxCredentialStore,
    systemDefaultConfigured: Boolean(options.config.redfoxApiKey),
  });

  app.post("/api/v1/analytics/signup", async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: unknown };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId || userId.length > 200) return reply.code(400).send({ error: { code: "VALIDATION_INVALID_REQUEST", message: "用户标识不正确" } });
    void recordUsageEvent({ event: "signup_completed", userKey: hashIdentity(userId), module: "system", metadata: { method: "email" } });
    return { data: { ok: true } };
  });
  app.post("/api/v1/analytics/login", { preHandler: app.requireAuth }, async (request, reply) => {
    const userKey = request.auth?.userId ? hashIdentity(request.auth.userId) : undefined;
    if (!userKey) return reply.code(401).send({ error: { code: "AUTH_REQUIRED", message: "请先登录" } });
    void recordUsageEvent({ event: "api_request_completed", userKey, module: "system", endpoint: "/api/v1/analytics/login", status: "success", metadata: { authEvent: "login" } });
    return { data: { ok: true } };
  });  app.get("/api/v1/health", async (request) => ({
    data: { status: "ok", version: "0.1.0", time: new Date().toISOString() },
    meta: { request_id: request.id },
  }));

  // Liveness remains cheap. Readiness separately checks the database and core tables.
  app.get("/api/v1/ready", async (_request, reply) => {
    if (!pool) return reply.code(503).send({ data: { status: "not_ready" } });
    try {
      const result = await pool.query("select to_regclass('private.jobs') is not null and to_regclass('public.search_tasks') is not null and to_regclass('public.feedback_tickets') is not null as ready");
      if (!result.rows[0]?.ready) throw new Error("schema not ready");
      return { data: { status: "ready" } };
    } catch {
      return reply.code(503).send({ data: { status: "not_ready" } });
    }
  });

  await app.register(profileRoutes, {
    prefix: "/api/v1",
    repository: options.profileRepository ?? createProfileRepository(options.config),
  });
  await app.register(platformConnectionRoutes, {
    prefix: "/api/v1",
    service: xhsConnectionService,
    dataProvider: options.config.xhsDataProvider ?? "redfox",
  });
  await app.register(feedbackRoutes, {
    prefix: "/api/v1",
    repository: options.feedbackRepository ?? createFeedbackRepository(options.config),
  });
  if (pool) {
    const serviceClient = createSupabaseClient(options.config);
    await app.register(projectRoutes, { prefix: "/api/v1", client: serviceClient });
    await app.register(searchRoutes, { prefix: "/api/v1", client: serviceClient, pool });
    await app.register(creatorRoutes, { prefix: "/api/v1", client: serviceClient });
    await app.register(taskEventRoutes, { prefix: "/api/v1", client: serviceClient, pool });
    await app.register(knowledgeRoutes, { prefix: "/api/v1", client: serviceClient, pool });
    await app.register(auditRoutes, { prefix: "/api/v1", client: serviceClient, pool });
  } else {
    app.log.warn("DATABASE_URL 未配置：项目/检索/达人/SSE 路由未启用");
  }

  return app;
}

function createSupabaseClient(config: ServerConfig) {
  const key = config.supabaseServiceRoleKey ?? config.supabasePublishableKey;
  return createClient(config.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
