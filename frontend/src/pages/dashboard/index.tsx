import { useAuth } from "../../lib/auth";
import DispatcherDashboard from "./DispatcherDashboard";
import ShopDashboard from "./ShopDashboard";
import AdminDashboard from "./AdminDashboard";
import AnalystDashboard from "./AnalystDashboard";

/** The Dashboard is the landing page for every role, and the one page that genuinely differs by who is looking:
 *  a dispatcher's queue summary, a shop manager's bench, the admin's pilot governance view, or the analyst's
 *  read-only performance view. Everything else in the app stays the same screen for everyone. */
export default function DashboardIndex() {
  const { user } = useAuth();
  if (user?.role === "dispatcher") return <DispatcherDashboard />;
  if (user?.role === "shop_manager") return <ShopDashboard />;
  if (user?.role === "viewer") return <AnalystDashboard />;
  return <AdminDashboard />;
}
