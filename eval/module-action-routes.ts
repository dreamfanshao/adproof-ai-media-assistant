import type { FastifyInstance } from "fastify";
import { previewModulePlan, testModuleTool } from "./module-admin-actions.js";
import type { ProductModule } from "./module-types.js";

function moduleOf(value: string): ProductModule | null {
  return value === "creators" || value === "audit" ? value : null;
}

export function registerModuleActionRoutes(app: FastifyInstance): void {
  app.post("/api/module-admin/:module/planner/preview", async (request, reply) => {
    const module = moduleOf((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const question = String((request.body as { question?: string } | undefined)?.question ?? "").trim();
    if (!question) return reply.code(400).send({ data: { error: "question 必填" } });
    try { return { data: await previewModulePlan(module, question) }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.post("/api/module-admin/:module/tools/:id/test", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = moduleOf(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? body.input as Record<string, unknown>
        : body;
      return { data: testModuleTool(module, params.id, input) };
    }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });
}
