import type { PropsWithChildren } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../state/auth-context";

function AuthLoading() {
  return <main className="auth-status-page" aria-live="polite">正在检查登录状态…</main>;
}

export function ProtectedRoutes() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <AuthLoading />;
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function AnonymousOnly({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <AuthLoading />;
  if (status === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from;
    const safeFrom = from?.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";
    return <Navigate to={safeFrom} replace />;
  }
  return children;
}
