import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, Bell, Bot, Bus, CalendarClock, ClipboardList, Eye, FlaskConical, Gauge, GitBranch, HardHat, LogOut, MessageSquare, Radio, Scale,
  ShieldCheck, TrendingUp, Wrench,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useData, useLive } from "../lib/live";
import { roleName } from "../lib/format";
import type { Approval } from "../lib/types";

const groups: { title: string; items: { to: string; label: string; icon: any; badge?: boolean }[] }[] = [
  { title: "Operate", items: [
    { to: "/", label: "Overview", icon: Gauge },
    { to: "/attention", label: "Needs your attention", icon: Bell, badge: true },
    { to: "/workflows", label: "Orchestrations", icon: GitBranch },
    { to: "/performance", label: "Performance", icon: TrendingUp },
    { to: "/assistant", label: "Assistant", icon: Bot },
  ]},
  { title: "Products", items: [
    { to: "/fleet", label: "Fleet", icon: Bus },
    { to: "/schedule", label: "Schedule", icon: CalendarClock },
    { to: "/work-orders", label: "Work orders", icon: Wrench },
    { to: "/riders", label: "Rider messages", icon: MessageSquare },
    { to: "/safety", label: "Safety & compliance", icon: HardHat },
  ]},
  { title: "Govern", items: [
    { to: "/audit", label: "Audit log", icon: ClipboardList },
    { to: "/policies", label: "Autonomy policy", icon: ShieldCheck },
    { to: "/shadow", label: "Shadow mode", icon: Eye },
    { to: "/evals", label: "Model evaluation", icon: Scale },
    { to: "/events", label: "Event stream", icon: Activity },
    { to: "/simulator", label: "Simulator", icon: FlaskConical },
  ]},
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const fullPage = pathname === "/assistant"; // the chat fills the whole content area and scrolls inside itself
  // Data-heavy pages fit the screen on desktop; their tables scroll inside themselves instead of the whole page.
  const fitPage = ["/events", "/audit", "/riders", "/schedule", "/fleet"].includes(pathname);
  const { data: pending } = useData<Approval[]>("/api/approvals?status=pending");
  const count = pending?.length ?? 0;

  return (
    <div className={`flex ${fullPage ? "h-screen" : fitPage ? "min-h-screen lg:h-screen" : "min-h-screen"}`}>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-rail text-white/80 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <svg viewBox="0 0 40 20" className="h-5 w-10" aria-hidden>
            <rect x="4" y="8" width="32" height="4" fill="#3FB4AA" />
            <circle cx="6" cy="10" r="5" fill="#fff" /><circle cx="20" cy="10" r="5" fill="#3FB4AA" /><circle cx="34" cy="10" r="5" fill="#fff" />
          </svg>
          <div className="leading-tight">
            <div className="font-sign text-[15px] font-bold text-white">TransitTechOS</div>
            <div className="text-2xs text-white/60">Orchestration</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <div className="px-2 pb-1 text-2xs font-semibold text-white/45">{g.title}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === "/"}
                  className={({ isActive }) => `group relative flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm ${isActive ? "bg-rail-hover text-white" : "hover:bg-rail-hover hover:text-white"}`}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-3 top-1 bottom-1 w-1 rounded-r bg-[#3FB4AA]" aria-hidden />}
                      <it.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="flex-1">{it.label}</span>
                      {it.badge && count > 0 && <span className="rounded-sm bg-signal px-1.5 text-2xs font-bold text-white tnum">{count}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs">
          <div className="font-medium text-white">{user?.full_name}</div>
          <div className="text-white/60">{roleName[user?.role ?? ""]}, {user?.tenant_name}</div>
          <button onClick={() => { logout(); nav("/login"); }} className="mt-2 inline-flex items-center gap-1.5 text-white/70 hover:text-white">
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${fullPage ? "min-h-0" : fitPage ? "lg:min-h-0" : ""}`}>
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-rule bg-white/95 px-5 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2 lg:hidden">
            <select aria-label="Go to page" className="input w-48" onChange={(e) => nav(e.target.value)} value={location.pathname}>
              {groups.flatMap((g) => g.items).map((it) => <option key={it.to} value={it.to}>{it.label}</option>)}
            </select>
          </div>
          <div className="hidden font-sign text-sm font-semibold text-ink-soft lg:block">{user?.tenant_name}</div>
          <div className="flex items-center gap-4 text-xs text-ink-soft">
            <NavLink to="/attention" className="inline-flex items-center gap-1.5 hover:text-ink">
              <Bell className="h-4 w-4" aria-hidden /> <span className="tnum">{count}</span> waiting
            </NavLink>
            <span className="inline-flex items-center gap-1.5" title={connected ? "Receiving live updates" : "Reconnecting to live updates"}>
              <Radio className={`h-4 w-4 ${connected ? "text-go" : "text-stop"}`} aria-hidden /> {connected ? "Live" : "Reconnecting"}
            </span>
          </div>
        </header>
        <main className={fullPage ? "flex min-h-0 flex-1 flex-col"
          : fitPage ? "mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-6 lg:min-h-0 lg:overflow-y-auto"
          : "mx-auto w-full max-w-[1400px] flex-1 px-5 py-6"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
