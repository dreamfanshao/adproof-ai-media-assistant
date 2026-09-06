import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Badge, Button, Card, SearchInput } from "../components/ui";
import { apiRequest, ApiClientError } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

interface AuditTaskRow {
  id: string;
  title: string;
  status: string;
  overall_risk: string | null;
  risk_counts: { high: number; medium: number; low: number; needs_confirmation?: number } | null;
  created_at: string;
}

const OVERALL_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  high: { label: "警告", tone: "danger" },
  medium: { label: "提示", tone: "warning" },
  low: { label: "通过", tone: "success" },
  needs_confirmation: { label: "待确认", tone: "neutral" },
};

export function AuditHistoryPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [tasks, setTasks] = useState<AuditTaskRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await apiRequest<{ data: AuditTaskRow[] }>("/audit-tasks", accessToken);
      setTasks(response.data.filter((t) => t.status !== "draft"));
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        void signOut().catch(() => undefined);
      } else {
        setError(requestError instanceof Error ? requestError.message : "加载审核记录失败。");
      }
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => tasks.filter((task) => task.title.includes(query) && (filter === "全部" || (OVERALL_LABEL[task.overall_risk ?? "needs_confirmation"]?.label === filter))), [tasks, query, filter]);

  return (
    <AppShell title="审核记录" subtitle="历史结果保留当时使用的规则版本。" action={<Button onClick={() => navigate("/audit/new")}>新建审核</Button>}>
      <DemoBanner />
      {error && <div className="form-message form-message--error">{error}</div>}
      <header className="page-intro"><h2>审核记录</h2><p>重新审核会生成新版本，不会覆盖历史结论。</p></header>
      <div className="history-toolbar"><SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名称或图文标题" /><div className="filter-tabs">{["全部", "警告", "通过", "待确认"].map((item) => <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
      <Card className="history-card"><table className="data-table"><thead><tr><th>任务 / 图文标题</th><th>结论</th><th>风险分布</th><th>创建时间</th></tr></thead><tbody>
        {rows.map((task) => {
          const meta = OVERALL_LABEL[task.overall_risk ?? "needs_confirmation"] ?? OVERALL_LABEL.needs_confirmation;
          const counts = task.risk_counts ?? { high: 0, medium: 0, low: 0, needs_confirmation: 0 };
          return (
            <tr key={task.id} className="clickable-row" onClick={() => navigate(`/audit/result?taskId=${task.id}`)}>
              <td>{task.title}</td>
              <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
              <td>{counts.high > 0 || counts.medium > 0 || counts.low > 0 || (counts.needs_confirmation ?? 0) > 0 ? `高${counts.high} · 中${counts.medium} · 低${counts.low} · 待确认${counts.needs_confirmation ?? 0}` : "—"}</td>
              <td>{new Date(task.created_at).toLocaleString("zh-CN")}</td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={4} className="empty-cell">暂无审核记录</td></tr>}
      </tbody></table></Card>
      <div className="coverage-line">每条历史记录保存输入、知识库版本快照和结构化结果。</div>
    </AppShell>
  );
}
