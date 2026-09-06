import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import {
  ALL_PROJECTS_SCOPE,
  ensureDefaultProject,
  listProjects,
  type ProjectRow,
} from "../lib/project-api";

const PROJECT_SCOPE_KEY = "adproof.activeProjectId";
const PROJECT_SCOPE_EVENT = "adproof:project-scope-change";

function readScopeId(): string {
  return window.localStorage.getItem(PROJECT_SCOPE_KEY) ?? "";
}

function persistScopeId(scopeId: string): void {
  if (scopeId === ALL_PROJECTS_SCOPE) window.localStorage.setItem(PROJECT_SCOPE_KEY, ALL_PROJECTS_SCOPE);
  else window.localStorage.setItem(PROJECT_SCOPE_KEY, scopeId);
  window.dispatchEvent(new Event(PROJECT_SCOPE_EVENT));
}

export function useProjectScope() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [scopeId, setScopeId] = useState(readScopeId);
  const [loading, setLoading] = useState(Boolean(accessToken));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      let nextProjects = await listProjects(accessToken);
      if (!nextProjects.some((project) => project.status !== "archived")) {
        await ensureDefaultProject(accessToken);
        nextProjects = await listProjects(accessToken);
      }
      setProjects(nextProjects);
      setError(null);
      const stored = readScopeId();
      const isValid = stored === ALL_PROJECTS_SCOPE || nextProjects.some((project) => project.id === stored && project.status !== "archived");
      if (!isValid) {
        const fallback = nextProjects.find((project) => project.status !== "archived")?.id ?? ALL_PROJECTS_SCOPE;
        setScopeId(fallback);
        persistScopeId(fallback);
      } else {
        setScopeId(stored);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "项目列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const sync = () => setScopeId(readScopeId());
    window.addEventListener(PROJECT_SCOPE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PROJECT_SCOPE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const selectScope = useCallback((nextScopeId: string) => {
    setScopeId(nextScopeId);
    persistScopeId(nextScopeId);
  }, []);

  const activeProjects = projects.filter((project) => project.status !== "archived");
  const selectedProject = activeProjects.find((project) => project.id === scopeId) ?? null;
  const isAllProjects = scopeId === ALL_PROJECTS_SCOPE;
  const scopedProjectIds = isAllProjects ? projects.map((project) => project.id) : selectedProject ? [selectedProject.id] : [];

  return {
    projects,
    activeProjects,
    scopeId,
    selectedProject,
    isAllProjects,
    scopedProjectIds,
    loading,
    error,
    selectScope,
    reload: load,
  };
}

export { ALL_PROJECTS_SCOPE, PROJECT_SCOPE_EVENT };
