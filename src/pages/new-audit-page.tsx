import { FileImage, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, DemoBanner } from "../components/app-shell";
import { Button, Card } from "../components/ui";
import { apiRequest, ApiClientError } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

interface KnowledgeBase {
  id: string;
  name: string;
  scope: string;
  status: string;
  selectable: boolean;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function NewAuditPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAuthError = useCallback((requestError: unknown): boolean => {
    if (requestError instanceof ApiClientError && requestError.status === 401) {
      void signOut().catch(() => undefined);
      return true;
    }
    return false;
  }, [signOut]);

  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<{ data: KnowledgeBase[] }>("/knowledge-bases", accessToken)
      .then((response) => {
        const privates = response.data.filter((kb) => kb.scope === "private" && kb.selectable);
        setKbs(privates);
      })
      .catch((requestError) => { if (!handleAuthError(requestError)) setError(requestError instanceof Error ? requestError.message : "加载知识库失败。"); });
  }, [accessToken, handleAuthError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || loading) return;
    setLoading(true);
    setError(null);
    try {
      const draft = await apiRequest<{ data: { id: string } }>("/audit-tasks", accessToken, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), private_knowledge_base_ids: selectedKbIds }),
      });
      const taskId = draft.data.id;
      // 上传图片（≤9 张）
      for (let index = 0; index < Math.min(files.length, 9); index += 1) {
        const file = files[index];
        if (file.size > 10 * 1024 * 1024) continue;
        const checksum = await sha256Hex(file);
        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const intent = await apiRequest<{ data: { upload_id: string; storage_path: string; upload_url: string; required_headers: Record<string, string> } }>(
          "/audit-asset-upload-intents",
          accessToken,
          { method: "POST", body: JSON.stringify({ audit_task_id: taskId, file_name: file.name, mime_type: mimeType, size_bytes: file.size, checksum_sha256: checksum }) },
        );
        const put = await fetch(intent.data.upload_url, { method: "PUT", headers: intent.data.required_headers, body: file });
        if (!put.ok) throw new Error(`图片上传失败（${put.status}）。`);
        await apiRequest("/audit-asset-upload-intents/commit", accessToken, {
          method: "POST",
          body: JSON.stringify({ audit_task_id: taskId, upload_id: intent.data.upload_id, storage_path: intent.data.storage_path, file_name: file.name, mime_type: mimeType, size_bytes: file.size, checksum_sha256: checksum, sort_order: index }),
        });
      }
      await apiRequest(`/audit-tasks/${taskId}/submit`, accessToken, { method: "POST", body: "{}" });
      navigate(`/audit/result?taskId=${taskId}`);
    } catch (requestError) {
      if (!handleAuthError(requestError)) setError(requestError instanceof Error ? requestError.message : "提交失败。");
      setLoading(false);
    }
  };

  return (
    <AppShell title="新建内容审核" subtitle="上传图文并选择本次适用的规则库。" action={<Button tone="secondary" disabled>保存草稿</Button>}>
      <DemoBanner />
      {error && <div className="form-message form-message--error">{error}</div>}
      <header className="page-intro"><h2>新建审核任务</h2><p>当前审核标题、正文和图片（图片暂未自动抽取文字，将提示人工复核）。</p></header>
      <form className="audit-form-grid" onSubmit={submit}>
        <Card className="audit-fields">
          <label>图文标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：光子嫩肤超全攻略" required /></label>
          <label>正文<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="粘贴图文正文内容…" required /></label>
          <label>图片 <span>（选填，最多 9 张）</span></label>
          <button className="upload-zone" type="button" onClick={() => fileRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = Array.from(event.dataTransfer.files ?? []).filter((f) => f.type === "image/png" || f.type === "image/jpeg").slice(0, 9);
              if (dropped.length) setFiles((prev) => [...prev, ...dropped].slice(0, 9));
            }}>
            {files.length ? <><FileImage size={28} /><strong>已添加 {files.length} 张图片</strong><span>提交后图片内容将提示人工复核</span></> : <><UploadCloud size={30} /><strong>点击上传或拖拽图片到这里</strong><span>支持 JPG、PNG，单张不超过 10 MB</span></>}
          </button>
          <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 9))} />
        </Card>
        <aside className="audit-sidebar">
          <Card><h3>审核规则</h3><label className="check-row"><input type="checkbox" checked disabled />中华人民共和国广告法 <span>公共基础库 · 不可关闭</span></label>{kbs.map((kb) => <label className="check-row" key={kb.id}><input type="checkbox" checked={selectedKbIds.includes(kb.id)} onChange={(event) => setSelectedKbIds((prev) => event.target.checked ? [...prev, kb.id] : prev.filter((id) => id !== kb.id))} />{kb.name}</label>)}<p>未选择私有规则时，系统仅完成广告法基础检查。</p></Card>
          <Button type="submit" loading={loading}>开始审核</Button>
          <small>AI 结果仅作辅助，不构成法律意见。</small>
        </aside>
      </form>
    </AppShell>
  );
}
