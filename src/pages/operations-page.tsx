import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, Clock3, Users } from "lucide-react";
import { AppShell } from "../components/app-shell";
import { Card } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import { getOperationsOverview, type OperationsOverview } from "../lib/operations-api";
import { useAuth } from "../state/auth-context";

function Metric({ label, value, hint, icon: Icon }: { label: string; value: string | number; hint: string; icon: typeof Users }) {
  return <Card className="operations-metric"><span className="operations-metric__icon"><Icon size={17} /></span><span>{label}</span><strong>{value}</strong><small>{hint}</small></Card>;
}

export function OperationsPage() {
  const { session } = useAuth();
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    setLoading(true);
    void getOperationsOverview(session.access_token)
      .then((response) => { if (active) setOverview(response.data); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ApiClientError ? reason.message : "运营数据读取失败，请稍后重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.access_token]);

  return <AppShell title="运营中心" subtitle="仅管理员可见的用户规模、使用情况和系统质量概览。">
    {loading && <div className="form-message">正在加载运营数据…</div>}
    {error && <div className="form-message form-message--error">{error}</div>}
    {overview && <>
      <section className="operations-section"><header className="operations-section__heading"><div><span className="operations-eyebrow">USER SCALE</span><h2>用户规模</h2></div><small>更新于 {new Date(overview.generatedAt).toLocaleString("zh-CN")}</small></header><div className="operations-grid">
        <Metric label="累计注册用户" value={overview.registeredUsers} hint="来自已创建的用户资料" icon={Users} />
        <Metric label="今日新增" value={overview.newUsersToday} hint={`近7日新增 ${overview.newUsers7d}`} icon={BarChart3} />
        <Metric label="今日活跃用户" value={overview.activeUsersToday} hint={`近7日活跃 ${overview.activeUsers7d}`} icon={Users} />
        <Metric label="7日回访率" value={overview.returningRate7d == null ? "—" : `${overview.returningRate7d}%`} hint={`回访用户 ${overview.returningUsers7d}`} icon={Clock3} />
      </div></section>
      <section className="operations-section"><header className="operations-section__heading"><div><span className="operations-eyebrow">PRODUCT USAGE</span><h2>核心使用情况</h2></div></header><div className="operations-grid">
        <Metric label="今日核心任务" value={overview.coreTasksToday} hint={`检索 ${overview.creatorSearchesToday} · 审核 ${overview.auditsToday}`} icon={CheckCircle2} />
        <Metric label="核心功能用户" value={overview.adoptedUsers} hint={overview.adoptionRate == null ? "暂无采用率" : `采用率 ${overview.adoptionRate}%`} icon={BarChart3} />
        <Metric label="API 调用" value={overview.totalApiCalls} hint={`错误 ${overview.totalApiErrors}`} icon={BarChart3} />
        <Metric label="待处理反馈" value={overview.feedback.open + overview.feedback.inProgress} hint={`累计反馈 ${overview.feedback.total}`} icon={CheckCircle2} />
      </div></section>
      <section className="operations-section"><header className="operations-section__heading"><div><span className="operations-eyebrow">PROVIDER HEALTH</span><h2>服务调用</h2></div></header><Card className="operations-table-card"><table className="data-table"><thead><tr><th>提供方</th><th>调用次数</th><th>错误次数</th><th>平均耗时</th></tr></thead><tbody>{overview.apiUsage.length ? overview.apiUsage.map((item) => <tr key={item.provider}><td>{item.provider}</td><td>{item.calls}</td><td>{item.errors}</td><td>{item.avgDurationMs == null ? "—" : `${item.avgDurationMs} ms`}</td></tr>) : <tr><td colSpan={4}>暂无调用记录</td></tr>}</tbody></table></Card></section>
    </>}
  </AppShell>;
}
