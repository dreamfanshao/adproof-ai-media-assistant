import React from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../src/components/ui";
import { ModelSettingsPanel } from "../../src/pages/model-settings-page";
import "../../src/styles.css";

const definitions = [
  ["anthropic", "Claude (Anthropic)", "Claude", "https://api.anthropic.com/v1", "claude-sonnet-5"],
  ["openai", "ChatGPT (OpenAI)", "ChatGPT", "https://api.openai.com/v1", "gpt-5.6-terra"],
  ["deepseek", "DeepSeek", "DeepSeek", "https://api.deepseek.com", "deepseek-v4-flash"],
  ["qwen", "通义千问 (Qwen)", "Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.8-flash"],
  ["glm", "智谱 GLM", "GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-5.2"],
] as const;

let providers = definitions.map(([id, name, short_name, base_url, default_model]) => ({
  id, name, short_name, base_url, default_model,
  models: [{ id: default_model, name: default_model }],
  configured: id === "anthropic",
  active: id === "anthropic",
  model_id: id === "anthropic" ? default_model : null,
  fingerprint: id === "anthropic" ? "D8C742A1F0" : null,
  updated_at: id === "anthropic" ? "2026-09-10T00:00:00.000Z" : null,
}));

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.endsWith("/model-settings") && (!init?.method || init.method === "GET")) {
    return Response.json({ data: { providers }, meta: { storage_available: true } });
  }
  if (url.endsWith("/model-settings/models")) {
    const models = body.provider === "deepseek"
      ? [{ id: "deepseek-flash", name: "DeepSeek V4.1 Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }]
      : providers.find((item) => item.id === body.provider)?.models ?? [];
    return Response.json({ data: { provider: body.provider, models } });
  }
  if (url.endsWith("/model-settings/test")) {
    return Response.json({ data: { connected: true, provider: body.provider, model_id: body.model_id } });
  }
  if (url.endsWith("/model-settings") && init?.method === "PUT") {
    providers = providers.map((item) => ({
      ...item,
      active: item.id === body.provider,
      configured: item.id === body.provider ? true : item.configured,
      model_id: item.id === body.provider ? body.model_id : item.model_id,
      fingerprint: item.id === body.provider ? "A1B2C3D4E5" : item.fingerprint,
      updated_at: item.id === body.provider ? "2026-09-10T01:00:00.000Z" : item.updated_at,
    }));
    return Response.json({ data: { providers } });
  }
  return Response.json({ error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 });
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Modal open title="模型与 API Key" titleNote="请选择支持视觉能力的模型" onClose={() => undefined} className="modal--model-settings">
      <ModelSettingsPanel accessToken="fixture-token" onAuthExpired={() => undefined} />
    </Modal>
  </React.StrictMode>,
);
