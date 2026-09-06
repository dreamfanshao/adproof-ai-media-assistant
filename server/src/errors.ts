import type { FastifyInstance } from "fastify";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function registerErrorHandlers(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { code: "RESOURCE_NOT_FOUND", message: "请求的资源不存在。", retryable: false },
      meta: { request_id: request.id },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
            const retryAfter = error.details?.retryAfterSeconds;
      if (typeof retryAfter === "number") reply.header("Retry-After", String(Math.max(1, Math.ceil(retryAfter))));
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}),
        },
        meta: { request_id: request.id },
      });
    }

    const candidateStatus = typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
    const statusCode = candidateStatus === 429 ? 429 : 500;
    if (statusCode === 500) request.log.error({ err: error }, "Unhandled API error");
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR",
        message: statusCode === 429 ? "请求过于频繁，请稍后重试。" : "服务暂时不可用。",
        retryable: true,
      },
      meta: { request_id: request.id },
    });
  });
}
