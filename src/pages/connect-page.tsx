import { Check, LockKeyhole, QrCode, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Brand } from "../components/app-shell";
import { Button } from "../components/ui";
import { ApiClientError, apiRequest } from "../lib/api-client";
import { useAuth } from "../state/auth-context";

type ConnectionStatus =
  | "disconnected"
  | "qr_pending"
  | "qr_scanned"
  | "connected"
  | "expired"
  | "restricted"
  | "failed";

interface PlatformConnection {
  id: string | null;
  task_id: string | null;
  platform: "xiaohongshu";
  status: ConnectionStatus;
  qr_image_url: string | null;
  qr_expires_at: string | null;
  session_expires_at: string | null;
  last_verified_at: string | null;
  account_display_name: string | null;
  account_handle_masked: string | null;
  avatar_url: string | null;
  message_code: string | null;
}

interface PlatformConnectionResponse {
  data: PlatformConnection;
}

const statusCopy: Record<ConnectionStatus, string> = {
  disconnected: "点击下方按钮获取二维码",
  qr_pending: "请使用小红书 App 扫码",
  qr_scanned: "已扫码，请在手机端确认…",
  connected: "连接成功",
  expired: "二维码已过期，请重新获取",
  restricted: "小红书当前网络触发安全验证（300012），暂时无法生成二维码",
  failed: "连接失败，请重新获取二维码",
};

export function ConnectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { session, signOut } = useAuth();
  const accessToken = session?.access_token ?? "";
  const [connection, setConnection] = useState<PlatformConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConnection = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await apiRequest<PlatformConnectionResponse>(
        "/platform-connections/xiaohongshu",
        accessToken,
      );
      setConnection(response.data);
      setError(null);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        await signOut().catch(() => undefined);
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "连接状态读取失败。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, location.pathname, location.search, navigate, signOut]);

  useEffect(() => { void loadConnection(); }, [loadConnection]);

  useEffect(() => {
    if (!connection || !["qr_pending", "qr_scanned", "restricted"].includes(connection.status)) return;
    const timer = window.setInterval(() => { void loadConnection(); }, 1_000);
    return () => window.clearInterval(timer);
  }, [connection, loadConnection]);

  const startConnection = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<PlatformConnectionResponse>(
        "/platform-connections/xiaohongshu",
        accessToken,
        { method: "POST" },
      );
      setConnection(response.data);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        await signOut().catch(() => undefined);
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "二维码生成失败。");
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      await apiRequest<void>("/platform-connections/xiaohongshu", accessToken, { method: "DELETE" });
      await loadConnection();
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        await signOut().catch(() => undefined);
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "断开连接失败。");
    } finally {
      setLoading(false);
    }
  };

  // 平台要求安全验证时由用户主动打开验证窗口（不自动弹窗打扰）
  const openVerification = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<PlatformConnectionResponse>(
        "/platform-connections/xiaohongshu/verify",
        accessToken,
        { method: "POST" },
      );
      setConnection(response.data);
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        await signOut().catch(() => undefined);
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "无法打开验证窗口。");
    } finally {
      setLoading(false);
    }
  };

  const status = connection?.status ?? "disconnected";
  const returnTo = searchParams.get("returnTo");
  const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard";
  const canRetry = ["disconnected", "expired", "failed", "restricted"].includes(status);
  const statusIcon = useMemo(() => {
    if (status === "connected") return <Check size={56} />;
    if (status === "restricted" || status === "failed") return <ShieldAlert size={56} />;
    return <QrCode size={112} strokeWidth={1.3} />;
  }, [status]);

  useEffect(() => {
    if (status !== "connected" || !returnTo) return;
    const timer = window.setTimeout(() => {
      navigate(safeReturnTo, { replace: true, state: location.state });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [location.state, navigate, returnTo, safeReturnTo, status]);

  return (
    <main className="connect-page">
      <section className="connect-card">
        <Brand />
        <header><h1>扫码登录小红书</h1><p>二维码直接显示在本页；登录有效期内无需重复扫码。</p></header>
        <div className={`qr-panel ${status === "connected" ? "is-connected" : ""}`} aria-live="polite">
          {connection?.qr_image_url && status === "qr_pending"
            ? <img src={connection.qr_image_url} alt="小红书登录二维码" />
            : statusIcon}
        </div>
        <strong>{loading ? "正在连接小红书…" : connection?.message_code === "XHS_QR_ENTRY_UNAVAILABLE" ? "小红书登录入口暂未返回二维码，请重试" : statusCopy[status]}</strong>
        {error && <div className="form-message form-message--error connect-error">{error}</div>}
        {canRetry && <Button loading={loading} onClick={() => void startConnection()}>{status === "restricted" ? "更换网络后重试" : "获取登录二维码"}</Button>}
        <div className="security-note"><LockKeyhole size={16} /><span>{status === "restricted" ? "小红书返回 300012 安全限制。应用不会弹出浏览器窗口，请更换可靠网络环境后再重试。" : "当前开发版会话仅保存在本机内存；系统不会记录账号密码、验证码或输出 Cookie。"}</span></div>
        {status === "connected" && (
          <div className="connect-actions">
            <Button onClick={() => navigate(safeReturnTo, { state: location.state })}>{returnTo ? "继续本次检索" : "进入工作台"}</Button>
            <Button tone="secondary" loading={loading} onClick={() => void disconnect()}>断开连接</Button>
          </div>
        )}
        <footer>1 扫码&nbsp;&nbsp;·&nbsp;&nbsp;2 手机确认&nbsp;&nbsp;·&nbsp;&nbsp;3 自动返回工作台</footer>
      </section>
    </main>
  );
}
