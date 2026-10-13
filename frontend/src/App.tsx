import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Attention from "./pages/Attention";
import Workflows from "./pages/Workflows";
import WorkflowDetail from "./pages/WorkflowDetail";
import Fleet from "./pages/Fleet";
import Schedule from "./pages/Schedule";
import WorkOrders from "./pages/WorkOrders";
import Riders from "./pages/Riders";
import Audit from "./pages/Audit";
import Policies from "./pages/Policies";
import Events from "./pages/Events";
import Simulator from "./pages/Simulator";
import Assistant from "./pages/Assistant";
import Performance from "./pages/Performance";
import Shadow from "./pages/Shadow";
import Safety from "./pages/Safety";
import Evals from "./pages/Evals";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <LiveProvider key={user.id}>{children}</LiveProvider>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<Overview />} />
              <Route path="attention" element={<Attention />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="workflows/:id" element={<WorkflowDetail />} />
              <Route path="fleet" element={<Fleet />} />
              <Route path="schedule" element={<Schedule />} />
              <Route path="work-orders" element={<WorkOrders />} />
              <Route path="riders" element={<Riders />} />
              <Route path="audit" element={<Audit />} />
              <Route path="policies" element={<Policies />} />
              <Route path="events" element={<Events />} />
              <Route path="simulator" element={<Simulator />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="performance" element={<Performance />} />
              <Route path="shadow" element={<Shadow />} />
              <Route path="safety" element={<Safety />} />
              <Route path="evals" element={<Evals />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
