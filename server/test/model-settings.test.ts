import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import type { AuthVerifier } from "../src/plugins/auth.js";
import { ModelProviderClient } from "../src/services/model-provider-service.js";
import {
  ModelApiKeyCipher,
  type ModelProviderId,
  type ModelProviderStatus,
  type ModelSettingsStore,
  type ResolvedModelSettings,
} from "../src/services/model-settings-service.js";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const config: ServerConfig = {
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "sb_publishable_test",
  host: "127.0.0.1",
  port: 3001,
  webOrigins: ["http://127.0.0.1:5173"],
};
const verifier: AuthVerifier = { async verify() { return { userId, email: "model@example.invalid" }; } };

function memoryStore(): ModelSettingsStore {
  const rows = new Map<ModelProviderId, ResolvedModelSettings & { fingerprint: string; updatedAt: string; active: boolean }>();
  const statuses = (): ModelProviderStatus[] => [...rows.values()].map((row) => ({
    provider: row.provider,
    configured: true,
    active: row.active,
    modelId: row.modelId,
    fingerprint: row.fingerprint,
    updatedAt: row.updatedAt,
  }));
  return {
    async status() { return statuses(); },
    async save(_owner, input) {
      const previous = rows.get(input.provider);
      if (!input.apiKey && !previous) throw new Error("MODEL_API_KEY_REQUIRED");
      for (const row of rows.values()) row.active = false;
      rows.set(input.provider, {
        provider: input.provider,
        modelId: input.modelId,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey ?? previous!.apiKey,
        fingerprint: "A1B2C3D4E5",
        updatedAt: "2026-09-10T00:00:00.000Z",
        active: true,
      });
      return statuses();
    },
    async resolve() {
      const found = [...rows.values()].find((row) => row.active);
      return found ? { provider: found.provider, modelId: found.modelId, baseUrl: found.baseUrl, apiKey: found.apiKey } : null;
    },
    async resolveKey(_owner, provider) { return rows.get(provider)?.apiKey ?? null; },
  };
}

test("model API keys use authenticated encryption scoped by user and provider", () => {
  const cipher = new ModelApiKeyCipher(Buffer.alloc(32, 7).toString("base64"));
  const encrypted = cipher.encrypt(userId, "anthropic", "sk-ant-secret-for-test");
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "sk-ant-secret-for-test");
  assert.equal(cipher.decrypt(userId, "anthropic", encrypted), "sk-ant-secret-for-test");
  assert.throws(() => cipher.decrypt(userId, "openai", encrypted));
  assert.throws(() => cipher.decrypt("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "anthropic", encrypted));
});

test("model settings require auth and never echo API keys", async () => {
  const store = memoryStore();
  const app = await buildApp({ config, authVerifier: verifier, modelSettingsStore: store });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/model-settings" })).statusCode, 401);
    const apiKey = "sk-openai-secret-for-test";
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/model-settings",
      headers: { authorization: "Bearer verified-token" },
      payload: { provider: "openai", model_id: "gpt-5.6-terra", api_key: apiKey },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().data.providers.find((item: any) => item.id === "openai").active, true);
    assert.ok(!saved.body.includes(apiKey));
    const status = await app.inject({ method: "GET", url: "/api/v1/model-settings", headers: { authorization: "Bearer verified-token" } });
    assert.equal(status.statusCode, 200);
    assert.ok(!status.body.includes(apiKey));
  } finally { await app.close(); }
});

test("model settings degrade safely when the additive migration is not applied", async () => {
  const missingTable = Object.assign(new Error("relation does not exist"), { code: "42P01" });
  const store: ModelSettingsStore = {
    async status() { throw missingTable; },
    async save() { throw missingTable; },
    async resolve() { throw missingTable; },
    async resolveKey() { throw missingTable; },
  };
  const app = await buildApp({ config, authVerifier: verifier, modelSettingsStore: store });
  try {
    const status = await app.inject({ method: "GET", url: "/api/v1/model-settings", headers: { authorization: "Bearer verified-token" } });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().meta.storage_available, false);
    assert.equal(status.json().data.providers.length, 5);
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/model-settings",
      headers: { authorization: "Bearer verified-token" },
      payload: { provider: "glm", model_id: "glm-5.2", api_key: "glm-test-key" },
    });
    assert.equal(saved.statusCode, 503);
    assert.equal(saved.json().error.code, "MODEL_SETTINGS_MIGRATION_REQUIRED");
  } finally { await app.close(); }
});

test("model settings reject a model id that belongs to another provider", async () => {
  const app = await buildApp({ config, authVerifier: verifier, modelSettingsStore: memoryStore() });
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/model-settings",
      headers: { authorization: "Bearer verified-token" },
      payload: { provider: "anthropic", model_id: "gpt-5.6-terra", api_key: "sk-ant-test-key" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "MODEL_PROVIDER_MISMATCH");
  } finally { await app.close(); }
});

test("model list refresh uses a temporary key without persisting or echoing it", async () => {
  const store = memoryStore();
  let authorization = "";
  const client = new ModelProviderClient(async (_input, init) => {
    authorization = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" }] }), { status: 200 });
  });
  const app = await buildApp({ config, authVerifier: verifier, modelSettingsStore: store, modelProviderClient: client });
  try {
    const apiKey = "temporary-deepseek-key";
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/model-settings/models",
      headers: { authorization: "Bearer verified-token" },
      payload: { provider: "deepseek", api_key: apiKey },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.models[0].id, "deepseek-v4-flash");
    assert.equal(authorization, `Bearer ${apiKey}`);
    assert.ok(!response.body.includes(apiKey));
    assert.equal(await store.resolveKey(userId, "deepseek"), null);
  } finally { await app.close(); }
});

test("GLM refresh requests the provider model endpoint and returns newly released models", async () => {
  const requests: Array<{ url: string; authorization: string; method: string }> = [];
  const client = new ModelProviderClient(async (input, init) => {
    requests.push({
      url: String(input),
      authorization: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
      method: String(init?.method ?? "GET"),
    });
    return Response.json({ data: [{ id: "glm-5.3-flash", object: "model", owned_by: "glm" }] });
  });

  const models = await client.list("glm", "glm-test-key");

  assert.deepEqual(models, [{ id: "glm-5.3-flash", name: "glm-5.3-flash" }]);
  assert.deepEqual(requests, [{
    url: "https://open.bigmodel.cn/api/paas/v4/models",
    authorization: "Bearer glm-test-key",
    method: "GET",
  }]);
});

test("every provider refreshes from its live model-list endpoint", async (t) => {
  const cases: Array<{
    provider: ModelProviderId;
    url: string;
    payload: unknown;
    expected: { id: string; name: string };
    apiKeyHeader: string;
  }> = [
    {
      provider: "anthropic",
      url: "https://api.anthropic.com/v1/models?limit=1000",
      payload: { data: [{ id: "claude-live", display_name: "Claude Live" }] },
      expected: { id: "claude-live", name: "Claude Live" },
      apiKeyHeader: "x-api-key",
    },
    {
      provider: "openai",
      url: "https://api.openai.com/v1/models",
      payload: { data: [{ id: "gpt-live" }] },
      expected: { id: "gpt-live", name: "gpt-live" },
      apiKeyHeader: "Authorization",
    },
    {
      provider: "deepseek",
      url: "https://api.deepseek.com/models",
      payload: { data: [{ id: "deepseek-live" }] },
      expected: { id: "deepseek-live", name: "deepseek-live" },
      apiKeyHeader: "Authorization",
    },
    {
      provider: "qwen",
      url: "https://dashscope.aliyuncs.com/api/v1/models?providers=qwen&capabilities=TG&page_no=1&page_size=200",
      payload: { output: { models: [{ model: "qwen-live", name: "Qwen Live" }] } },
      expected: { id: "qwen-live", name: "Qwen Live" },
      apiKeyHeader: "Authorization",
    },
    {
      provider: "glm",
      url: "https://open.bigmodel.cn/api/paas/v4/models",
      payload: { data: [{ id: "glm-live" }] },
      expected: { id: "glm-live", name: "glm-live" },
      apiKeyHeader: "Authorization",
    },
  ];

  for (const item of cases) {
    await t.test(item.provider, async () => {
      let requestUrl = "";
      let requestHeaders: Record<string, string> = {};
      const client = new ModelProviderClient(async (input, init) => {
        requestUrl = String(input);
        requestHeaders = init?.headers as Record<string, string>;
        return Response.json(item.payload);
      });

      const models = await client.list(item.provider, "live-api-key");

      assert.equal(requestUrl, item.url);
      assert.equal(requestHeaders[item.apiKeyHeader], item.apiKeyHeader === "Authorization" ? "Bearer live-api-key" : "live-api-key");
      assert.deepEqual(models, [item.expected]);
    });
  }
});

test("live refresh fails instead of keeping a stale hard-coded list", async () => {
  const client = new ModelProviderClient(async () => Response.json({ data: [] }));

  await assert.rejects(
    () => client.list("deepseek", "deepseek-test-key"),
    (error: any) => error?.code === "MODEL_PROVIDER_EMPTY_LIST",
  );
});

test("GLM connection test calls the selected model", async () => {
  let requestedBody = "";
  const client = new ModelProviderClient(async (_input, init) => {
    requestedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
  });
  await client.test("glm", "glm-5.2", "glm-test-key");
  assert.equal(JSON.parse(requestedBody).model, "glm-5.2");
});

test("connection test calls a DeepSeek vision model even when the models endpoint omits it", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const client = new ModelProviderClient(async (input, init) => {
    requests.push({ url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
  });

  await client.test("deepseek", "deepseek-v4-flash-vision-exp", "deepseek-test-key");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(requests[0].method, "POST");
  assert.equal(JSON.parse(requests[0].body).model, "deepseek-v4-flash-vision-exp");
});
