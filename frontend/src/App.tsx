import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import { Page, SandboxProvider } from "./components/focus";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Workflows from "./pages/Workflows";
import WorkflowDetail from "./pages/WorkflowDetail";
import WorkOrders from "./pages/WorkOrders";
import Audit from "./pages/Audit";
import Policies from "./pages/Policies";
import Shadow from "./pages/Shadow";
import Simulate from "./pages/Simulate";
import Overview from "./pages/Overview";
import Assistant from "./pages/Assistant";
import Performance from "./pages/Performance";
import Fleet from "./pages/Fleet";
import Safety from "./pages/Safety";
import Events from "./pages/Events";
import Evals from "./pages/Evals";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <LiveProvider key={user.id}>{children}</LiveProvider>;
}

/** Old addresses keep working: they forward to the new place, keeping query strings such as ?workflow=. */
function To({ path, tab }: { path: string; tab?: string }) {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  if (tab) q.set("tab", tab);
  const qs = q.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}`} replace />;
}
function ToWorkflow() {
  const { id } = useParams();
  return <Navigate to={`/workflows/${id}`} replace />;
}

// Focus layout, in the proposal's terms (see Layout for the menu): the Needs Your Attention panel, orchestrations for the pilot
// and the No-Show Recovery Agent, the products (maintenance, fleet, safety), dashboards, the TransitTech Assistant, the Operator
// Performance SLM, governance (autonomy policy, shadow mode, audit log, event backbone, model evaluation) and Simulate.
// The old Attention and Simulator pages stay in src/pages; Simulator is the Scenario testing tab of Simulate.
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <SandboxProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<Protected><Layout /></Protected>}>
                <Route index element={<Today />} />
                <Route path="workflows" element={<Workflows />} />
                <Route path="workflows/:id" element={<WorkflowDetail />} />
                <Route path="work-orders" element={<Page><WorkOrders /></Page>} />
                <Route path="policies" element={<Page><Policies /></Page>} />
                <Route path="shadow" element={<Page><Shadow /></Page>} />
                <Route path="audit" element={<Page><Audit /></Page>} />
                <Route path="simulate" element={<Page><Simulate /></Page>} />
                <Route path="overview" element={<Page><Overview /></Page>} />
                <Route path="assistant" element={<div className="flex h-[calc(100vh-128px)] min-h-[520px] lg:h-[calc(100vh-64px)]"><Assistant /></div>} />
                <Route path="performance" element={<Page><Performance /></Page>} />
                <Route path="fleet" element={<Page><Fleet /></Page>} />
                <Route path="safety" element={<Page><Safety /></Page>} />
                <Route path="events" element={<Page><Events /></Page>} />
                <Route path="evals" element={<Page><Evals /></Page>} />
                {/* other addresses that point at the same screens */}
                <Route path="attention" element={<Navigate to="/" replace />} />
                <Route path="incidents" element={<Navigate to="/workflows" replace />} />
                <Route path="incidents/:id" element={<ToWorkflow />} />
                <Route path="shop" element={<Navigate to="/work-orders" replace />} />
                <Route path="rules" element={<Navigate to="/policies" replace />} />
                <Route path="rules/trial" element={<Navigate to="/shadow" replace />} />
                <Route path="records" element={<Navigate to="/audit" replace />} />
                <Route path="sandbox" element={<To path="/simulate" />} />
                <Route path="schedule" element={<To path="/simulate" tab="scheduling" />} />
                <Route path="riders" element={<To path="/simulate" tab="riders" />} />
                <Route path="simulator" element={<To path="/simulate" tab="fault" />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SandboxProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
