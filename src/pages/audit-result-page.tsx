import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Badge, Button, Card } from "../components/ui";
import { apiRequest, ApiClientError } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

interface Finding {
  id: string;
  risk_level: string;
  category: string;
  location: { source?: string; excerpt?: string } | null;
  source_locator: string | null;
  source_excerpt: string | null;
  explanation: string | null;
  suggestion: string | null;
  confidence: number | null;
}

interface AuditTaskView {
  id: string;
  title: string;
  status: string;
  overall_risk: string | null;
  risk_counts: { high: number; medium: number; low: number; needs_confirmation?: number } | null;
  recommended_action: string | null;
  message_code: string | null;
  findings: Finding[];
  assets: Array<{ id: string; file_name: string }>;
  coverage_warnings?: Array<{ code: string; message: string }>;
}

const RISK_META: Record<string, { label: string; tone: "danger" | "warning" | "neutral" | "success" }> = {
  high: { label: "高风险", tone: "danger" },
  medium: { label: "中风险", tone: "warning" },
  low: { label: "低风险", tone: "neutral" },
  needs_confirmation: { label: "需人工确认", tone: "neutral" },
};

const OVERALL_LABEL: Record<string, string> = {
  high: "警告 · 建议修改后重新送审",
  medium: "提示 · 需人工复核后决定",
  low: "未发现明显风险 · 建议人工复核",
  needs_confirmation: "需人工复核",
};

export function AuditResultPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const taskId = params.get("taskId") ?? "";
  const [task, setTask] = useState<AuditTaskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accessToken || !taskId) { setLoading(false); return; }
    try {
      const response = await apiRequest<{ data: AuditTaskView }>(`/audit-tasks/${taskId}`, accessToken);
      setTask(response.data);
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        void signOut().catch(() => undefined);
      } else {
        setError(requestError instanceof Error ? requestError.message : "加载审核结果失败。");
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, taskId, signOut]);

  // 任务未结束前每 2 秒轮询，终态后停止（避免提交后立即打开显示"0 风险"的中间态）
  const taskStatus = task?.status ?? "";
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!taskId || !taskStatus || ["completed", "failed", "cancelled", "needs_attention"].includes(taskStatus)) return;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [taskId, taskStatus, load]);

  if (!taskId) {
    return <AppShell title="审核结果" subtitle="风险定位、规则来源与修改建议均可追溯。"><Card><p>缺少任务参数，请从审核记录进入。</p></Card></AppShell>;
  }
  if (loading && !task) {
    return <AppShell title="审核结果" subtitle="风险定位、规则来源与修改建议均可追溯。"><Card><p>加载中…</p></Card></AppShell>;
  }
  if (error || !task) {
    return <AppShell title="审核结果" subtitle="风险定位、规则来源与修改建议均可追溯。"><Card><div className="form-message form-message--error">{error ?? "未找到审核结果。"}</div></Card></AppShell>;
  }

  // 审核进行中：展示进度而非"0 风险"
  if (!["completed", "failed", "cancelled", "needs_attention"].includes(taskStatus)) {
    const stageLabel: Record<string, string> = { queued: "排队中…", retrieving: "正在检索规则…", analyzing: "正在分析内容…" };
    return (
      <AppShell title="审核结果" subtitle="风险定位、规则来源与修改建议均可追溯。" action={<Button onClick={() => navigate("/audit/new")} icon={<RefreshCw size={16} />}>重新审核</Button>}>
        <DemoBanner />
        <section className="audit-status"><AlertTriangle size={26} /><div><h2>审核中</h2><p>{task.title} · {stageLabel[taskStatus] ?? taskStatus}</p></div><strong>…<span>分析中</span></strong></section>
        <Card className="results-card"><SearchProgressInline /></Card>
      </AppShell>
    );
  }

  const overall = task.overall_risk ?? "needs_confirmation";
  const meta = RISK_META[overall] ?? RISK_META.needs_confirmation;
  const counts = task.risk_counts ?? { high: 0, medium: 0, low: 0, needs_confirmation: 0 };
  const findingCount = task.findings.length;

  return (
    <AppShell title="审核结果" subtitle="风险定位、规则来源与修改建议均可追溯。" action={<Button onClick={() => navigate("/audit/new")} icon={<RefreshCw size={16} />}>重新审核</Button>}>
      <DemoBanner />
      <section className="audit-status"><AlertTriangle size={26} /><div><h2>{OVERALL_LABEL[overall] ?? "审核完成"}</h2><p>{task.title} · {findingCount > 0 ? `发现 ${counts.high} 项高风险、${counts.medium} 项中风险、${counts.low} 项低风险` : "未发现规则命中"}</p></div><strong>{findingCount}<span>风险项</span></strong></section>
      {(task.coverage_warnings ?? []).length > 0 && (
        <div className="coverage-line">{(task.coverage_warnings ?? []).map((w) => w.message).join("；")}</div>
      )}
      <div className="audit-result-grid">
        <section><h2>风险明细</h2>
          {findingCount === 0 ? <Card><p>未命中内置广告法规则；如涉及私有规则或图片内容，请结合人工复核判断。</p></Card> : (
            <div className="risk-list">{task.findings.map((finding) => {
              const fMeta = RISK_META[finding.risk_level] ?? RISK_META.low;
              return (
                <Card className="risk-card" key={finding.id}>
                  <header><Badge tone={fMeta.tone}>{fMeta.label}</Badge><div><h3>{finding.category} · {finding.explanation ?? ""}</h3><span>{(finding.location as { source?: string } | null)?.source === "title_body" ? "标题/正文" : "标题/正文"} · 置信度 {finding.confidence ?? "—"}</span></div><ChevronDown size={18} /></header>
                  <p>原文片段：{finding.location?.excerpt ?? "—"}</p>
                  <div className="source-row"><span>依据</span>{finding.source_locator ?? ""}《广告法》{finding.source_locator ?? ""} {finding.source_excerpt?.slice(0, 60) ?? ""}<ExternalLink size={14} /></div>
                  <div className="suggestion"><strong>修改建议</strong><p>{finding.suggestion ?? "—"}</p></div>
                </Card>
              );
            })}</div>
          )}
        </section>
        <Card className="audit-summary"><h3>审核摘要</h3><dl><div><dt>高风险</dt><dd>{counts.high}</dd></div><div><dt>中风险</dt><dd>{counts.medium}</dd></div><div><dt>低风险</dt><dd>{counts.low}</dd></div><div><dt>待确认</dt><dd>{counts.needs_confirmation ?? 0}</dd></div><div><dt>图片待复核</dt><dd>{task.assets.length}</dd></div></dl><hr /><h3>建议动作</h3><p>{task.recommended_action ?? "结合明细逐条确认。"}</p><div className="legal-note">本结果由 AI 提供辅助审核，不构成法律意见。</div></Card>
      </div>
    </AppShell>
  );
}

function SearchProgressInline() {
  return <div className="search-progress"><span className="search-progress__orb" /><div><strong>正在分析内容与检索规则…</strong><p>检索规则库 → 匹配风险 → 合成结论</p></div></div>;
}
