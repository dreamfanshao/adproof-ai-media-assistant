import { KeyRound, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { CreatorExportButton, CreatorTable } from "../components/creator-table";
import { Button, Card, Modal } from "../components/ui";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { dedupeCreators, loadCreatorsForProjects, mapProjectCreator, updateProjectCreator, type ProjectCreatorRow } from "../lib/project-api";
import { useAuth } from "../state/auth-context";
import { useProjectScope } from "../state/project-scope";
import type { Creator, CreatorStatus } from "../types";

type SearchTaskView = {
  id: string;
  project_id?: string;
  status: string;
  terminal: boolean;
  target_count?: number;
  progress: number;
  query_text?: string;
  created_at?: string;
  collected_count?: number;
  persisted_count?: number;
  duplicate_count?: number;
  stage_counts?: Partial<SearchStageCounts>;
  loop_state?: {
    action?: string;
    reason?: string | null;
    iteration?: number;
    candidate_pool?: number;
    eligible_candidates?: number;
    softened_filters?: string[];
    keyword_expansion_count?: number;
    quality_policy?: { minimumOverallScore?: number; minimumSemanticConfidence?: number; requireEvidence?: boolean; source?: string };
  };
  error_message?: string | null;
};

type SearchStageCounts = {
  notes_collected: number;
  creators_discovered: number;
  profile_failures: number;
  follower_filtered: number;
  recent_likes_filtered: number;
  semantic_filtered: number;
  quality_filtered: number;
  analysis_errors: number;
  existing_duplicates: number;
  persisted: number;
};

type SearchSummary = {
  collected: number;
  persisted: number;
  duplicates: number;
  stages: Partial<SearchStageCounts>;
};

type RedfoxCredentialView = {
  configured: boolean;
  source: "user" | "system" | "none";
  fingerprint: string | null;
  updated_at: string | null;
  replaceable: boolean;
};

function summaryLabel(summary: SearchSummary): string {
  const stages = summary.stages;
  return [
    `${stages.notes_collected ?? summary.collected} 篇笔记`,
    `${stages.creators_discovered ?? 0} 个账号`,
    `资料失败 ${stages.profile_failures ?? 0}`,
    `粉丝条件未达 ${stages.follower_filtered ?? 0}`,
    `点赞条件未达 ${stages.recent_likes_filtered ?? 0}`,
    `语义条件未达 ${stages.semantic_filtered ?? 0}`,
    `最低匹配标准未达 ${stages.quality_filtered ?? 0}`,
    `分析异常 ${stages.analysis_errors ?? 0}`,
    `已有重复 ${stages.existing_duplicates ?? summary.duplicates}`,
    `本次新增 ${stages.persisted ?? summary.persisted}`,
  ].join("；");
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const ACTIVE_SEARCH_STATUSES = new Set(["queued", "validating_session", "collecting", "hard_filtering", "analyzing", "persisting"]);
const searchStatusLabel: Record<string, string> = {
  queued: "排队中",
  validating_session: "校验数据源会话",
  collecting: "采集笔记",
  hard_filtering: "候选资料与条件评分",
  analyzing: "分析笔记与图片",
  persisting: "保存结果",
};
const searchLoopActionLabel: Record<string, string> = {
  search_more: "继续扩大检索",
  expand_keywords: "扩展检索关键词",
  soften_filter: "放宽一个高淘汰数据条件并重排",
  finalize: "整理并返回前 20 人",
  stop: "整理部分结果",
};

function searchPhaseLabel(task: SearchTaskView): string {
  const action = task.loop_state?.action;
  const loopLabel = action ? searchLoopActionLabel[action] ?? action : "";
  return loopLabel ? `${searchStatusLabel[task.status] ?? task.status} · ${loopLabel}` : (searchStatusLabel[task.status] ?? task.status);
}

const isRedfoxBalanceMessage = (message: string | null) => Boolean(message && /RedFoxHub.*(?:积分|余额).*(?:不足|用完)/i.test(message));

export function CreatorsPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { selectedProject, scopedProjectIds, isAllProjects } = useProjectScope();
  const token = session?.access_token ?? "";
  const projectId = isAllProjects ? null : selectedProject?.id ?? null;
  const [query, setQuery] = useState("粉丝小于1500，活跃度较高，有医美或护肤经验");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [credential, setCredential] = useState<RedfoxCredentialView | null>(null);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const pollGeneration = useRef(0);
  const activePollTaskId = useRef<string | null>(null);
  const reconcileInFlight = useRef(false);
  const submissionInFlight = useRef(false);

  const handleAuthError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      void signOut().catch(() => undefined);
      navigate("/login", { replace: true });
      return true;
    }
    return false;
  }, [navigate, signOut]);

  const finishTask = useCallback(async (task: SearchTaskView, targetProjectId: string) => {
    if (task.status === "failed" || task.status === "session_expired") {
      throw new Error(task.error_message || "数据源请求失败");
    }
    if (task.status === "cancelled") {
      setError(task.error_message || "本次检索已停止");
      return;
    }
    const response = await apiRequest<{ data: ProjectCreatorRow[] }>(`/projects/${targetProjectId}/creators`, token);
    setCreators(dedupeCreators(response.data.map(mapProjectCreator)));
    setSummary({
      collected: task.collected_count ?? 0,
      persisted: task.persisted_count ?? 0,
      duplicates: task.duplicate_count ?? 0,
      stages: task.stage_counts ?? {},
    });
    const added = task.persisted_count ?? 0;
    setNotice(task.error_message || (added >= 20
      ? "本批已新增 20 人。再次点击“开始检索”可获取下一批，项目历史达人会自动排除。"
      : `本批新增 ${added} 人，当前检索范围内暂未发现更多符合条件且未在项目历史中出现的达人。`));
  }, [token]);

  const pollTask = useCallback(async (id: string, targetProjectId: string) => {
    if (!token || activePollTaskId.current === id) return;
    activePollTaskId.current = id;
    inFlight.current = true;
    const generation = ++pollGeneration.current;
    const storageKey = `adproof.creator-search.${session?.user?.id ?? "current"}.${targetProjectId}`;
    let consecutiveFailures = 0;
    try {
      while (inFlight.current && pollGeneration.current === generation) {
        try {
          const response = await apiRequest<{ data: SearchTaskView }>(`/search-tasks/${id}`, token, { cache: "no-store" });
          const task = response.data;
          consecutiveFailures = 0;
          setError(null);
          setRunning(!task.terminal);
          if ((task.collected_count ?? 0) > 0 || task.stage_counts) {
            setSummary({
              collected: task.collected_count ?? 0,
              persisted: task.persisted_count ?? 0,
              duplicates: task.duplicate_count ?? 0,
              stages: task.stage_counts ?? {},
            });
          }
          setTaskId(task.terminal ? null : task.id);
          setPhase(task.terminal ? null : searchPhaseLabel(task));
          if (task.terminal) {
            inFlight.current = false;
            window.localStorage.removeItem(storageKey);
            setRunning(false);
            try {
              await finishTask(task, targetProjectId);
            } catch (reason) {
              if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "检索结果加载失败");
            }
            return;
          }
          window.localStorage.setItem(storageKey, JSON.stringify({
            id: task.id,
            query: task.query_text,
            startedAt: task.created_at,
          }));
        } catch (reason) {
          if (handleAuthError(reason)) {
            inFlight.current = false;
            return;
          }
          consecutiveFailures += 1;
          setRunning(true);
          setError(`检索仍在后台执行，状态同步暂时失败，正在自动重试（${consecutiveFailures}）`);
        }
        await sleep(document.hidden ? 5000 : Math.min(10_000, 2000 + consecutiveFailures * 1000));
      }
    } finally {
      if (activePollTaskId.current === id) activePollTaskId.current = null;
    }
  }, [finishTask, handleAuthError, session?.user?.id, token]);

  const reconcileActiveTask = useCallback(async () => {
    if (!token || !projectId || reconcileInFlight.current) return;
    reconcileInFlight.current = true;
    const storageKey = `adproof.creator-search.${session?.user?.id ?? "current"}.${projectId}`;
    try {
      const response = await apiRequest<{ data: SearchTaskView[] }>(
        `/projects/${projectId}/search-tasks`,
        token,
        { cache: "no-store" },
      );
      const active = response.data.find((task) => !task.terminal && ACTIVE_SEARCH_STATUSES.has(task.status));
      if (active) {
        inFlight.current = true;
        setQuery(active.query_text ?? "");
        setRunning(true);
        setTaskId(active.id);
        setPhase(searchPhaseLabel(active));
        if ((active.collected_count ?? 0) > 0 || active.stage_counts) {
          setSummary({
            collected: active.collected_count ?? 0,
            persisted: active.persisted_count ?? 0,
            duplicates: active.duplicate_count ?? 0,
            stages: active.stage_counts ?? {},
          });
        }
        window.localStorage.setItem(storageKey, JSON.stringify({
          id: active.id,
          query: active.query_text,
          startedAt: active.created_at,
        }));
        if (activePollTaskId.current !== active.id) void pollTask(active.id, projectId);
      } else if (!activePollTaskId.current && !submissionInFlight.current) {
        inFlight.current = false;
        setRunning(false);
        setTaskId(null);
        setPhase(null);
        window.localStorage.removeItem(storageKey);
      }
    } catch (reason) {
      if (!handleAuthError(reason) && inFlight.current) {
        setRunning(true);
        setError("检索仍在后台执行，暂时无法同步服务端状态，正在自动重试。");
      }
    } finally {
      reconcileInFlight.current = false;
    }
  }, [handleAuthError, pollTask, projectId, session?.user?.id, token]);

  const reload = useCallback(async () => {
    if (!token) return;
    if (scopedProjectIds.length && projectId && !inFlight.current) {
      const storageKey = `adproof.creator-search.${session?.user?.id ?? "current"}.${projectId}`;
      let stored: { id?: string; query?: string } | null = null;
      try {
        const raw = window.localStorage.getItem(storageKey);
        stored = raw ? JSON.parse(raw) as { id?: string; query?: string } : null;
      } catch {
        stored = null;
      }
      try {
        const response = await apiRequest<{ data: SearchTaskView[] }>(`/projects/${projectId}/search-tasks`, token, { cache: "no-store" });
        const active = response.data.find((task) => !task.terminal && ACTIVE_SEARCH_STATUSES.has(task.status));
        if (active) {
          setQuery(active.query_text ?? stored?.query ?? "");
          setRunning(true);
          setTaskId(active.id);
          setPhase(searchPhaseLabel(active));
          setError(null);
          inFlight.current = true;
          window.localStorage.setItem(storageKey, JSON.stringify({
            id: active.id,
            query: active.query_text,
            startedAt: active.created_at,
          }));
          void pollTask(active.id, projectId);
        } else {
          window.localStorage.removeItem(storageKey);
          const latest = response.data.find((task) => task.terminal);
          if (latest?.query_text) setQuery(latest.query_text);
          setRunning(false);
          setTaskId(null);
          setPhase(null);
        }
      } catch (reason) {
        if (handleAuthError(reason)) return;
        if (stored?.id) {
          setQuery(stored.query ?? "");
          setRunning(true);
          setTaskId(stored.id);
          setPhase("queued");
          setError("服务端活动任务查询暂时失败，正在根据本地任务记录恢复状态。");
          inFlight.current = true;
          void pollTask(stored.id, projectId);
        } else {
          setError(reason instanceof Error ? reason.message : "检索任务状态加载失败");
        }
      }
    }
    try {
      const [loadedCreators, credentialResponse] = await Promise.all([
        scopedProjectIds.length ? loadCreatorsForProjects(token, scopedProjectIds) : Promise.resolve([]),
        apiRequest<{ data: RedfoxCredentialView }>("/redfox-credential", token),
      ]);
      setCreators(loadedCreators);
      setCredential(credentialResponse.data);
    } catch (reason) {
      if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "达人列表加载失败");
    }
  }, [handleAuthError, pollTask, projectId, scopedProjectIds.join(","), session?.user?.id, token]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!token || !projectId) return;
    const reconcile = () => { void reconcileActiveTask(); };
    reconcile();
    const intervalId = window.setInterval(reconcile, 5000);
    const handleVisibilityChange = () => {
      if (!document.hidden) reconcile();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [projectId, reconcileActiveTask, token]);
  useEffect(() => () => {
    inFlight.current = false;
    pollGeneration.current += 1;
    activePollTaskId.current = null;
    submissionInFlight.current = false;
  }, []);

  const openCredentialModal = () => {
    setApiKey("");
    setCredentialError(null);
    setCredentialOpen(true);
  };

  const closeCredentialModal = () => {
    if (credentialSaving) return;
    setApiKey("");
    setCredentialError(null);
    setCredentialOpen(false);
  };

  const saveCredential = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextKey = apiKey.trim();
    if (!token || nextKey.length < 16 || credentialSaving) return;
    setCredentialSaving(true);
    setCredentialError(null);
    try {
      const response = await apiRequest<{ data: RedfoxCredentialView }>("/redfox-credential", token, {
        method: "PUT",
        body: JSON.stringify({ api_key: nextKey }),
      });
      setCredential(response.data);
      setApiKey("");
      setCredentialOpen(false);
      setError(null);
      setNotice("API Key 已替换。再次点击“开始检索”会从已保存位置继续，不会重复筛查历史达人。");
    } catch (reason) {
      if (!handleAuthError(reason)) setCredentialError(reason instanceof Error ? reason.message : "API Key 保存失败");
    } finally {
      setCredentialSaving(false);
    }
  };

  const runSearch = async () => {
    if (!token || !projectId || !query.trim() || inFlight.current) return;
    submissionInFlight.current = true;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    setNotice(null);
    setSummary(null);
    setPhase("正在解析检索条件");
    let handedOff = false;
    try {
      const parsed = await apiRequest<{ data: Record<string, unknown> }>(
        `/projects/${projectId}/search-rules:parse`,
        token,
        { method: "POST", body: JSON.stringify({ query_text: query.trim() }) },
      );
      const created = await apiRequest<{ data: { id: string } }>(
        `/projects/${projectId}/search-tasks`,
        token,
        { method: "POST", body: JSON.stringify({ query_text: query.trim(), confirmed_rule: parsed.data, target_count: 20, platforms: ["xiaohongshu"] }) },
      );
      handedOff = true;
      submissionInFlight.current = false;
      setTaskId(created.data.id);
      window.localStorage.setItem(
        `adproof.creator-search.${session?.user?.id ?? "current"}.${projectId}`,
        JSON.stringify({ id: created.data.id, query: query.trim(), startedAt: new Date().toISOString() }),
      );
      await pollTask(created.data.id, projectId);
    } catch (reason) {
      if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "检索失败");
    } finally {
      submissionInFlight.current = false;
      if (!handedOff) {
        inFlight.current = false;
        setRunning(false);
        setPhase(null);
      }
    }
  };

  const changeStatus = async (id: string, status: CreatorStatus) => {
    try {
      await updateProjectCreator(token, id, { decision_status: status });
      setCreators((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    } catch (reason) {
      if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "状态更新失败");
    }
  };

  return <AppShell showProjectSelector title="找达人" subtitle="使用自然语言检索小红书达人" action={<Button onClick={() => { if (running) return; setQuery(""); setCreators([]); setSummary(null); setNotice(null); }}>新建检索</Button>}>
    <DemoBanner />
    <div className="project-label">当前项目： {selectedProject?.name ?? (isAllProjects ? "全部项目" : "未选择项目")}</div>
    <Card className="prompt-card"><div className="prompt-card__input-row"><Sparkles size={20} /><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="请输入达人筛选条件，例如：粉丝小于1500、活跃度高、有医美经历" aria-label="达人检索条件" /><Button loading={running} disabled={running || !projectId || !query.trim()} onClick={() => void runSearch()} icon={<Search size={17} />}>开始检索</Button></div></Card>
    {running && <div className="form-message form-message--info"><strong>正在检索：{searchStatusLabel[phase ?? ""] ?? phase ?? "准备中"}</strong><span>已提交的任务会在后台继续执行；请勿重复点击或刷新后再次提交。{taskId ? `（任务 ${taskId.slice(0, 8)}）` : ""}</span></div>}
    {!running && notice && <div className="form-message form-message--info credential-message"><span>{notice}</span>{isRedfoxBalanceMessage(notice) && <button type="button" className="credential-message__action" onClick={openCredentialModal}><KeyRound size={14} aria-hidden="true" />更换 API Key</button>}</div>}
    {error && <div className="form-message form-message--error credential-message"><span>{error}</span>{isRedfoxBalanceMessage(error) && <button type="button" className="credential-message__action" onClick={openCredentialModal}><KeyRound size={14} aria-hidden="true" />更换 API Key</button>}</div>}
    <section className="results-section">
      <header>
        <div>
          <h2>候选达人 {running ? "检索中" : creators.length}</h2>
          <span>{summary ? summaryLabel(summary) : "每次最多新增 20 人；当前项目历史检索过的达人会自动排除"}</span>
        </div>
        <div className="results-header-actions">
          <CreatorExportButton accessToken={token} projectId={projectId ?? ""} fileName="creator-results" disabled={!projectId || !creators.length} />
        </div>
      </header>
      <Card className="results-card">
    {running ? <div className="search-progress"><strong>{searchStatusLabel[phase ?? ""] ?? phase ?? "正在检索"}</strong><p>正在检索并分析笔记，请稍候。刷新页面后会自动恢复任务状态。</p></div> : <CreatorTable creators={creators} onStatusChange={(id, status) => void changeStatus(id, status)} />}
      </Card>
    </section>
    <Modal open={credentialOpen} title="配置 API Key" className="modal--credential" onClose={closeCredentialModal}>
      <form className="modal-form credential-form" onSubmit={(event) => void saveCredential(event)}>
        <label>
          API Key
          <input
            autoFocus
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="请输入 API Key"
            minLength={16}
            maxLength={500}
            required
          />
        </label>
        <p className="credential-security-note">密钥仅在服务端加密保存，不会在页面中回显，也不会写入检索任务或日志。保存后，下一次检索会优先使用此密钥。</p>
        {credentialError && <div className="form-message form-message--error" role="alert">{credentialError}</div>}
        <div><Button tone="secondary" type="button" onClick={closeCredentialModal} disabled={credentialSaving}>取消</Button><Button type="submit" loading={credentialSaving} disabled={apiKey.trim().length < 16}>保存并替换</Button></div>
      </form>
    </Modal>
  </AppShell>;
}
