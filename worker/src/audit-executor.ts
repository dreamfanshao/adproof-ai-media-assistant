// T08 Phase 3｜内容审核执行器（content_audit）：检索规则库 → 规则匹配 v1 → 风险项 → overall_risk 合成 → 快照
// LLM 结果仅作为辅助证据，最终风险仍由代码合成并保留人工复核入口。
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { runContentAuditAgent, type AuditAgentFinding } from "../../agent/content-audit-agent.js";
import { AUDIT_RULES } from "../../server/src/services/audit-rules.js";
import { finishJob, type SearchJob, type WorkerEnv } from "./xhs-db.js";

interface AuditPayload {
  audit_task_id: string;
}

const RISK_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, needs_confirmation: 2 };

export async function runContentAuditJob(
  env: WorkerEnv,
  client: SupabaseClient,
  pool: pg.Pool,
  job: SearchJob,
): Promise<void> {
  const payload = job.payload as unknown as AuditPayload;
  const taskId = payload.audit_task_id;

  const fail = async (code: string, message: string): Promise<void> => {
    await client.from("audit_tasks").update({ status: "failed", error_code: code, message_code: "AUDIT_FAILED", updated_at: new Date().toISOString() }).eq("id", taskId);
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "analyzing", terminal: true, progress: 100, messageCode: "AUDIT_FAILED", errorCode: code, errorMessage: message });
  };

  try {
    const { data: task } = await client.from("audit_tasks").select("*").eq("id", taskId).maybeSingle();
    if (!task) {
      await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "queued", terminal: true, progress: 100, messageCode: "AUDIT_TASK_NOT_FOUND" });
      return;
    }
    await client.from("audit_tasks").update({ status: "retrieving", message_code: "AUDIT_RETRIEVING", updated_at: new Date().toISOString() }).eq("id", taskId);

    // 1. 检索语料：公共广告法 + 所选私有知识库（带版本与名称，快照用）
    const { data: publicKb } = await client.from("knowledge_bases").select("id,version,name").eq("scope", "public_law").maybeSingle();
    const privateIds = (task.private_knowledge_base_ids as string[] | null) ?? [];
    const { data: privateKbs } = privateIds.length
      ? await client.from("knowledge_bases").select("id,version,name").in("id", privateIds).eq("user_id", job.user_id)
      : { data: [] as Array<Record<string, unknown>> };
    const kbs = [{ id: publicKb?.id as string | undefined, version: (publicKb?.version as number | undefined) ?? 1, name: (publicKb?.name as string | undefined) ?? "", scope: "public_law" as const }, ...(privateKbs ?? []).map((kb) => ({ id: kb.id as string, version: (kb.version as number) ?? 1, name: kb.name as string, scope: "private" as const }))].filter((kb) => kb.id);
    const kbIds = kbs.map((kb) => kb.id) as string[];
    const { data: chunks } = await client
      .from("knowledge_chunks")
      .select("id,knowledge_base_id,document_id,document_version,content,source_locator")
      .in("knowledge_base_id", kbIds);

    // 2. 规则匹配（title + body）
    const text = `${task.title as string}\n${task.body as string}`;
    const findings: Array<Record<string, unknown>> = [];
    const usedChunks = new Map<string, { kbId: string; kbVersion: number; scope: string; documentId: string; documentVersion: number }>();
    for (const rule of AUDIT_RULES) {
      const match = text.match(rule.pattern);
      if (!match) continue;
      const lawRefKey = rule.lawRef.split("/")[0];
      const lawChunk = (chunks ?? []).find((c) => String(c.source_locator).includes(lawRefKey));
      if (!lawChunk) continue;
      const kb = kbs.find((k) => k.id === lawChunk.knowledge_base_id);
      if (!kb) continue;
      const key = `${lawChunk.id}`;
      usedChunks.set(key, { kbId: kb.id as string, kbVersion: kb.version, scope: kb.scope, documentId: lawChunk.document_id as string, documentVersion: lawChunk.document_version as number });
      const start = Math.max(0, (match.index ?? 0) - 20);
      findings.push({
        user_id: job.user_id,
        audit_task_id: taskId,
        risk_level: rule.riskLevel,
        category: rule.category,
        location: { source: "title_body", excerpt: text.slice(start, start + 60) },
        source_scope: kb.scope,
        knowledge_base_id: kb.id,
        knowledge_base_version: kb.version,
        document_id: lawChunk.document_id,
        document_version: lawChunk.document_version,
        chunk_id: lawChunk.id,
        source_document: "广告法核心条款",
        source_locator: lawChunk.source_locator as string,
        source_excerpt: String(lawChunk.content).slice(0, 500),
        source_url: null,
        explanation: `正文命中规则「${rule.category}」：${match[0]}`,
        suggestion: rule.suggestion,
        confidence: rule.confidence,
      });
    }

    // 3. 图片资产：无 OCR 时进入覆盖警告
    const { data: assets } = await client.from("audit_assets").select("id,file_name,storage_path").eq("audit_task_id", taskId).eq("user_id", job.user_id);
    const assetUrls: string[] = [];
    for (const asset of assets ?? []) {
      const signed = await client.storage.from("audit-assets").createSignedUrl(String(asset.storage_path), 600);
      if (signed.data?.signedUrl) assetUrls.push(signed.data.signedUrl);
    }
    const hasImages = (assets ?? []).length > 0;
    const coverageWarnings: Array<Record<string, unknown>> = [];
    if ((chunks ?? []).length === 0) {
      coverageWarnings.push({ user_id: job.user_id, audit_task_id: taskId, code: "KNOWLEDGE_COVERAGE_LIMITED", message: "未检索到可用规则文档，覆盖有限。" });
    }

    const chunkRows = (chunks ?? []) as Array<Record<string, unknown>>;
    const auditAgent = await runContentAuditAgent({
      title: String(task.title ?? ""),
      body: String(task.body ?? ""),
      requirements: task.requirements ? String(task.requirements) : null,
      knowledgeChunks: chunkRows.map((chunk) => ({
        id: String(chunk.id), content: String(chunk.content ?? ""), source_locator: String(chunk.source_locator ?? ""),
        knowledge_base_id: String(chunk.knowledge_base_id ?? ""), document_id: String(chunk.document_id ?? ""), document_version: Number(chunk.document_version ?? 1),
      })),
      deterministicFindings: findings.map((finding) => ({
        category: String(finding.category), riskLevel: finding.risk_level as AuditAgentFinding["riskLevel"],
        excerpt: String((finding.location as { excerpt?: string } | undefined)?.excerpt ?? ""), sourceChunkId: String(finding.chunk_id),
        sourceLocator: String(finding.source_locator), explanation: String(finding.explanation), suggestion: String(finding.suggestion), confidence: Number(finding.confidence),
      })),
      coverageWarnings: coverageWarnings.map((warning) => ({ code: String(warning.code), message: String(warning.message) })),
      assetUrls,
    });
    if (hasImages && (assetUrls.length !== (assets ?? []).length || auditAgent.status !== "scored")) {
      coverageWarnings.push({
        user_id: job.user_id,
        audit_task_id: taskId,
        code: "IMAGE_TEXT_EXTRACTION_FAILED",
        message: "图片文字与视觉表达未完成可靠分析，请在人工复核中检查图片内容。",
      });
    }
    for (const agentFinding of auditAgent.findings) {
      const chunk = chunkRows.find((item) => String(item.id) === String(agentFinding.sourceChunkId) || String(item.source_locator) === String(agentFinding.sourceLocator));
      const kb = chunk ? kbs.find((item) => String(item.id) === String(chunk.knowledge_base_id)) : undefined;
      if (!chunk || !kb || !agentFinding.category || !agentFinding.explanation || !agentFinding.suggestion) continue;
      const duplicate = findings.some((item) => String(item.chunk_id) === String(chunk.id) && String(item.category) === String(agentFinding.category));
      if (duplicate) continue;
      usedChunks.set(String(chunk.id), {
        kbId: String(kb.id),
        kbVersion: Number(kb.version),
        scope: String(kb.scope),
        documentId: String(chunk.document_id),
        documentVersion: Number(chunk.document_version),
      });
      findings.push({
        user_id: job.user_id, audit_task_id: taskId, risk_level: agentFinding.riskLevel || "needs_confirmation", category: agentFinding.category,
        location: { source: "agent", excerpt: agentFinding.excerpt || String(task.body ?? "").slice(0, 120) }, source_scope: kb.scope,
        knowledge_base_id: kb.id, knowledge_base_version: kb.version, document_id: chunk.document_id, document_version: chunk.document_version,
        chunk_id: chunk.id, source_document: "knowledge semantic review", source_locator: String(chunk.source_locator), source_excerpt: String(chunk.content).slice(0, 500), source_url: null,
        explanation: agentFinding.explanation.slice(0, 3000), suggestion: agentFinding.suggestion.slice(0, 3000), confidence: Math.max(0, Math.min(1, Number(agentFinding.confidence ?? 0.5))),
      });
    }
    // 4. 先写快照（触发器要求发现项必须在快照内），再写发现项
    const snapshotRows: Array<Record<string, unknown>> = [];
    const usedByKb = new Map<string, Set<string>>(); // kbId -> document_id:version
    for (const info of usedChunks.values()) {
      const key = `${info.kbId}`;
      if (!usedByKb.has(key)) usedByKb.set(key, new Set());
      usedByKb.get(key)!.add(`${info.documentId}:${info.documentVersion}`);
    }
    for (const kb of kbs) {
      const docs = usedByKb.get(kb.id as string);
      if (!docs || docs.size === 0) continue;
      const kbUsed = kbs.find((k) => k.id === kb.id)!;
      snapshotRows.push({
        user_id: job.user_id,
        audit_task_id: taskId,
        knowledge_base_id: kb.id,
        scope: kbUsed.scope,
        name: kbUsed.name,
        knowledge_base_version: kbUsed.version,
        document_versions: Array.from(docs).map((d) => {
          const [documentId, version] = d.split(":");
          return { document_id: documentId, version };
        }),
      });
    }
    if (snapshotRows.length) {
      const { error: snapshotError } = await client.from("audit_knowledge_snapshots").insert(snapshotRows);
      if (snapshotError) throw new Error(`insert snapshots: ${snapshotError.message}`);
    }

    if (findings.length) {
      const { error: findingsError } = await client.from("audit_findings").insert(findings);
      if (findingsError) throw new Error(`insert findings: ${findingsError.message}`);
    }
    if (coverageWarnings.length) {
      const { error: warningError } = await client.from("audit_coverage_warnings").insert(coverageWarnings);
      if (warningError) throw new Error(`insert warnings: ${warningError.message}`);
    }

    // 6. overall_risk 合成（代码）：最高风险 + 覆盖/置信度兜底
    const riskCounts = { high: 0, medium: 0, low: 0, needs_confirmation: 0 };
    for (const f of findings) riskCounts[f.risk_level as keyof typeof riskCounts] += 1;
    const ordered = ["high", "medium", "needs_confirmation", "low"] as const;
    let overallRisk: string = ordered.find((level) => riskCounts[level] > 0) ?? "low";
    const lowConfidence = findings.some((f) => Number(f.confidence) < 0.8);
    const coverageLimited = coverageWarnings.length > 0;
    if (overallRisk === "low" && (lowConfidence || coverageLimited)) overallRisk = "needs_confirmation";
    if (overallRisk === "medium" && (lowConfidence || coverageLimited)) overallRisk = "needs_confirmation";
    const agentRisk = String(auditAgent.decision.overallRisk);
    if ((RISK_ORDER[agentRisk] ?? 0) > (RISK_ORDER[overallRisk] ?? 0)) overallRisk = agentRisk;
    const recommendedAction = auditAgent.decision.recommendedAction || (overallRisk === "high" ? "修改后重新提交审核" : overallRisk === "medium" || overallRisk === "needs_confirmation" ? "需要人工复核后决定" : "可以继续使用，仍建议人工复核");
    // 7.    // 7. 完成
    const { error: completeError } = await client.from("audit_tasks").update({
      status: "completed",
      progress: 100,
      overall_risk: overallRisk,
      risk_counts: riskCounts,
      recommended_action: recommendedAction,
      result_schema_version: "content-audit-agent.v1",
      message_code: "AUDIT_COMPLETED",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", taskId);
    if (completeError) throw new Error(`complete task: ${completeError.message}`);

    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "completed",
      stage: "analyzing",
      terminal: true,
      progress: 100,
      messageCode: "AUDIT_COMPLETED",
      result: { audit_task_id: taskId, findings: findings.length, overall_risk: overallRisk, coverage_warnings: coverageWarnings.length, agent_status: auditAgent.status, agent_plan: auditAgent.plan, agent_steps: auditAgent.steps.map((step) => ({ id: step.id, status: step.status, skillOrTool: step.skillOrTool, note: step.note })), agent_disclaimer: auditAgent.disclaimer },
    });
  } catch (error) {
    console.error("[audit-executor] ERROR:", error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : "");
    await fail("AUDIT_ERROR", error instanceof Error ? error.message : "未知错误");
  }
}
