import { useMemo } from "react";
import { useAuth } from "../state/auth-context";
import { AppShell, DemoBanner } from "../components/app-shell";
import { CreatorExportButton, CreatorTable } from "../components/creator-table";
import { Card } from "../components/ui";
import { useProjectCreators } from "../state/project-creators-hook";

export function DiscardedPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const { projectId, creators, updateStatus, error, isAllProjects } = useProjectCreators("discarded");
  const discarded = useMemo(() => creators, [creators]);
  const overLimit = discarded.filter((creator) => creator.followers > 1500).length;

  return (
    <AppShell showProjectSelector title="已弃用达人" subtitle={isAllProjects ? "汇总所有项目中已弃用的达人，便于统一复盘。" : "保留弃用原因，便于项目内去重和复盘。"} action={
      <CreatorExportButton
        accessToken={accessToken}
        projectId={projectId ?? ""}
        fileName="玻尿酸新品_已弃用达人"
        status="discarded"
        disabled={!projectId}
      />
    }>
      <DemoBanner />
      {error && <div className="form-message form-message--error">{error}</div>}
      <header className="page-intro"><h2>已弃用达人 {discarded.length}</h2><p>弃用状态不是永久删除，可随时恢复到待处理。</p></header>
      <Card className="results-card"><CreatorTable creators={discarded} onStatusChange={(id, status) => void updateStatus(id, status)} compact /></Card>
      <div className="insight-grid">
        <Card><h3>弃用原因分布</h3><div className="bar-row"><span>粉丝超标</span><i style={{ width: `${Math.max(20, overLimit * 75)}%` }} /><strong>{overLimit || 0}</strong></div><div className="bar-row"><span>内容不匹配</span><i style={{ width: "25%" }} /><strong>0</strong></div></Card>
        <Card><h3>项目内去重说明</h3><p>已弃用达人仍保留项目记录；后续检索命中同一小红书用户 ID 时，不会作为新候选重复返回。</p></Card>
      </div>
    </AppShell>
  );
}
