import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { initialCreators, initialKnowledgeBases } from "../demo-data";
import type { Creator, CreatorStatus, KnowledgeBase } from "../types";

interface DemoContextValue {
  creators: Creator[];
  knowledgeBases: KnowledgeBase[];
  updateCreatorStatus: (id: string, status: CreatorStatus) => void;
  addKnowledgeBase: (name: string) => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: PropsWithChildren) {
  const [creators, setCreators] = useState(initialCreators);
  const [knowledgeBases, setKnowledgeBases] = useState(initialKnowledgeBases);

  const value = useMemo<DemoContextValue>(() => ({
    creators,
    knowledgeBases,
    updateCreatorStatus: (id, status) => {
      setCreators((items) => items.map((item) => item.id === id
        ? { ...item, status, updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) }
        : item));
    },
    addKnowledgeBase: (name) => {
      const cleanName = name.trim();
      if (!cleanName) return;
      setKnowledgeBases((items) => [...items, {
        id: `kb-${Date.now()}`,
        name: cleanName,
        status: "ready",
        documentCount: 0,
        updatedAt: "刚刚",
      }]);
    },
  }), [creators, knowledgeBases]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
