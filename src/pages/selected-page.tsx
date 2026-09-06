import { useMemo, useState } from "react";
import { useAuth } from "../state/auth-context";
import { AppShell, DemoBanner } from "../components/app-shell";
import { CreatorExportButton, CreatorTable } from "../components/creator-table";
import { Badge, Card } from "../components/ui";
import { useProjectCreators } from "../state/project-creators-hook";

export function SelectedPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const { projectId, creators, updateStatus, error, isAllProjects } = useProjectCreators("selected");
  const [group, setGroup] = useState("全部分组");
  const selected = useMemo(() => creators.filter((creator) => group === "全部分组" || creator.group === group), [creators, group]);

  return (
    <AppShell showProjectSelector title="已选达人" subtitle={isAllProjects ? "汇总所有项目中已选入的候选名单。" : "进入后续合作评估的候选名单。"} action={
      <CreatorExportButton
        accessToken={accessToken}
        projectId={projectId ?? ""}
        fileName="玻尿酸新品_已选达人"
        status="selected"
        disabled={!projectId}
      />
    }>
      <DemoBanner />
      {error && <div className="form-message form-message--error">{error}</div>}
      <header className="page-intro"><h2>已选达人 {creators.length}</h2><p>状态可随时转为待处理或弃用，AI 不替你做最终决定。</p></header>
      <div className="filter-tabs">{["全部分组", "玻尿酸新品", "防晒新品", "待联系"].map((item) => <button className={group === item ? "is-active" : ""} onClick={() => setGroup(item)} key={item}>{item}</button>)}</div>
      <Card className="results-card"><CreatorTable creators={selected} onStatusChange={(id, status) => void updateStatus(id, status)} /></Card>
      <div className="success-note"><Badge tone="success">可导出</Badge> 已选名单包含主页链接、证据摘要、分组和当前状态。</div>
    </AppShell>
  );
}
