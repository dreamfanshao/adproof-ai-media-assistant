import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError, apiRequest } from "../../src/lib/api-client.js";

async function withFetch(response: Response, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("apiRequest converts an empty proxy response into a structured Chinese error", async () => {
  await withFetch(new Response("", { status: 502 }), async () => {
    await assert.rejects(
      () => apiRequest("/projects", "test-token"),
      (error: unknown) => error instanceof ApiClientError
        && error.code === "API_EMPTY_RESPONSE"
        && error.retryable
        && /API 服务未返回数据/.test(error.message),
    );
  });
});

test("apiRequest reports invalid JSON without exposing the browser parser exception", async () => {
  await withFetch(new Response("upstream disconnected", { status: 502 }), async () => {
    await assert.rejects(
      () => apiRequest("/projects", "test-token"),
      (error: unknown) => error instanceof ApiClientError
        && error.code === "API_INVALID_RESPONSE"
        && /无法解析/.test(error.message),
    );
  });
});

test("apiRequest preserves structured API errors", async () => {
  await withFetch(new Response(JSON.stringify({ error: { code: "SEARCH_TASK_ACTIVE", message: "已有任务正在执行", retryable: false } }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  }), async () => {
    await assert.rejects(
      () => apiRequest("/projects/project-1/search-tasks", "test-token"),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 409
        && error.code === "SEARCH_TASK_ACTIVE"
        && error.message === "已有任务正在执行",
    );
  });
});
