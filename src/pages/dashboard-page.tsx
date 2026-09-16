import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/app-shell";
import { Button, Card } from "../components/ui";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { listProjects, loadCreatorsForProjects, type ProjectRow } from "../lib/project-api";
import { useAuth } from "../state/auth-context";

interface SearchTaskRow {
  id: string;
  project_id: string;
  status?: string | null;
  terminal?: boolean | null;
  query_text?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AuditTaskRow {
  id: string;
  title: string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface DashboardTask {
  id: string;
  name: string;
  type: string;
  status: string;
  updatedAt: string;
}

const SEARCH_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  validating_session: "校验中",
  collecting: "采集中",
  hard_filtering: "筛选中",
  analyzing: "分析中",
  persisting: "整理中",
  completed: "已完成",
  cancelled: "已停止",
  failed: "失败",
  session_expired: "会话过期",
};

const AUDIT_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  queued: "排队中",
  processing: "审核中",
  running: "审核中",
  completed: "已完成",
  failed: "失败",
};

function isCompleted(status: string | null | undefined, terminal = false): boolean {
  return terminal || ["completed", "cancelled", "failed"].includes(status ?? "");
}

function isWithinCurrentWeek(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - mondayOffset);
  return date >= start;
}

function formatTaskTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pendingCreatorCount, setPendingCreatorCount] = useState(0);
  const [searchTasks, setSearchTasks] = useState<SearchTaskRow[]>([]);
  const [auditTasks, setAuditTasks] = useState<AuditTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const projectRows = await listProjects(accessToken);
      const projectIds = projectRows.map((project) => project.id);
      const [creatorRows, searchRows, auditResponse] = await Promise.all([
        loadCreatorsForProjects(accessToken, projectIds),
        Promise.all(projectIds.map(async (projectId) => {
          const response = await apiRequest<{ data: SearchTaskRow[] }>(`/projects/${projectId}/search-tasks`, accessToken);
          return response.data;
        })),
        apiRequest<{ data: AuditTaskRow[] }>("/audit-tasks", accessToken),
      ]);
      setProjects(projectRows);
      setPendingCreatorCount(creatorRows.filter((creator) => creator.status === "pending").length);
      setSearchTasks(searchRows.flat());
      setAuditTasks(auditResponse.data);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        void signOut().catch(() => undefined);
      } else {
        setError(requestError instanceof Error ? requestError.message : "加载工作台数据失败，请稍后重试。");
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const activeProjects = useMemo(() => projects.filter((project) => project.status !== "archived"), [projects]);
  const metrics = useMemo(() => {
    const pendingAudits = auditTasks.filter((task) => !["draft", "completed", "failed"].includes(task.status ?? "")).length;
    const completedThisWeek = [
      ...searchTasks.filter((task) => isCompleted(task.status, Boolean(task.terminal))).map((task) => task.updated_at ?? task.created_at),
      ...auditTasks.filter((task) => isCompleted(task.status)).map((task) => task.updated_at ?? task.created_at),
    ].filter(isWithinCurrentWeek).length;
    return [
      ["进行中项目", String(activeProjects.length)],
      ["待处理达人", String(pendingCreatorCount)],
      ["待审核内容", String(pendingAudits)],
      ["本周已完成", String(completedThisWeek)],
    ];
  }, [activeProjects.length, auditTasks, pendingCreatorCount, searchTasks]);

  const recentTasks = useMemo<DashboardTask[]>(() => {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const searchRows: DashboardTask[] = searchTasks.map((task) => ({
      id: `search-${task.id}`,
      name: projectNames.get(task.project_id) ?? task.query_text?.slice(0, 30) ?? "达人检索",
      type: "达人检索",
      status: SEARCH_STATUS_LABEL[task.status ?? ""] ?? (task.terminal ? "已完成" : "进行中"),
      updatedAt: task.updated_at ?? task.created_at ?? "",
    }));
    const auditRows: DashboardTask[] = auditTasks.filter((task) => task.status !== "draft").map((task) => ({
      id: `audit-${task.id}`,
      name: task.title,
      type: "内容审核",
      status: AUDIT_STATUS_LABEL[task.status ?? ""] ?? "审核中",
      updatedAt: task.updated_at ?? task.created_at ?? "",
    }));
    return [...searchRows, ...auditRows]
      .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))
      .slice(0, 5);
  }, [auditTasks, projects, searchTasks]);

  return (
    <AppShell title="工作台首页" subtitle="项目进展和待办任务集中展示。" action={<Button onClick={() => navigate("/projects?new=1")}>新建项目</Button>}>
      {error && <div className="form-message form-message--error" role="alert">{error}</div>}
      <header className="page-intro"><h2>下午好，媒介专员</h2><p>今天先处理高匹配达人，再完成待审核内容。</p></header>
      <div className="metric-grid">
        {metrics.map(([label, value], index) => (
          <Card key={label} className={index === 3 ? "metric-card metric-card--success" : "metric-card"}><span>{label}</span><strong>{loading ? "—" : value}</strong></Card>
        ))}
      </div>
      <div className="action-grid">
        <Card className="action-card"><Search /><div><span>达人检索</span><h3>用一句话找到目标素人</h3><p>输入粉丝、活跃度、项目经历和皮肤困扰。</p></div><Button onClick={() => navigate("/creators")}>开始找达人 <ArrowRight size={16} /></Button></Card>
        <Card className="action-card"><ClipboardCheck /><div><span>内容审核</span><h3>图文发布前先做风险检查</h3><p>结合广告法和企业私有知识库。</p></div><Button tone="dark" onClick={() => navigate("/audit/new")}>新建审核 <ArrowRight size={16} /></Button></Card>
      </div>
      <section className="section-block"><h2>最近任务</h2><Card className="recent-card"><table className="data-table"><thead><tr><th>任务名称</th><th>类型</th><th>状态</th><th>更新时间</th></tr></thead><tbody>
        {recentTasks.map((task) => <tr key={task.id}><td>{task.name}</td><td>{task.type}</td><td>{task.status}</td><td>{formatTaskTime(task.updatedAt)}</td></tr>)}
        {!loading && recentTasks.length === 0 && <tr><td colSpan={4} className="empty-cell">暂无项目或任务，先新建一个项目开始使用。</td></tr>}
        {loading && <tr><td colSpan={4} className="empty-cell">正在加载工作台数据…</td></tr>}
      </tbody></table></Card></section>
    </AppShell>
  );
}
