import { FolderKanban, Pencil, Plus, RotateCcw, Archive } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Badge, Button, Card, Modal } from "../components/ui";
import { ApiClientError } from "../lib/api-client";
import { createProject, listProjects, updateProject, type ProjectRow } from "../lib/project-api";
import { useAuth } from "../state/auth-context";

interface ProjectForm {
  name: string;
  product_name: string;
  description: string;
}

const EMPTY_FORM: ProjectForm = { name: "", product_name: "", description: "" };

export function ProjectManagementPage() {
  const { session, signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const accessToken = session?.access_token ?? "";
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM);

  const activeProjectId = window.localStorage.getItem("adproof.activeProjectId");
  const activeProjects = useMemo(() => projects.filter((project) => project.status !== "archived"), [projects]);
  const archivedProjects = useMemo(() => projects.filter((project) => project.status === "archived"), [projects]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      setProjects(await listProjects(accessToken));
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        await signOut().catch(() => undefined);
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "项目列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, signOut]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setModalOpen(true);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (project: ProjectRow) => {
    setEditingId(project.id);
    setForm({ name: project.name, product_name: project.product_name ?? "", description: project.description ?? "" });
    setModalOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = editingId
        ? await updateProject(accessToken, editingId, form)
        : await createProject(accessToken, form);
      setProjects((current) => editingId
        ? current.map((project) => project.id === saved.id ? saved : project)
        : [saved, ...current]);
      window.localStorage.setItem("adproof.activeProjectId", saved.id);
      setModalOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存项目失败。");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (project: ProjectRow, status: "active" | "archived") => {
    if (!accessToken) return;
    try {
      const saved = await updateProject(accessToken, project.id, { status });
      setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (status === "archived" && activeProjectId === project.id) window.localStorage.removeItem("adproof.activeProjectId");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "项目状态更新失败。");
    }
  };

  const useProject = (project: ProjectRow) => {
    window.localStorage.setItem("adproof.activeProjectId", project.id);
    window.location.assign("/creators");
  };

  return (
    <AppShell title="项目管理" subtitle="为不同产品推广建立独立的达人名单、规则和审核上下文。" action={<Button icon={<Plus size={16} />} onClick={openNew}>新建项目</Button>}>
      <DemoBanner />
      {error && <div className="form-message form-message--error project-error">{error}</div>}
      <section className="project-hero">
        <div><span className="eyebrow">NEXUS WORKSPACE</span><h2>项目是媒介工作的边界</h2><p>切换项目后，达人检索、选入名单和导出文件都会跟随当前项目。</p></div>
        <div className="project-hero__stat"><strong>{activeProjects.length}</strong><span>个进行中项目</span></div>
      </section>
      <section className="project-section">
        <div className="project-section__heading"><div><h2>进行中项目</h2><p>选择一个项目开始工作，或编辑项目信息。</p></div><Button tone="secondary" icon={<Plus size={16} />} onClick={openNew}>新建</Button></div>
        {loading ? <Card className="project-empty">正在加载项目…</Card> : activeProjects.length === 0 ? <Card className="project-empty"><FolderKanban size={26} /><strong>还没有项目</strong><span>先创建一个项目，再开始检索达人。</span><Button onClick={openNew}>创建第一个项目</Button></Card> : (
          <div className="project-grid">{activeProjects.map((project) => {
            const isCurrent = project.id === activeProjectId;
            return <Card key={project.id} className={`project-card ${isCurrent ? "is-current" : ""}`}>
              <div className="project-card__top"><span className="project-card__icon"><FolderKanban size={18} /></span><Badge tone={isCurrent ? "brand" : "success"}>{isCurrent ? "当前项目" : "进行中"}</Badge></div>
              <h3>{project.name}</h3><p>{project.product_name || "未填写产品名称"}</p>{project.description && <small>{project.description}</small>}
              <div className="project-card__actions"><Button onClick={() => useProject(project)}>{isCurrent ? "进入项目" : "使用项目"}</Button><Button tone="secondary" icon={<Pencil size={14} />} onClick={() => openEdit(project)}>编辑</Button><Button tone="ghost" icon={<Archive size={14} />} onClick={() => void setStatus(project, "archived")}>归档</Button></div>
            </Card>;
          })}</div>
        )}
      </section>
      {archivedProjects.length > 0 && <section className="project-section project-section--archived"><div className="project-section__heading"><div><h2>已归档项目</h2><p>归档项目不会出现在默认工作流中，仍可恢复。</p></div></div><div className="project-grid">{archivedProjects.map((project) => <Card key={project.id} className="project-card project-card--archived"><h3>{project.name}</h3><p>{project.product_name || "未填写产品名称"}</p><Button tone="secondary" icon={<RotateCcw size={14} />} onClick={() => void setStatus(project, "active")}>恢复项目</Button></Card>)}</div></section>}
      <Modal open={modalOpen} title={editingId ? "编辑项目" : "新建项目"} onClose={() => setModalOpen(false)}><form className="modal-form project-form" onSubmit={save}><label>项目名称<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：玻尿酸新品素人招募" required /></label><label>产品名称<input value={form.product_name} onChange={(event) => setForm({ ...form, product_name: event.target.value })} placeholder="例如：玻尿酸精华" required /></label><label>项目说明<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="记录推广目标、达人条件或团队备注" rows={3} /></label><div><Button tone="secondary" type="button" onClick={() => setModalOpen(false)}>取消</Button><Button type="submit" loading={saving}>{editingId ? "保存修改" : "创建项目"}</Button></div></form></Modal>
    </AppShell>
  );
}
