import { ArrowRight, ClipboardCheck, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Button, Card } from "../components/ui";

const tasks = [
  ["玻尿酸新品素人招募", "达人检索", "进行中", "08-14 14:20"],
  ["光子嫩肤达人笔记审核", "内容审核", "需修改", "08-14 10:20"],
  ["防晒新品素人补充名单", "达人检索", "已完成", "08-13 18:05"],
];

export function DashboardPage() {
  const navigate = useNavigate();
  return (
<AppShell title="工作台首页" subtitle="项目进展和待办任务集中展示。" action={<Button onClick={() => navigate("/projects?new=1")}>新建项目</Button>}>
      <DemoBanner />
      <header className="page-intro"><h2>下午好，媒介专员</h2><p>今天先处理高匹配达人，再完成待审核内容。</p></header>
      <div className="metric-grid">
        {[["进行中项目", "3"], ["待处理达人", "86"], ["待审核内容", "5"], ["本周已完成", "24"]].map(([label, value], index) => (
          <Card key={label} className={index === 3 ? "metric-card metric-card--success" : "metric-card"}><span>{label}</span><strong>{value}</strong></Card>
        ))}
      </div>
      <div className="action-grid">
        <Card className="action-card"><Search /><div><span>达人检索</span><h3>用一句话找到目标素人</h3><p>输入粉丝、活跃度、项目经历和皮肤困扰。</p></div><Button onClick={() => navigate("/creators")}>开始找达人 <ArrowRight size={16} /></Button></Card>
        <Card className="action-card"><ClipboardCheck /><div><span>内容审核</span><h3>图文发布前先做风险检查</h3><p>结合广告法和企业私有知识库。</p></div><Button tone="dark" onClick={() => navigate("/audit/new")}>新建审核 <ArrowRight size={16} /></Button></Card>
      </div>
      <section className="section-block"><h2>最近任务</h2><Card className="recent-card"><table className="data-table"><thead><tr><th>任务名称</th><th>类型</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{tasks.map((task) => <tr key={task[0]}>{task.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></Card></section>
    </AppShell>
  );
}
