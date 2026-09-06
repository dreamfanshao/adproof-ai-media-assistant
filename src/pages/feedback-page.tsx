import { Bug, HelpCircle, Lightbulb, MessageSquarePlus, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { AppShell } from "../components/app-shell";
import { Badge, Button, Card, EmptyState } from "../components/ui";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

type FeedbackCategory = "bug" | "suggestion" | "question" | "other";
type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed";

interface FeedbackTicket {
  id: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  page_path: string | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string; hint: string; icon: typeof Bug }> = [
  { value: "bug", label: "Bug 反馈", hint: "功能异常、报错或结果不符合预期", icon: Bug },
  { value: "suggestion", label: "功能建议", hint: "告诉我们怎样让工作更顺手", icon: Lightbulb },
  { value: "question", label: "使用问题", hint: "需要了解功能或操作方式", icon: HelpCircle },
  { value: "other", label: "其他", hint: "其他意见、合作或账号问题", icon: MessageSquarePlus },
];

const STATUS_LABEL: Record<FeedbackStatus, { label: string; tone: "brand" | "warning" | "success" | "neutral" }> = {
  open: { label: "待处理", tone: "brand" },
  in_progress: { label: "处理中", tone: "warning" },
  resolved: { label: "已解决", tone: "success" },
  closed: { label: "已关闭", tone: "neutral" },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function FeedbackPage() {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const accessToken = session?.access_token ?? "";
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pagePath, setPagePath] = useState(typeof location.state?.from === "string" ? location.state.from : "");
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleAuthError = useCallback((reason: unknown) => {
    if (reason instanceof ApiClientError && reason.status === 401) {
      void signOut().catch(() => undefined);
      return true;
    }
    return false;
  }, [signOut]);

  const loadTickets = useCallback(async (quiet = false) => {
    if (!accessToken) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const response = await apiRequest<{ data: FeedbackTicket[] }>("/feedback-tickets", accessToken);
      setTickets(response.data);
      setError(null);
    } catch (reason) {
      if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "暂时无法加载工单。");
    } finally {
      if (quiet) setRefreshing(false); else setLoading(false);
    }
  }, [accessToken, handleAuthError]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  const selectedCategory = useMemo(() => CATEGORY_OPTIONS.find((option) => option.value === category) ?? CATEGORY_OPTIONS[0], [category]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest("/feedback-tickets", accessToken, {
        method: "POST",
        body: JSON.stringify({ category, title: title.trim(), description: description.trim(), page_path: pagePath.trim() || null }),
      });
      setTitle("");
      setDescription("");
      setSuccess("已收到你的反馈，我们会尽快处理。");
      await loadTickets(true);
    } catch (reason) {
      if (!handleAuthError(reason)) setError(reason instanceof Error ? reason.message : "提交失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell title="意见反馈" subtitle="遇到问题随时告诉我们，反馈会进入工单队列。">
      <div className="feedback-page">
        <section className="feedback-hero" aria-labelledby="feedback-heading">
          <div><span className="feedback-eyebrow">SUPPORT DESK</span><h2 id="feedback-heading">让每一次反馈都有回音</h2><p>描述你遇到的情况、复现步骤和期望结果，我们会根据工单状态持续跟进。</p></div>
          <div className="feedback-hero__mark" aria-hidden="true"><MessageSquarePlus size={27} /></div>
        </section>
        <div className="feedback-grid">
          <Card className="feedback-form-card">
            <header className="feedback-card-heading"><div><span className="feedback-kicker">NEW TICKET</span><h3>提交一条反馈</h3></div><span className="feedback-card-icon"><Send size={17} /></span></header>
            <form onSubmit={(event) => void submit(event)} className="feedback-form">
              <fieldset><legend>反馈类型</legend><div className="feedback-category-grid">{CATEGORY_OPTIONS.map((option) => { const Icon = option.icon; return <button key={option.value} type="button" className={`feedback-category ${category === option.value ? "is-selected" : ""}`} onClick={() => setCategory(option.value)} aria-pressed={category === option.value}><Icon size={17} aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.hint}</small></span></button>; })}</div></fieldset>
              <label className="feedback-field">标题<span>*</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={selectedCategory.value === "bug" ? "例如：评测集测试后状态没有保持" : "用一句话概括你的反馈"} required /></label>
              <label className="feedback-field">问题描述<span>*</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} placeholder="请写下复现步骤、实际结果和期望结果；如果有截图或日志，也可以在这里粘贴。" required /></label>
              <label className="feedback-field">发生页面（可选）<input value={pagePath} onChange={(event) => setPagePath(event.target.value)} maxLength={500} placeholder="例如：/creators" /></label>
              <p className="feedback-privacy">工单仅对当前账号可见。我们会通过你的登录邮箱跟进，不会公开你的反馈内容。</p>
              {error && <div className="form-message form-message--error" role="alert">{error}</div>}
              {success && <div className="form-message form-message--success" role="status">{success}</div>}
              <div className="feedback-submit-row"><Button type="submit" loading={submitting} icon={<Send size={16} />} disabled={!title.trim() || !description.trim()}>提交反馈</Button><span>{description.length}/5000</span></div>
            </form>
          </Card>
          <Card className="feedback-list-card">
            <header className="feedback-card-heading"><div><span className="feedback-kicker">MY TICKETS</span><h3>我的工单 <span>{tickets.length}</span></h3></div><button type="button" className="feedback-refresh" onClick={() => void loadTickets(true)} disabled={refreshing} aria-label="刷新工单"><RefreshCw size={16} className={refreshing ? "spin" : ""} />刷新</button></header>
            {loading ? <div className="feedback-list-loading" aria-live="polite">正在加载工单…</div> : tickets.length === 0 ? <EmptyState title="还没有提交过工单" description="遇到问题或有改进建议时，从左侧表单提交第一条反馈。" /> : <div className="feedback-ticket-list">{tickets.map((ticket) => { const status = STATUS_LABEL[ticket.status]; return <article className="feedback-ticket" key={ticket.id}><div className="feedback-ticket__top"><Badge tone={ticket.category === "bug" ? "danger" : ticket.category === "suggestion" ? "warning" : "brand"}>{CATEGORY_OPTIONS.find((option) => option.value === ticket.category)?.label ?? "其他"}</Badge><Badge tone={status.tone}>{status.label}</Badge><time dateTime={ticket.created_at}>{formatDate(ticket.created_at)}</time></div><h4>{ticket.title}</h4><p>{ticket.description}</p>{ticket.admin_reply && <div className="feedback-ticket__reply"><strong>处理回复</strong><span>{ticket.admin_reply}</span></div>}{ticket.page_path && <small className="feedback-ticket__path">页面：{ticket.page_path}</small>}</article>; })}</div>}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

