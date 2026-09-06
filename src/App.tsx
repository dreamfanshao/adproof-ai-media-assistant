import { Navigate, Route, Routes } from "react-router-dom";
import { AnonymousOnly, ProtectedRoutes } from "./components/auth-route";
import { AuditHistoryPage } from "./pages/audit-history-page";
import { AuditResultPage } from "./pages/audit-result-page";
import { ConnectPage } from "./pages/connect-page";
import { CreatorsPage } from "./pages/creators-page";
import { DashboardPage } from "./pages/dashboard-page";
import { DiscardedPage } from "./pages/discarded-page";
import { KnowledgePage } from "./pages/knowledge-page";
import { FeedbackPage } from "./pages/feedback-page";
import { LoginPage } from "./pages/login-page";
import { NewAuditPage } from "./pages/new-audit-page";
import { ProjectManagementPage } from "./pages/project-management-page";
import { SelectedPage } from "./pages/selected-page";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<AnonymousOnly><LoginPage /></AnonymousOnly>} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectManagementPage />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/selected" element={<SelectedPage />} />
        <Route path="/discarded" element={<DiscardedPage />} />
        <Route path="/audit/new" element={<NewAuditPage />} />
        <Route path="/audit/result" element={<AuditResultPage />} />
        <Route path="/audit/history" element={<AuditHistoryPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
