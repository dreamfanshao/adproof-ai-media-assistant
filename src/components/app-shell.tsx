import {
  BookOpen, CheckCircle2, ClipboardCheck, FolderKanban, Home, Search, ShieldAlert,
  KeyRound, LogOut, MessageSquarePlus, UserRoundCheck, UserRoundX, X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type PropsWithChildren, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Button, Modal } from "./ui";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { useAuth } from "../state/auth-context";
import { ALL_PROJECTS_SCOPE, useProjectScope } from "../state/project-scope";

const navItems = [
  { to: "/dashboard", label: "首页", icon: Home },
  { to: "/projects", label: "项目管理", icon: FolderKanban },
  { to: "/creators", label: "找达人", icon: Search },
  { to: "/selected", label: "已选达人", icon: UserRoundCheck },
  { to: "/discarded", label: "已弃用达人", icon: UserRoundX },
  { to: "/audit/new", label: "新建审核", icon: ClipboardCheck },
  { to: "/audit/history", label: "审核记录", icon: ShieldAlert },
  { to: "/knowledge", label: "知识库", icon: BookOpen },
  { to: "/feedback", label: "意见反馈", icon: MessageSquarePlus },
];

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? "brand--inverse" : ""}`}>
      <span className="brand__mark" aria-hidden="true" />
      <span className="brand__copy">
        <strong>媒介助手</strong>
        <small>ADPROOF WORKSPACE</small>
      </span>
    </div>
  );
}

interface AppShellProps extends PropsWithChildren {
  title: string;
  subtitle: string;
  activePath?: string;
  action?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  showProjectSelector?: boolean;
}

export function AppShell({ title, subtitle, action, children, mobileOpen, onMobileClose, showProjectSelector = false }: AppShellProps) {
  const { user, profile, profileError, session, signOut } = useAuth();
  const handleApiKeyAuthExpired = useCallback(() => { void signOut(); }, [signOut]);
  const email = user?.email ?? "已登录用户";
  const displayName = profile?.display_name ?? (typeof user?.user_metadata.display_name === "string"
    ? user.user_metadata.display_name
    : email.split("@")[0] || "媒介专员");

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <button className="sidebar__close" onClick={onMobileClose} aria-label="关闭导航"><X size={20} /></button>
        <Brand inverse />
        <nav className="sidebar__nav" aria-label="主要导航">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `sidebar__link ${isActive ? "is-active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <ApiKeyControl accessToken={session?.access_token ?? ""} onAuthExpired={handleApiKeyAuthExpired} />
        <div className="sidebar__profile">
          <div className="avatar avatar--small">媒</div>
          <div className="sidebar__identity"><strong>{displayName}</strong><span title={profileError ?? email}>{email}</span></div>
          <button className="sidebar__logout" type="button" onClick={() => void signOut()} aria-label="退出登录" title="退出登录"><LogOut size={16} /></button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" onClick={onMobileClose} aria-label="关闭导航" />}
      <div className="app-shell__body">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {(showProjectSelector || action) && <div className="topbar__action topbar__action--workspace">
            {showProjectSelector && <ProjectSwitcher />}
            {action}
          </div>}
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

function ProjectSwitcher() {
  const { activeProjects, scopeId, loading, selectScope } = useProjectScope();
  return (
    <label className="project-switcher">
      <span>项目范围</span>
      <select value={scopeId || ALL_PROJECTS_SCOPE} onChange={(event) => selectScope(event.target.value)} disabled={loading} aria-label="选择项目范围">
        <option value={ALL_PROJECTS_SCOPE}>所有项目</option>
        {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>
  );
}

export function DemoBanner() {
  return null;
}

type ApiKeyCredential = {
  configured: boolean;
  source: "user" | "system" | "none";
  replaceable: boolean;
};

function ApiKeyControl({ accessToken, onAuthExpired }: { accessToken: string; onAuthExpired: () => void }) {
  const [credential, setCredential] = useState<ApiKeyCredential | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<{ data: ApiKeyCredential }>("/redfox-credential", accessToken)
      .then((response) => setCredential(response.data))
      .catch((reason: unknown) => {
        if (reason instanceof ApiClientError && reason.status === 401) onAuthExpired();
      });
  }, [accessToken, onAuthExpired]);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setValue("");
    setError(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const apiKey = value.trim();
    if (!accessToken || apiKey.length < 16 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: ApiKeyCredential }>("/redfox-credential", accessToken, {
        method: "PUT",
        body: JSON.stringify({ api_key: apiKey }),
      });
      setCredential(response.data);
      close();
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.status === 401) onAuthExpired();
      else setError(reason instanceof Error ? reason.message : "API Key 保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="sidebar__api-key"
        onClick={() => { setValue(""); setError(null); setOpen(true); }}
        disabled={credential ? !credential.replaceable : false}
        title={credential?.source === "user" ? "更换个人 API Key" : "配置个人 API Key"}
      >
        <KeyRound size={15} aria-hidden="true" />
        <span>{credential?.source === "user" ? "更换 API Key" : "配置 API Key"}</span>
      </button>
      <Modal open={open} title="配置 API Key" onClose={close} className="modal--credential">
        <form className="modal-form credential-form" onSubmit={(event) => void save(event)}>
          <label>
            API Key
            <input autoFocus type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} minLength={16} maxLength={500} required />
          </label>
          <p className="credential-security-note">密钥仅在服务端加密保存，不会回显到页面或写入日志。</p>
          {error && <div className="form-message form-message--error" role="alert">{error}</div>}
          <div><Button tone="secondary" type="button" onClick={close} disabled={saving}>取消</Button><Button type="submit" loading={saving} disabled={value.trim().length < 16}>保存</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function StatusDot({ tone = "default" }: { tone?: "default" | "success" | "warning" | "danger" }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

export function SuccessMark() {
  return <CheckCircle2 size={18} color="var(--color-text-success)" aria-hidden="true" />;
}
