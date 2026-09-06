// Phase 3｜任务进度 SSE（/tasks/{taskId}/events）
// 事件源：private.job_events（pg 直连）；轮询增量推送，终态后关闭
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { ApiError } from "../errors.js";
import { getSearchTask, listJobEvents } from "../services/creator-search-service.js";

const POLL_INTERVAL_MS = 1_500;
const KEEP_ALIVE_INTERVAL_MS = 20_000;

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const taskEventRoutes: FastifyPluginAsync<{ client: SupabaseClient; pool: pg.Pool }> = async (app, options) => {
  app.get("/tasks/:taskId/events", { preHandler: app.requireAuth }, async (request, reply) => {
    const userId = requireUserId(request);
    const task = await getSearchTask(options.client, (request.params as Record<string, string>).taskId);
    if (!task || task.user_id !== userId) {
      throw new ApiError(404, "SEARCH_TASK_NOT_FOUND", "检索任务不存在或无权访问。", false);
    }
    if (task.status === "cancelled") {
      throw new ApiError(409, "SEARCH_TASK_CANCELLED", "任务已取消。", false);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: task.progress\ndata: ${JSON.stringify({ task_id: task.id, status: task.status, stage: "queued", terminal: task.terminal, progress: task.progress, message_code: task.message_code ?? null, occurred_at: new Date().toISOString() })}\n\n`);

    let afterSeq = 0;
    let lastAlive = Date.now();
    const timer = setInterval(async () => {
      try {
        const latest = await getSearchTask(options.client, task.id);
        if (!latest) {
          clearInterval(timer);
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "SEARCH_TASK_NOT_FOUND" })}\n\n`);
          reply.raw.end();
          return;
        }
        const events = await listJobEvents(options.pool, task.task_id, afterSeq);
        for (const event of events) {
          afterSeq = event.seq;
          reply.raw.write(
            `event: task.progress\ndata: ${JSON.stringify({
              seq: event.seq,
              task_id: task.id,
              status: event.status,
              stage: event.stage,
              terminal: event.terminal,
              progress: event.progress,
              message_code: event.message_code,
              error_code: event.error_code,
              occurred_at: event.occurred_at,
            })}\n\n`,
          );
        }
        if (events.some((event) => event.terminal)) {
          clearInterval(timer);
          reply.raw.end();
          return;
        }
        if (Date.now() - lastAlive > KEEP_ALIVE_INTERVAL_MS) {
          reply.raw.write(": keep-alive\n\n");
          lastAlive = Date.now();
        }
      } catch (error) {
        clearInterval(timer);
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: "SSE_POLL_FAILED", message: error instanceof Error ? error.message : "poll failed" })}\n\n`);
        reply.raw.end();
      }
    }, POLL_INTERVAL_MS);

    request.raw.on("close", () => clearInterval(timer));
    return reply;
  });
};
