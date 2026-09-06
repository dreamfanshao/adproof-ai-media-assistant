import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { loadCreatorsForProjects, updateProjectCreator } from "../lib/project-api";
import { useProjectScope } from "./project-scope";
import type { Creator, CreatorStatus } from "../types";

export function useProjectCreators(status?: CreatorStatus) {
  const { session } = useAuth();
  const {
    scopeId,
    selectedProject,
    scopedProjectIds,
    isAllProjects,
    loading: scopeLoading,
    error: scopeError,
  } = useProjectScope();
  const accessToken = session?.access_token ?? "";
  const projectId = isAllProjects ? null : selectedProject?.id ?? null;
  const projectName = isAllProjects ? "所有项目" : selectedProject?.name ?? "";
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(scopeError);

  useEffect(() => {
    setError(scopeError);
  }, [scopeError]);

  useEffect(() => {
    if (!accessToken || !scopedProjectIds.length) {
      setCreators([]);
      return;
    }
    setLoading(true);
    void loadCreatorsForProjects(accessToken, scopedProjectIds, status)
      .then(setCreators)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "加载达人失败。"))
      .finally(() => setLoading(false));
  }, [accessToken, scopedProjectIds.join(","), status]);

  const refresh = useCallback(async () => {
    if (!accessToken || !scopedProjectIds.length) return;
    setCreators(await loadCreatorsForProjects(accessToken, scopedProjectIds, status));
  }, [accessToken, scopedProjectIds.join(","), status]);

  const updateStatus = useCallback(async (creatorId: string, next: CreatorStatus) => {
    if (!accessToken) return;
    await updateProjectCreator(accessToken, creatorId, { decision_status: next });
    if (status && next !== status) {
      setCreators((prev) => prev.filter((creator) => creator.id !== creatorId));
    } else {
      setCreators((prev) => prev.map((creator) => (creator.id === creatorId ? { ...creator, status: next } : creator)));
    }
  }, [accessToken, status]);

  return { projectId, projectName, scopeId, isAllProjects, scopeLoading, creators, loading, error, refresh, updateStatus };
}
