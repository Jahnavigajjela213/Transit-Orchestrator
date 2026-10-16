import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import Attention from "./pages/Attention";
import Measures from "./pages/Measures";
import Workflows from "./pages/Workflows";
import WorkflowDetail from "./pages/WorkflowDetail";
import WorkOrders from "./pages/WorkOrders";
import Audit from "./pages/Audit";
import Policies from "./pages/Policies";
import Shadow from "./pages/Shadow";
import Evals from "./pages/Evals";
import Simulate from "./pages/Simulate";
import DashboardIndex from "./pages/dashboard";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <LiveProvider key={user.id}>{children}</LiveProvider>;
}

/** Old addresses of pages that now live as tabs of the Simulate playground; keeps query strings such as ?workflow=. */
function ToSimulate({ tab }: { tab: string }) {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  q.set("tab", tab);
  return <Navigate to={`/simulate?${q}`} replace />;
}

// The demo is scoped to the vehicle-health orchestration. Overview, Fleet, Safety, Performance, Assistant, Events
// and the old Simulator pages are kept in src/pages but not routed. Raising faults and the scheduling and rider data live
// in the Simulate playground.
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<DashboardIndex />} />
              <Route path="attention" element={<Attention />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="workflows/:id" element={<WorkflowDetail />} />
              <Route path="work-orders" element={<WorkOrders />} />
              <Route path="simulate" element={<Simulate />} />
              <Route path="schedule" element={<ToSimulate tab="scheduling" />} />
              <Route path="riders" element={<ToSimulate tab="riders" />} />
              <Route path="simulator" element={<ToSimulate tab="fault" />} />
              <Route path="policies" element={<Policies />} />
              <Route path="shadow" element={<Shadow />} />
              <Route path="evals" element={<Evals />} />
              <Route path="measures" element={<Measures />} />
              <Route path="audit" element={<Audit />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
