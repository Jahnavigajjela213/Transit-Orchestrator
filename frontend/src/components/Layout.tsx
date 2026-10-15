import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, ClipboardList, Clock, Eye, FlaskConical, GitBranch, LogOut, Menu, ShieldCheck, Wrench, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useData, useLive } from "../lib/live";
import { clockET, roleName } from "../lib/format";
import type { Approval } from "../lib/types";

// The demo is one story: a bus fault, the seven orchestrated steps, people approving where the policy says so, and the record
// of it. Raising faults and looking at the synthetic product data lives apart, in the Simulate playground.
const groups: { title: string; items: { to: string; label: string; icon: any; badge?: boolean; sandbox?: boolean }[] }[] = [
  { title: "Operations", items: [
    { to: "/", label: "Needs your attention", icon: Bell, badge: true },
    { to: "/workflows", label: "Orchestrations", icon: GitBranch },
    { to: "/work-orders", label: "Maintenance", icon: Wrench },
  ]},
  { title: "Governance", items: [
    { to: "/policies", label: "Autonomy policy", icon: ShieldCheck },
    { to: "/shadow", label: "Shadow mode", icon: Eye },
    { to: "/audit", label: "Audit log", icon: ClipboardList },
  ]},
  { title: "Testing", items: [
    { to: "/simulate", label: "Simulate", icon: FlaskConical, sandbox: true },
  ]},
];

/** Eastern Time clock: every time in the app is Eastern. */
function EasternClock() {
  const [t, setT] = useState(clockET());
  useEffect(() => { const id = window.setInterval(() => setT(clockET()), 15000); return () => window.clearInterval(id); }, []);
  return (
    <span className="hidden items-center gap-1.5 md:inline-flex" title="All times are US Eastern">
      <Clock className="h-3.5 w-3.5" aria-hidden /> <span className="tnum">{t}</span> <span className="text-ink-faint">ET</span>
    </span>
  );
}

const initials = (name?: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const nav = useNavigate();
  const { pathname } = useLocation();
  // Data-heavy pages fit the screen on desktop; their tables scroll inside themselves instead of the whole page.
  const fitPage = ["/", "/audit", "/simulate"].includes(pathname);
  const { data: pending } = useData<Approval[]>("/api/approvals?status=pending");
  const { data: wfs } = useData<{ id: string }[]>("/api/workflows?workflow_type=vehicle_health&limit=200");
  // count only vehicle-health items, the same ones the attention screen lists
  const ids = new Set((wfs || []).map((w) => w.id));
  const count = wfs ? (pending || []).filter((a) => ids.has(a.workflow_id)).length : 0;
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]); // close the phone menu after navigating

  const all = groups.flatMap((g) => g.items);
  const current = all.find((it) => (it.to === "/" ? pathname === "/" : pathname.startsWith(it.to)));
  const group = groups.find((g) => g.items.includes(current!));

  const rail = (
    <>
      <Link to="/" className="flex items-center gap-3 px-5 pb-5 pt-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-route shadow-sm">
          <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-white">TransitTechOS</span>
          <span className="block text-2xs text-white/50">Agentic orchestration</span>
        </span>
      </Link>
      <div className="mx-3 mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-2xs uppercase tracking-wider text-white/40">Agency</div>
        <div className="truncate text-sm font-medium text-white">{user?.tenant_name}</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {groups.map((g) => (
          <div key={g.title} className="mb-5">
            <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">{g.title}</div>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === "/"}
                className={({ isActive }) => `group relative mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${isActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#3FB4AA]" aria-hidden />}
                    <it.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-[#5FD3C8]" : ""}`} aria-hidden />
                    <span className="flex-1">{it.label}</span>
                    {it.badge && count > 0 && <span className="rounded-full bg-signal px-1.5 text-2xs font-bold text-white tnum">{count}</span>}
                    {it.sandbox && <span className="rounded border border-white/15 px-1 text-[10px] font-medium uppercase tracking-wide text-white/50">Sandbox</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">{initials(user?.full_name)}</span>
        <div className="min-w-0 flex-1 text-xs">
          <div className="truncate font-medium text-white">{user?.full_name}</div>
          <div className="truncate text-white/50">{roleName[user?.role ?? ""]}</div>
        </div>
        <button onClick={() => { logout(); nav("/login"); }} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </>
  );

  return (
    <div className={`flex ${fitPage ? "min-h-screen lg:h-screen" : "min-h-screen"}`}>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-rail lg:flex">{rail}</aside>
      {menu && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <aside className="flex h-full w-72 max-w-[85vw] flex-col bg-rail shadow-xl">
            <button onClick={() => setMenu(false)} className="absolute left-[min(18rem,85vw)] top-3 ml-2 rounded-md bg-white/90 p-1.5 text-ink shadow" aria-label="Close menu"><X className="h-5 w-5" /></button>
            {rail}
          </aside>
          <button className="flex-1 bg-ink/40" onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={-1} />
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${fitPage ? "lg:min-h-0" : ""}`}>
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-rule bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <button onClick={() => setMenu(true)} className="-ml-1.5 rounded-md p-1.5 text-ink hover:bg-paper lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <span className="hidden text-ink-faint sm:inline">{group?.title ?? "Operations"}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 text-ink-faint sm:inline" aria-hidden />
            <span className="truncate font-medium">{current?.label ?? "Orchestrations"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-ink-soft">
            <EasternClock />
            <span className="inline-flex items-center gap-1.5" title={connected ? "Receiving live updates" : "Reconnecting to live updates"}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-go shadow-[0_0_0_3px_rgba(47,125,79,0.15)]" : "bg-stop"}`} aria-hidden />
              <span className="hidden sm:inline">{connected ? "Live" : "Reconnecting"}</span>
            </span>
            <NavLink to="/" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${count ? "border-signal/40 bg-signal-tint font-semibold text-[#8A5900]" : "border-rule hover:text-ink"}`}>
              <Bell className="h-3.5 w-3.5" aria-hidden /> <span className="tnum">{count}</span><span className="hidden sm:inline">waiting</span>
            </NavLink>
          </div>
        </header>
        <main className={fitPage ? "mx-auto flex w-full max-w-[1400px] min-[1800px]:max-w-[1640px] flex-1 flex-col px-4 pb-4 pt-4 sm:px-8 sm:pb-5 sm:pt-5 lg:min-h-0 lg:overflow-y-auto"
          : "mx-auto w-full max-w-[1400px] min-[1800px]:max-w-[1640px] flex-1 px-4 py-6 sm:px-8 sm:py-7"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
