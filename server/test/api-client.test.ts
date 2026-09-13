import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError, apiRequest, configureApiAuthRecovery } from "../../src/lib/api-client.js";

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

test("apiRequest refreshes the session once and retries a 401 response", async () => {
  const authorizationHeaders: string[] = [];
  let refreshCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
    if (authorizationHeaders.length === 1) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "登录已过期" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  configureApiAuthRecovery(async () => {
    refreshCount += 1;
    return "fresh-token";
  });

  try {
    const response = await apiRequest<{ data: { ok: boolean } }>("/projects", "expired-token");
    assert.equal(response.data.ok, true);
    assert.equal(refreshCount, 1);
    assert.deepEqual(authorizationHeaders, ["Bearer expired-token", "Bearer fresh-token"]);
  } finally {
    configureApiAuthRecovery(null);
    globalThis.fetch = originalFetch;
  }
});

test("concurrent 401 responses share one token refresh", async () => {
  let refreshCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization");
    return authorization === "Bearer fresh-token"
      ? new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
  };
  configureApiAuthRecovery(async () => {
    refreshCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "fresh-token";
  });

  try {
    const responses = await Promise.all([
      apiRequest<{ data: { ok: boolean } }>("/projects", "expired-token"),
      apiRequest<{ data: { ok: boolean } }>("/search-tasks/task-1", "expired-token"),
      apiRequest<{ data: { ok: boolean } }>("/me", "expired-token"),
    ]);
    assert.equal(refreshCount, 1);
    assert.ok(responses.every((response) => response.data.ok));
  } finally {
    configureApiAuthRecovery(null);
    globalThis.fetch = originalFetch;
  }
});

test("apiRequest preserves the final 401 when session refresh fails", async () => {
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "登录已过期" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };
  configureApiAuthRecovery(async () => null);

  try {
    await assert.rejects(
      () => apiRequest("/projects", "expired-token"),
      (error: unknown) => error instanceof ApiClientError && error.status === 401,
    );
    assert.equal(requestCount, 1);
  } finally {
    configureApiAuthRecovery(null);
    globalThis.fetch = originalFetch;
  }
});
