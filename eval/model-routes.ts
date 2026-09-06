import type { FastifyInstance } from "fastify";
import { getModelConfig, MODEL_PRESETS, providerStatus, saveModelConfig } from "../agent/model-config.js";
import { model } from "../agent/llm/model.js";

// A complete, valid 1x1 PNG used only when the connectivity test does not
// provide its own image. The previous value contained only a PNG signature,
// so multimodal providers correctly rejected it as an unsupported image.
export const VISION_TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function publicConfig() {
  const config = getModelConfig();
  const status = providerStatus();
  return {
    config: {
      text: config.text,
      vision: config.vision,
      planner: config.planner,
      visionFallbackEnabled: config.visionFallbackEnabled,
      updatedAt: config.updatedAt,
    },
    status,
    presets: MODEL_PRESETS,
    note: "API Key 只从服务端环境变量读取，页面不回显密钥原文。",
  };
}

export function registerModelRoutes(app: FastifyInstance): void {
  app.get("/api/model-config", async () => ({ data: publicConfig() }));
  app.put("/api/model-config", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      return { data: { ...publicConfig(), config: saveModelConfig(body as never) } };
    } catch (error) {
      return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } });
    }
  });
  app.post("/api/model-config/test", async (request, reply) => {
    const body = (request.body ?? {}) as { target?: "text" | "vision"; prompt?: string; image?: string };
    const target = body.target === "vision" ? "vision" : "text";
    const result = await model({
      system: "你是模型连通性测试器，只返回 JSON：{ok:true, message:string}。",
      prompt: body.prompt || "返回连通性测试结果。",
      images: target === "vision" ? [body.image || VISION_TEST_IMAGE] : undefined,
    });
    if (result.status === "error") {
      return reply.code(502).send({ data: { target, result, error: result.note || "模型请求失败" } });
    }
    return reply.send({ data: { target, result } });
  });
}
