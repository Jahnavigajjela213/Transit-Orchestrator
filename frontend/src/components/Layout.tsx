import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Bell, ClipboardList, Eye, FlaskConical, GitBranch, LogOut, Menu, PanelLeft, ShieldCheck, Wrench, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { roleName } from "../lib/format";
import type { Approval } from "../lib/types";

// The module rail of the concepts canvas: every module is always listed as an icon; expanding adds the names.
const groups: { to: string; label: string; icon: any; badge?: boolean }[][] = [
  [
    { to: "/", label: "Needs your attention", icon: Bell, badge: true },
    { to: "/workflows", label: "Orchestrations", icon: GitBranch },
    { to: "/work-orders", label: "Maintenance", icon: Wrench },
  ],
  [
    { to: "/policies", label: "Autonomy policy", icon: ShieldCheck },
    { to: "/shadow", label: "Shadow mode", icon: Eye },
    { to: "/measures", label: "Pilot measures", icon: BarChart3 },
    { to: "/audit", label: "Audit log", icon: ClipboardList },
  ],
  [{ to: "/simulate", label: "Simulate", icon: FlaskConical }],
];

const RAIL_KEY = "tto_rail_open";
const initials = (name?: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function readRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; }
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [railOpen, setOpen] = useState(readRail);
  // Phones: the rail is a slide-in menu opened from a top bar, always with names.
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [pathname]);
  const open = railOpen || mobile;
  useEffect(() => { try { localStorage.setItem(RAIL_KEY, railOpen ? "1" : "0"); } catch { /* private mode */ } }, [railOpen]);
  const { data: pending } = useData<Approval[]>("/api/approvals?status=pending");
  const { data: wfs } = useData<{ id: string }[]>("/api/workflows?workflow_type=vehicle_health&limit=200");
  // count only vehicle-health items, the same ones the attention screen lists
  const ids = new Set((wfs || []).map((w) => w.id));
  const count = wfs ? (pending || []).filter((a) => ids.has(a.workflow_id)).length : 0;
  const Label = ({ children }: { children: ReactNode }) => (open ? <span className="flex-1 truncate">{children}</span> : null);
  const home = pathname === "/";

  return (
    <div className="flex h-[100dvh] flex-col bg-paper text-ink md:flex-row">
      {/* phone top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 bg-rail px-3 text-white md:hidden">
        <button type="button" onClick={() => setMobile(true)} aria-label="Open the menu" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10">
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-route">
          <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
        </span>
        <span className="flex-1 truncate text-[15px] font-semibold">{groups.flat().find((it) => (it.to === "/" ? home : pathname.startsWith(it.to)))?.label ?? "TransitTechOS"}</span>
        {count > 0 && <NavLink to="/" className="flex h-7 min-w-7 items-center justify-center rounded-full bg-signal px-2 text-xs font-bold tnum" aria-label={`${count} decisions waiting`}>{count}</NavLink>}
      </header>
      {mobile && <button type="button" aria-label="Close the menu" onClick={() => setMobile(false)} className="fixed inset-0 z-40 bg-ink/50 md:hidden" tabIndex={-1} />}
      <nav aria-label="Modules" className={`flex-col gap-1 overflow-y-auto bg-rail px-2.5 py-3.5 text-[#C9D3DA] ${mobile ? "fixed inset-y-0 left-0 z-50 flex w-[260px] shadow-2xl" : `hidden shrink-0 transition-[width] duration-150 md:flex ${railOpen ? "w-[232px]" : "w-[68px]"}`}`}>
        {/* Expanded: logo, name and the collapse icon on one line. Collapsed there is room for one icon only, so the
            logo itself expands the rail and shows the icon on hover. */}
        <div className="flex items-center gap-2.5 px-1.5 pb-4 pt-1">
          {open ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-route">
              <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
            </span>
          ) : (
            <button type="button" onClick={() => setOpen(true)} aria-label="Expand the module rail" aria-expanded={false} title="Expand"
              className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-route hover:bg-rail-hover">
              <svg className="group-hover:hidden" width="18" height="18" viewBox="0 0 32 32" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
              <PanelLeft className="hidden h-4 w-4 text-white group-hover:block" aria-hidden />
            </button>
          )}
          {open && <span className="flex-1 truncate text-[15px] font-semibold text-white">TransitTechOS</span>}
          {open && (
            <button type="button" onClick={() => (mobile ? setMobile(false) : setOpen(false))} aria-label={mobile ? "Close the menu" : "Collapse the module rail"} aria-expanded title={mobile ? "Close" : "Collapse"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8FA0AC] hover:bg-white/10 hover:text-white">
              {mobile ? <X className="h-4 w-4" aria-hidden /> : <PanelLeft className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
        {groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-1">
            {gi > 0 && <div className="mx-1.5 my-2 h-px bg-rail-line" aria-hidden />}
            {g.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === "/"} title={it.label}
                className={({ isActive }) => `relative flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors ${isActive ? "bg-rail-hover text-[#5FD3C8]" : "text-[#C9D3DA] hover:bg-white/5 hover:text-white"}`}>
                {({ isActive }) => (
                  <>
                    <it.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <Label><span className={isActive ? "text-white" : ""}>{it.label}</span></Label>
                    {it.badge && count > 0 && (
                      <span className="absolute left-[26px] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-bold text-white tnum">{count}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 p-1.5" title={`${user?.full_name}, ${roleName[user?.role ?? ""]} · ${user?.tenant_name}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rail-line text-xs font-semibold text-white">{initials(user?.full_name)}</span>
          {open && (
            <span className="min-w-0 flex-1 text-xs leading-tight">
              <span className="block truncate text-white">{user?.full_name}</span>
              <span className="block truncate">{roleName[user?.role ?? ""]}</span>
            </span>
          )}
          {open && (
            <button onClick={() => { logout(); nav("/login"); }} className="rounded-md p-1.5 text-[#8FA0AC] hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </nav>

      {/* The Focus Queue fills the window and lays itself out; the other screens scroll inside main. */}
      {home ? (
        <main className="flex min-h-0 min-w-0 flex-1"><Outlet /></main>
      ) : (
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1640px] flex-col gap-[18px] px-4 py-5 sm:px-6 lg:px-8 lg:py-[26px]"><Outlet /></div>
        </main>
      )}
    </div>
  );
}
