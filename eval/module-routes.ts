import type { FastifyInstance } from "fastify";
import type { SkillDefinition } from "../agent/skills/types.js";
import { deleteModuleCase } from "./module-store.js";
import {
  batchWithRuns, compareBatches, createBatch, ensureModuleCases, executeBatch, getCaseRunState, listCases,
  moduleOverview, saveCase, startCaseRun,
} from "./module-eval.js";
import {
  listSkillVersions, moduleAdminOverview, restoreSkillVersion, skillVersionDiff, updateModuleSkill,
} from "./module-admin.js";
import type { ProductModule } from "./module-types.js";
import { getPlannerConfig, savePlannerConfig } from "./module-planner-store.js";

function productModule(value: string | undefined): ProductModule | null {
  return value === "creators" || value === "audit" ? value : null;
}

export function registerModuleRoutes(app: FastifyInstance): void {
  ensureModuleCases();

  app.get("/api/modules", async () => ({
    data: {
      modules: (["creators", "audit"] as ProductModule[]).map((module) => {
        const overview = moduleOverview(module);
        return {
          id: module,
          name: module === "creators" ? "达人检索" : "内容审核",
          cases: overview.cases.length,
          enabledCases: overview.enabledCases.length,
          batches: overview.batches.length,
          latestBatch: overview.latestBatch,
        };
      }),
    },
  }));

  app.get("/api/module-planner/:module", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: getPlannerConfig(module) };
  });

  app.put("/api/module-planner/:module", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try { return { data: savePlannerConfig(module, (request.body ?? {}) as never) }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.get("/api/module-admin/:module", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: moduleAdminOverview(module) };
  });

  app.patch("/api/module-admin/:module/skills/:id", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try {
      const body = (request.body ?? {}) as Record<string, unknown> & { changeNote?: string };
      return { data: updateModuleSkill(module, params.id, body as Partial<SkillDefinition>, body.changeNote ?? "") };
    } catch (error) {
      return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  app.get("/api/module-admin/:module/skills/:id/versions", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try { return { data: { versions: listSkillVersions(module, params.id) } }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.get("/api/module-admin/:module/skills/:id/versions/:versionId/diff", async (request, reply) => {
    const params = request.params as { module: string; id: string; versionId: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try { return { data: { diff: skillVersionDiff(module, params.id, params.versionId) } }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.post("/api/module-admin/:module/skills/:id/versions/:versionId/restore", async (request, reply) => {
    const params = request.params as { module: string; id: string; versionId: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try { return { data: restoreSkillVersion(module, params.id, params.versionId) }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.get("/api/module-eval/:module", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: moduleOverview(module) };
  });

  app.post("/api/module-eval/:module/cases", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!body.id || !body.name || !body.question) return reply.code(400).send({ data: { error: "id、name、question 为必填项" } });
    try { return reply.code(201).send({ data: { case: saveCase(module, body as never) } }); }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.patch("/api/module-eval/:module/cases/:id", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const current = listCases(module).find((item) => item.id === params.id);
    if (!current) return reply.code(404).send({ data: { error: "评测用例不存在" } });
    try { return { data: { case: saveCase(module, { ...current, ...(request.body as object), id: params.id }) } }; }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.delete("/api/module-eval/:module/cases/:id", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    if (!deleteModuleCase(params.id, module)) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: { ok: true } };
  });

  app.post("/api/module-eval/:module/cases/:id/run", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try { return reply.code(202).send({ data: { execution: startCaseRun(module, params.id) } }); }
    catch (error) { return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } }); }
  });

  app.get("/api/module-eval/:module/cases/:id/run-state", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const execution = getCaseRunState(module, params.id);
    if (!execution) return reply.code(404).send({ data: { error: "该用例没有正在执行或刚完成的测试" } });
    return { data: { execution } };
  });

  app.post("/api/module-eval/:module/batches", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    try {
      const body = (request.body ?? {}) as { name?: string; versionLabel?: string; changeNote?: string; caseIds?: string[] };
      const batch = createBatch(module, { ...body, caseIdsProvided: Object.prototype.hasOwnProperty.call(body, "caseIds") });
      void executeBatch(module, batch.id);
      return reply.code(202).send({ data: { batch } });
    } catch (error) {
      return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  app.get("/api/module-eval/:module/batches/:id", async (request, reply) => {
    const params = request.params as { module: string; id: string };
    const module = productModule(params.module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const result = batchWithRuns(module, params.id);
    if (!result) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: result };
  });

  app.get("/api/module-eval/:module/compare", async (request, reply) => {
    const module = productModule((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const query = request.query as { left?: string; right?: string };
    if (!query.left || !query.right) return reply.code(400).send({ data: { error: "left、right 批次 ID 必填" } });
    const result = compareBatches(module, query.left, query.right);
    if (!result) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    return { data: result };
  });
  // 与 SnackOps 评测契约兼容的批次别名：默认达人检索，仍复用同一执行链。
  app.post("/api/eval/batch/run", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { module?: string; name?: string; versionLabel?: string; changeNote?: string; caseIds?: string[] };
      const module = productModule(body.module) ?? "creators";
      const batch = createBatch(module, { ...body, caseIdsProvided: Object.prototype.hasOwnProperty.call(body, "caseIds") });
      void executeBatch(module, batch.id);
      return reply.code(202).send({ data: { batchId: batch.id, batch, module } });
    } catch (error) {
      return reply.code(400).send({ data: { error: error instanceof Error ? error.message : String(error) } });
    }
  });

  app.get("/api/eval/batch/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { module?: string };
    const module = productModule(query.module) ?? "creators";
    const result = batchWithRuns(module, params.id);
    if (!result) return reply.code(404).send({ data: { error: "评测批次不存在" } });
    return { data: { ...result, batchId: params.id, module } };
  });
}


