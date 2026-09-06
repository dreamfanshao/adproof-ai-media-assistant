import assert from "node:assert/strict";
import test from "node:test";
import { pipelineFor } from "../../agent/capability-manifest.js";
import { getSkills, tools } from "../../agent/catalog.js";
import { getModelConfig } from "../../agent/model-config.js";
import { previewModulePlan, testModuleTool } from "../module-admin-actions.js";
import { ensureModuleCases, MODULE_EVALUATOR_VERSION, moduleOverview, validateModuleCaseDraft } from "../module-eval.js";
import { VISION_TEST_IMAGE } from "../model-routes.js";
import { getPlannerConfig, looksCorruptPlannerText } from "../module-planner-store.js";

test("runtime capability manifests resolve to one enabled Skill/Tool registry", () => {
  const skills = getSkills();
  const skillIds = new Set(skills.map((item) => item.id));
  const toolIds = new Set(tools.map((item) => item.id));
  assert.equal(skills.filter((item) => item.id.startsWith("creator_")).length, 13);
  assert.equal(skills.filter((item) => item.id.startsWith("audit_")).length, 10);
  for (const module of ["creators", "audit"] as const) {
    for (const capability of pipelineFor(module)) {
      assert.ok(
        capability.capabilityType === "skill" ? skillIds.has(capability.id) : toolIds.has(capability.id),
        `${module} runtime capability is not registered: ${capability.id}`,
      );
    }
  }
});

test("planner configuration repairs corrupt text and mirrors the actual model route", () => {
  const runtimeModel = getModelConfig().text;
  for (const module of ["creators", "audit"] as const) {
    const config = getPlannerConfig(module);
    assert.equal(looksCorruptPlannerText(config.systemPrompt), false);
    assert.equal(config.model.provider, runtimeModel.provider);
    assert.equal(config.model.model, runtimeModel.model);
    assert.ok(config.mandatorySkills.length >= 7);
    assert.ok(Object.keys(config.toolGroups).every((name) => !looksCorruptPlannerText(name)));
  }
  const creatorPlanner = getPlannerConfig("creators");
  assert.deepEqual(
    { temperature: creatorPlanner.model.temperature, maxTokens: creatorPlanner.model.maxTokens },
    getModelConfig().planner,
  );
  const auditPlanner = getPlannerConfig("audit");
  assert.equal(auditPlanner.model.temperature, 0);
  assert.equal(auditPlanner.model.maxTokens, 0);
});

test("planner preview is a production manifest mirror and never fabricates RedFox candidates", async () => {
  for (const module of ["creators", "audit"] as const) {
    const preview = await previewModulePlan(module, "运行时能力一致性自测");
    assert.equal(preview.runtimeSource, "production-runtime-manifest");
    assert.equal(preview.testMode, "runtime_manifest_validation");
    assert.equal(preview.modelCalled, false);
    assert.equal(preview.redfoxCalled, false);
    assert.equal(preview.databaseWritten, false);
    assert.equal(preview.valid, true, JSON.stringify(preview.validationErrors));
    assert.equal(JSON.stringify(preview).includes("console-c-"), false);
    assert.equal(preview.plan.steps.length, preview.runtimePipeline.filter((item) => item.enabled).length);
  }
});

test("RedFox Tool admin test validates contracts without consuming provider calls", () => {
  const result = testModuleTool("creators", "redfox_search_notes", {});
  assert.equal(result.status, "completed");
  assert.equal(result.testMode, "contract_validation");
  assert.equal(result.externalServiceCalled, false);
  assert.equal(result.databaseWritten, false);
  assert.deepEqual(result.output, {
    mode: "contract_validation",
    providerCalled: false,
    required: ["keywords", "cursor", "pageBudget"],
    note: "真实调用由生产 Worker 的 RedfoxXhsClient 执行；管理页测试不会消耗 RedFox。",
  });
});

test("local Tool admin test executes deterministic server logic", () => {
  const result = testModuleTool("creators", "dedupe_candidates", {
    candidates: [{ id: "same", matchScore: 70 }, { id: "same", matchScore: 90 }, { id: "unique", matchScore: 80 }],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.testMode, "local_execution");
  assert.equal(result.externalServiceCalled, false);
  assert.deepEqual(result.output, {
    before: 3,
    after: 2,
    candidates: [{ id: "same", matchScore: 70 }, { id: "unique", matchScore: 80 }],
  });
});

test("current Eval cases are readable and routed to real system data", () => {
  const cases = ensureModuleCases();
  const serialized = JSON.stringify(cases);
  assert.equal(/Rnote|\?{3,}|[銆锛鏁浜鎰璇绾妫鍛鏈閫鎵鐢娴绉缁]/.test(serialized), false);
  const creatorCases = cases.filter((item) => item.module === "creators");
  const creatorSeeds = creatorCases.filter((item) => item.source === "seed");
  assert.equal(creatorSeeds.length, 13);
  assert.equal(creatorSeeds.filter((item) => item.enabled).length, 11);
  assert.ok(creatorSeeds.every((item) => item.dataSource === "redfox"));
  assert.ok(creatorSeeds.every((item) => Number.isInteger(item.minimumPersistedCount)));
  const coveredCapabilities = new Set(creatorSeeds.flatMap((item) => item.requiredCapabilities));
  for (const skill of getSkills().filter((item) => item.id.startsWith("creator_"))) {
    assert.ok(coveredCapabilities.has(skill.id), `creator Eval suite does not cover Skill: ${skill.id}`);
  }
  const creatorOverview = moduleOverview("creators");
  assert.equal(creatorOverview.dataSource, "redfox");
  assert.equal(creatorOverview.productionDataSource, "redfox");
  assert.ok(creatorOverview.batches.every((item) => item.evaluatorVersion === MODULE_EVALUATOR_VERSION));
});

test("manual Eval cases reject numeric placeholders and missing expectations", () => {
  assert.throws(
    () => validateModuleCaseDraft({ id: "2", name: "11", question: "1", expectedBehavior: [] }),
    /用例 ID/,
  );
  assert.throws(
    () => validateModuleCaseDraft({ id: "creator-manual-01", name: "手工用例", question: "找医美达人", expectedBehavior: [] }),
    /测试问题|期望行为/,
  );
  assert.doesNotThrow(() => validateModuleCaseDraft({
    id: "creator-manual-01",
    name: "手工达人回归",
    question: "找有本人光子嫩肤经历的个人博主",
    expectedBehavior: ["排除机构账号", "返回可追溯的笔记证据"],
    minimumPersistedCount: 20,
  }));
});

test("vision connectivity test uses a complete PNG fallback image", () => {
  const [metadata, payload] = VISION_TEST_IMAGE.split(",", 2);
  assert.equal(metadata, "data:image/png;base64");
  const image = Buffer.from(payload, "base64");
  assert.ok(image.length > 32);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
