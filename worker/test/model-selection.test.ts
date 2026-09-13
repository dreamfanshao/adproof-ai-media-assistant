import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.ADPROOF_ANALYTICS_DIR = join(tmpdir(), `adproof-model-test-${process.pid}`);

test("runtime vision detection distinguishes GLM multimodal and text-only models", async () => {
  const { modelSupportsVision } = await import("../../agent/llm/runtime-model-settings.js");

  assert.equal(modelSupportsVision("glm", "glm-5.3-flash"), true);
  assert.equal(modelSupportsVision("glm", "glm-5v-turbo"), true);
  assert.equal(modelSupportsVision("glm", "glm-4.6v-flash"), true);
  assert.equal(modelSupportsVision("glm", "glm-5.2"), false);
  assert.equal(modelSupportsVision("glm", "glm-5-turbo"), false);
});

test("per-user Claude settings use the Anthropic protocol without exposing the key in the body", async () => {
  const { model } = await import("../../agent/llm/model.js");
  const { withRuntimeModelSettings } = await import("../../agent/llm/runtime-model-settings.js");
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: Headers | null = null;
  let requestedBody = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    requestedBody = String(init?.body ?? "");
    return Response.json({ content: [{ type: "text", text: "{\"approved\":true}" }] });
  };
  try {
    const result = await withRuntimeModelSettings({
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-runtime-test",
    }, () => model({ system: "Return JSON.", prompt: "Check this", maxTokens: 20 }));
    assert.equal(result.status, "scored");
    assert.deepEqual(result.data, { approved: true });
    assert.equal(requestedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(requestedHeaders?.get("x-api-key"), "sk-ant-runtime-test");
    assert.equal(requestedHeaders?.get("anthropic-version"), "2023-06-01");
    assert.ok(!requestedBody.includes("sk-ant-runtime-test"));
    assert.equal(JSON.parse(requestedBody).model, "claude-sonnet-5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("per-user OpenAI-compatible settings are isolated by async job context", async () => {
  const { model } = await import("../../agent/llm/model.js");
  const { withRuntimeModelSettings } = await import("../../agent/llm/runtime-model-settings.js");
  const originalFetch = globalThis.fetch;
  const seen = new Map<string, string>();
  globalThis.fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    seen.set(payload.model, new Headers(init?.headers).get("Authorization") ?? "");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ model: payload.model }) } }] });
  };
  try {
    const [deepseek, glm] = await Promise.all([
      withRuntimeModelSettings({ provider: "deepseek", modelId: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", apiKey: "deepseek-key" }, () => model({ system: "JSON", prompt: "one" })),
      withRuntimeModelSettings({ provider: "glm", modelId: "glm-5.2", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "glm-key" }, () => model({ system: "JSON", prompt: "two" })),
    ]);
    assert.deepEqual(deepseek.data, { model: "deepseek-v4-flash" });
    assert.deepEqual(glm.data, { model: "glm-5.2" });
    assert.equal(seen.get("deepseek-v4-flash"), "Bearer deepseek-key");
    assert.equal(seen.get("glm-5.2"), "Bearer glm-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
