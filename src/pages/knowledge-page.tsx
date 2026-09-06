import { BookMarked, Eye, FileStack, FileText, Plus, ShieldCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Badge, Button, Card, EmptyState, Modal, SearchInput } from "../components/ui";
import { apiRequest, ApiClientError } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

interface KnowledgeBase {
  id: string;
  name: string;
  scope: "public_law" | "private";
  status: string;
  document_count: number;
  ready_document_count: number;
  selectable: boolean;
  description: string | null;
  created_at: string;
}

interface KnowledgeDocument {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  status: string;
  version: number;
  chunk_count: number | null;
  error_code: string | null;
  created_at: string;
}

interface KnowledgeChunk {
  id: string;
  chunk_index: number;
  content: string;
  source_locator: string;
  metadata: unknown;
}

interface KnowledgeContentResponse {
  data: { document: KnowledgeDocument; chunks: KnowledgeChunk[] };
  meta: { total: number; offset: number; limit: number; has_more: boolean };
}

const KB_STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ready: { label: "可用", tone: "success" },
  processing: { label: "处理中", tone: "warning" },
  empty: { label: "空", tone: "neutral" },
  needs_attention: { label: "需处理", tone: "warning" },
  failed: { label: "失败", tone: "danger" },
};

const DOC_STATUS_LABEL: Record<string, string> = {
  uploaded: "已上传",
  parsing: "解析中",
  chunking: "切块中",
  validating: "校验中",
  ready: "就绪",
  failed: "失败",
  needs_attention: "需处理",
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function KnowledgePage() {
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [docsByKb, setDocsByKb] = useState<Record<string, KnowledgeDocument[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [uploadingKb, setUploadingKb] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ kbName: string; document: KnowledgeDocument } | null>(null);
  const [previewChunks, setPreviewChunks] = useState<KnowledgeChunk[]>([]);
  const [previewMeta, setPreviewMeta] = useState<KnowledgeContentResponse["meta"] | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAuthError = useCallback((requestError: unknown): boolean => {
    if (requestError instanceof ApiClientError && requestError.status === 401) {
      void signOut().catch(() => undefined);
      return true;
    }
    return false;
  }, [signOut]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await apiRequest<{ data: KnowledgeBase[] }>("/knowledge-bases", accessToken);
      setKbs(response.data);
      const docsMap: Record<string, KnowledgeDocument[]> = {};
      await Promise.all(response.data.map(async (kb) => {
        try {
          const docs = await apiRequest<{ data: KnowledgeDocument[] }>(`/knowledge-bases/${kb.id}/documents`, accessToken);
          docsMap[kb.id] = docs.data;
        } catch { docsMap[kb.id] = []; }
      }));
      setDocsByKb(docsMap);
      setError(null);
    } catch (requestError) {
      if (!handleAuthError(requestError)) setError(requestError instanceof Error ? requestError.message : "加载知识库失败。");
    }
  }, [accessToken, handleAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    try {
      await apiRequest("/knowledge-bases", accessToken, { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      setOpen(false);
      await load();
    } catch (requestError) {
      if (!handleAuthError(requestError)) setError(requestError instanceof Error ? requestError.message : "创建失败。");
    }
  };

  const uploadDocument = async (kb: KnowledgeBase) => {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !accessToken) return;
    const mimeType = file.type === "application/pdf" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.type === "text/markdown"
      ? file.type
      : "text/plain";
    if (file.size > 20 * 1024 * 1024) { setError("文件不能超过 20MB。"); return; }
    setUploadingKb(kb.id);
    setUploading(true);
    setError(null);
    try {
      const checksum = await sha256Hex(file);
      const intent = await apiRequest<{ data: { upload_id: string; storage_path: string; upload_url: string; required_headers: Record<string, string> } }>(
        `/knowledge-bases/${kb.id}/document-upload-intents`,
        accessToken,
        { method: "POST", body: JSON.stringify({ file_name: file.name, mime_type: mimeType, size_bytes: file.size, checksum_sha256: checksum }) },
      );
      const put = await fetch(intent.data.upload_url, { method: "PUT", headers: intent.data.required_headers, body: file });
      if (!put.ok) throw new Error(`上传失败（${put.status}）。`);
      await apiRequest(`/knowledge-bases/${kb.id}/documents`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          upload_id: intent.data.upload_id,
          storage_path: intent.data.storage_path,
          file_name: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
          checksum_sha256: checksum,
        }),
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
      // 轮询文档状态（最多 90 秒）
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        await load();
        const docs = docsByKb[kb.id] ?? [];
        const target = docs.find((d) => d.file_name === file.name);
        if (target && (target.status === "ready" || target.status === "failed" || target.status === "needs_attention")) break;
      }
    } catch (requestError) {
      if (!handleAuthError(requestError)) setError(requestError instanceof Error ? requestError.message : "上传失败。");
    } finally {
      setUploading(false);
      setUploadingKb(null);
    }
  };

  const loadDocumentContent = async (document: KnowledgeDocument, offset = 0, append = false) => {
    if (!accessToken) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await apiRequest<KnowledgeContentResponse>(
        `/knowledge-documents/${document.id}/content?offset=${offset}&limit=50`,
        accessToken,
      );
      setPreviewChunks((current) => append ? [...current, ...response.data.chunks] : response.data.chunks);
      setPreviewMeta(response.meta);
    } catch (requestError) {
      if (!handleAuthError(requestError)) {
        setPreviewError(requestError instanceof Error ? requestError.message : "读取文档内容失败。");
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const openDocumentContent = (kb: KnowledgeBase, document: KnowledgeDocument) => {
    setPreview({ kbName: kb.name, document });
    setPreviewChunks([]);
    setPreviewMeta(null);
    setPreviewQuery("");
    setPreviewError(null);
    void loadDocumentContent(document);
  };

  const closeDocumentContent = () => {
    setPreview(null);
    setPreviewChunks([]);
    setPreviewMeta(null);
    setPreviewQuery("");
    setPreviewError(null);
  };

  const visiblePreviewChunks = previewQuery.trim()
    ? previewChunks.filter((chunk) => `${chunk.source_locator}\n${chunk.content}`.toLocaleLowerCase().includes(previewQuery.trim().toLocaleLowerCase()))
    : previewChunks;

  return (
    <AppShell title="私有知识库" subtitle="上传企业或行业规则，补充公共内容审核规则。" action={<Button onClick={() => setOpen(true)} icon={<Plus size={16} />}>新建知识库</Button>}>
      <DemoBanner />
      {error && <div className="form-message form-message--error">{error}</div>}
      <section className="public-law public-law--documents">
        <ShieldCheck size={24} aria-hidden="true" />
        <div className="public-law__body">
          <h2>公共知识库 · 审核依据（只读）</h2>
          <p>平台维护的广告法与小红书审核依据对所有用户开放查看；私有规则只能补充，不能降低公共规则要求。</p>
          <span>点击“查看内容”可阅读已解析的条款与来源定位。</span>
          <div className="public-law__docs">
            {kbs.filter((kb) => kb.scope === "public_law").flatMap((kb) => (docsByKb[kb.id] ?? []).map((doc) => ({ kb, doc }))).map(({ kb, doc }) => (
              <div className="public-law__doc" key={doc.id}>
                <div className="public-law__doc-identity"><FileText size={15} aria-hidden="true" /><strong title={doc.file_name}>{doc.file_name}</strong><Badge tone={doc.status === "ready" ? "success" : doc.status === "failed" ? "danger" : "warning"}>{DOC_STATUS_LABEL[doc.status] ?? doc.status}</Badge></div>
                <Button
                  tone="ghost"
                  className="kb-doc__view"
                  icon={<Eye size={14} />}
                  disabled={doc.status !== "ready"}
                  title={doc.status === "ready" ? `查看 ${doc.file_name} 的解析内容` : "文档解析完成后可查看内容"}
                  onClick={() => openDocumentContent(kb, doc)}
                >查看内容</Button>
              </div>
            ))}
            {kbs.some((kb) => kb.scope === "public_law") && !kbs.filter((kb) => kb.scope === "public_law").some((kb) => (docsByKb[kb.id] ?? []).length > 0) && (
              <span className="public-law__empty">公共依据文档正在准备，解析完成后会显示在这里。</span>
            )}
          </div>
        </div>
      </section>
      <section className="section-block"><h2>我的私有知识库 {kbs.filter((kb) => kb.scope === "private").length}</h2>
        <div className="kb-grid">
          {kbs.filter((kb) => kb.scope === "private").map((kb) => {
            const meta = KB_STATUS_LABEL[kb.status] ?? { label: kb.status, tone: "neutral" as const };
            const docs = docsByKb[kb.id] ?? [];
            return (
              <Card className="kb-card" key={kb.id}>
                <BookMarked size={22} />
                <h3>{kb.name}</h3>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <p>{kb.document_count} 份文档 · {kb.ready_document_count} 份就绪<br />用户私有 · 仅当前账号可见</p>
                <div className="kb-docs">
                  {docs.map((doc) => (
                    <div className="kb-doc" key={doc.id}>
                      <div className="kb-doc__identity"><FileText size={15} aria-hidden="true" /><span title={doc.file_name}>{doc.file_name}</span></div>
                      <div className="kb-doc__actions">
                        <Badge tone={doc.status === "ready" ? "success" : doc.status === "failed" ? "danger" : "warning"}>{DOC_STATUS_LABEL[doc.status] ?? doc.status}</Badge>
                        <Button
                          tone="ghost"
                          className="kb-doc__view"
                          icon={<Eye size={14} />}
                          disabled={doc.status !== "ready"}
                          title={doc.status === "ready" ? `查看 ${doc.file_name} 的解析内容` : "解析完成后可查看内容"}
                          onClick={() => openDocumentContent(kb, doc)}
                        >查看内容</Button>
                      </div>
                    </div>
                  ))}
                  {docs.length === 0 && <span className="kb-docs__empty">尚未上传文档</span>}
                </div>
                <label className="kb-upload">
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" hidden
                    onChange={() => void uploadDocument(kb)} disabled={uploading} />
                  <Button tone="secondary" disabled={uploading && uploadingKb === kb.id} icon={<UploadCloud size={15} />} onClick={() => fileInputRef.current?.click()}>
                    {uploading && uploadingKb === kb.id ? "上传中…" : "上传文档"}
                  </Button>
                </label>
              </Card>
            );
          })}
        </div>
      </section>
      <Card className="kb-flow"><FileStack size={24} /><div><h3>规则文档处理流程</h3><p>上传文件 → 解析条款与章节 → 切块 → 审核时按版本召回 → 风险项引用来源</p><span>解析失败的文档不会进入可选规则库；规则冲突时会同时展示。</span></div></Card>
      <Modal
        open={Boolean(preview)}
        title={preview ? `文档内容 · ${preview.document.file_name}` : "文档内容"}
        onClose={closeDocumentContent}
        className="modal--knowledge-preview"
      >
        {preview && (
          <div className="knowledge-preview">
            <div className="knowledge-preview__summary">
              <div><span>所属知识库</span><strong>{preview.kbName}</strong></div>
              <div><span>文档信息</span><strong>{formatFileSize(preview.document.size_bytes)} · {preview.document.chunk_count ?? 0} 个内容分段</strong></div>
              <div><span>上传时间</span><strong>{formatDate(preview.document.created_at)}</strong></div>
            </div>
            <div className="knowledge-preview__toolbar">
              <SearchInput
                value={previewQuery}
                onChange={(event) => setPreviewQuery(event.target.value)}
                placeholder="在已加载内容中搜索"
                aria-label="搜索文档内容"
              />
              <span>已加载 {previewChunks.length} / {previewMeta?.total ?? preview.document.chunk_count ?? 0} 段</span>
            </div>
            {previewError && <div className="form-message form-message--error">{previewError}</div>}
            <div className="knowledge-preview__content" aria-live="polite" aria-busy={previewLoading}>
              {previewLoading && previewChunks.length === 0 && <div className="knowledge-preview__loading">正在读取解析内容…</div>}
              {!previewLoading && !previewError && visiblePreviewChunks.length === 0 && (
                <EmptyState
                  title={previewQuery ? "没有匹配内容" : "暂时没有可展示的正文"}
                  description={previewQuery ? "换一个关键词搜索已加载的内容。" : "文档可能尚未完成解析，请稍后刷新知识库。"}
                />
              )}
              {visiblePreviewChunks.map((chunk) => (
                <article className="knowledge-chunk" key={chunk.id}>
                  <header><span>内容分段 {chunk.chunk_index + 1}</span><code>{chunk.source_locator || "未标注位置"}</code></header>
                  <p>{chunk.content}</p>
                </article>
              ))}
            </div>
            {previewMeta?.has_more && !previewQuery && (
              <div className="knowledge-preview__footer">
                <Button
                  tone="secondary"
                  loading={previewLoading}
                  onClick={() => void loadDocumentContent(preview.document, previewChunks.length, true)}
                >加载更多内容</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal open={open} title="新建私有知识库" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={create}><label>知识库名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：品牌内容审核规范" required /></label><p>创建后可上传 PDF、DOCX、TXT 或 Markdown 规则文档。</p><div><Button tone="secondary" type="button" onClick={() => setOpen(false)}>取消</Button><Button type="submit">创建知识库</Button></div></form></Modal>
    </AppShell>
  );
}
