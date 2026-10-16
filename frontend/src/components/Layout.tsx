import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BusFront, Check, ClipboardCheck, Eye, FileText, FlaskConical, HardHat, Inbox, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Radio, Search, ShieldCheck, Sparkles, TrendingUp, Wrench } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useData, useLive } from "../lib/live";
import { clockET, easternNow, roleName } from "../lib/format";
import type { Approval, Workflow } from "../lib/types";
import { kbdCls, useSandbox } from "./focus";

/* Focus layout: a slim icon rail, a quiet top bar with the day's counts, and nothing else around the page.
   Operations: Needs your attention, Orchestrations, Maintenance. Governance: Autonomy policy, Shadow mode, Audit log.
   Testing: Simulate, which is also a mode switch. */

const LineIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="12" r="2.5" /><path d="M7.5 12h9" /></svg>
);

// Names follow the proposal: the Needs Your Attention panel is the approval surface; orchestrations run the pilot workflow and the
// No-Show Recovery Agent; dashboards, the TransitTech Assistant and the Operator Performance SLM explain them; the autonomy policy,
// shadow mode, audit log, event backbone and model evaluation govern them. `short` is the phone tab-bar label.
// `wide`: only in the desktop menu; on phones these sit in the account menu.
type Place = { to: string; label: string; short: string; icon: any; badge?: boolean; wide?: boolean };
const groups: { title: string; items: Place[] }[] = [
  { title: "Operations", items: [
    { to: "/", label: "Needs your attention", short: "Attention", icon: Inbox, badge: true },
    { to: "/workflows", label: "Orchestrations", short: "Workflows", icon: LineIcon },
    { to: "/work-orders", label: "Maintenance", short: "Maintenance", icon: Wrench },
    { to: "/fleet", label: "Fleet", short: "Fleet", icon: BusFront, wide: true },
    { to: "/safety", label: "Safety & compliance", short: "Safety", icon: HardHat, wide: true },
  ]},
  { title: "Insights", items: [
    { to: "/overview", label: "Pilot dashboard", short: "Dashboard", icon: LayoutDashboard, wide: true },
    { to: "/assistant", label: "TransitTech Assistant", short: "Assistant", icon: Sparkles, wide: true },
    { to: "/performance", label: "Operator performance", short: "Performance", icon: TrendingUp, wide: true },
  ]},
  { title: "Governance", items: [
    { to: "/policies", label: "Autonomy policy", short: "Policy", icon: ShieldCheck },
    { to: "/shadow", label: "Shadow mode", short: "Shadow", icon: Eye, wide: true },
    { to: "/audit", label: "Audit log", short: "Audit", icon: FileText },
    { to: "/events", label: "Event stream", short: "Events", icon: Radio, wide: true },
    { to: "/evals", label: "Model evaluation", short: "Models", icon: ClipboardCheck, wide: true },
  ]},
];
const places = groups.flatMap((g) => g.items);
const titles: [string, string][] = [...places.filter((p) => p.to !== "/").map((p): [string, string] => [p.to, p.label]), ["/simulate", "Simulate"]];

const initials = (name?: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const sandbox = useSandbox();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { data: pending } = useData<Approval[]>("/api/approvals?status=pending");
  const { data: wfs } = useData<Workflow[]>("/api/workflows?limit=200");
  const ids = new Set((wfs || []).map((w) => w.id));
  const waiting = wfs ? (pending || []).filter((a) => ids.has(a.workflow_id)).length : 0;
  const motion = (wfs || []).filter((w) => ["running", "awaiting_approval", "awaiting_event"].includes(w.status)).length;
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [t, setT] = useState(clockET());
  useEffect(() => { const id = window.setInterval(() => setT(clockET()), 15000); return () => window.clearInterval(id); }, []);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { document.title = `${waiting ? `(${waiting}) ` : ""}TransitTechOS`; }, [waiting]);

  const title = titles.find(([p]) => pathname.startsWith(p))?.[1] ?? "Needs your attention";
  // desktop menu: open shows names, closed shows icons only; remembered per browser
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("tto_rail") !== "closed"; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem("tto_rail", o ? "closed" : "open"); } catch { /* storage blocked */ } return !o; });
  const item = `group relative flex items-center rounded-[10px] text-ink-faint transition-colors hover:bg-[#F3F5F6] hover:text-ink
    h-12 w-14 flex-col justify-center gap-0.5 lg:h-10 lg:flex-row lg:gap-3 ${open ? "lg:w-full lg:justify-start lg:px-3" : "lg:w-11 lg:justify-center"}`;
  const tip = `pointer-events-none absolute left-[54px] z-50 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${open ? "" : "lg:block"}`;
  const name = `text-[10px] font-medium lg:text-sm ${open ? "lg:inline" : "lg:hidden"}`;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <nav aria-label="Main" className={`fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t border-rule bg-white px-1 lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:flex-col lg:items-stretch lg:justify-start lg:gap-1 lg:border-r lg:border-t-0 lg:py-[18px] lg:transition-[width] lg:duration-200 ${open ? "lg:w-[240px] lg:px-3" : "lg:w-[68px] lg:items-center lg:px-0"}`}>
        <div className={`mb-3 hidden items-center lg:flex ${open ? "gap-2.5 px-1" : "flex-col gap-3"}`}>
          <Link to="/" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-ink" aria-label="TransitTechOS home">
            <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
          </Link>
          {open && <span className="min-w-0 flex-1 leading-tight"><span className="block text-[15px] font-semibold">TransitTechOS</span><span className="block text-xs text-ink-faint">Agentic orchestration</span></span>}
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? "Collapse menu" : "Expand menu"} title={open ? "Collapse menu" : "Expand menu"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-[#F3F5F6] hover:text-ink">
            {open ? <PanelLeftClose className="h-[18px] w-[18px]" /> : <PanelLeftOpen className="h-[18px] w-[18px]" />}
          </button>
        </div>
        {open && (
          <div className="mb-3 hidden rounded-[10px] border border-rule bg-[#FAFBFB] px-3 py-2 lg:block">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">Agency</div>
            <div className="truncate text-sm font-medium">{user?.tenant_name}</div>
          </div>
        )}
        <div className="contents lg:-mx-1 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-1">
        {groups.map((g) => (
          <div key={g.title} className={`contents lg:flex lg:flex-col lg:gap-1 ${open ? "lg:mb-3" : "lg:mb-1 lg:items-center"}`}>
            {open && <div className="hidden px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint lg:block">{g.title}</div>}
            {g.items.map((p) => (
              <NavLink key={p.to} to={p.to} end={p.to === "/"} aria-label={p.badge && waiting ? `${p.label}, ${waiting} waiting` : p.label}
                className={({ isActive }) => `${item} ${p.wide ? "hidden lg:flex" : ""} ${isActive ? "!bg-route-tint !text-route" : ""}`}>
                {({ isActive }) => (
                  <>
                    <p.icon className="h-5 w-5 shrink-0" />
                    <span className={`${name} ${isActive ? "lg:font-semibold" : "lg:text-ink-soft"}`}><span className="lg:hidden">{p.short}</span><span className="hidden lg:inline">{p.label}</span></span>
                    {p.badge && waiting > 0 && (
                      <span className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-bold text-white ${open ? "absolute right-2 top-1 lg:static lg:ml-auto lg:h-5 lg:min-w-5 lg:text-[11px]" : "absolute right-2 top-1 lg:right-[5px] lg:top-1.5"}`}>{waiting}</span>
                    )}
                    <span className={tip}>{p.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
        </div>
        <button type="button" aria-pressed={sandbox.on} onClick={() => { sandbox.set(!sandbox.on); nav(sandbox.on ? "/" : "/simulate"); }}
          className={`${item} ${sandbox.on ? "!bg-sand-tint !text-[#8A5A00]" : ""}`} aria-label={sandbox.on ? "Leave Simulate" : "Simulate"}>
          <FlaskConical className="h-5 w-5 shrink-0" />
          <span className={name}>Simulate</span>
          {open && <span aria-hidden className={`ml-auto hidden h-5 w-9 rounded-full p-0.5 transition-colors lg:block ${sandbox.on ? "bg-sand" : "bg-[#E1E4E8]"}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${sandbox.on ? "translate-x-4" : ""}`} /></span>}
          <span className={tip}>{sandbox.on ? "Leave Simulate" : "Simulate (sandbox)"}</span>
        </button>
        <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={`${user?.full_name}, ${roleName[user?.role ?? ""]}. Account menu`}
          className={`flex items-center gap-2.5 rounded-[10px] text-left hover:bg-[#F3F5F6] lg:mt-2 ${open ? "lg:w-full lg:border-t lg:border-rule lg:px-2 lg:pb-1 lg:pt-3" : "p-1"}`}>
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#ECEEF0] text-xs font-semibold">{initials(user?.full_name)}</span>
          {open && <span className="hidden min-w-0 flex-1 leading-tight lg:block"><span className="block truncate text-sm font-medium">{user?.full_name}</span><span className="block truncate text-xs text-ink-faint">{roleName[user?.role ?? ""]}</span></span>}
        </button>
      </nav>

      {menu && (
        <>
          <button className="fixed inset-0 z-[70] cursor-default" aria-label="Close menu" tabIndex={-1} onClick={() => setMenu(false)} />
          <div role="dialog" aria-label="Account" className={`fade-in fixed bottom-20 right-3 z-[71] w-72 rounded-[14px] border border-[#E1E4E8] bg-white p-2 shadow-[0_16px_40px_-12px_rgba(15,23,32,0.3)] lg:bottom-4 lg:right-auto ${open ? "lg:left-[248px]" : "lg:left-[76px]"}`}>
            <div className="mb-1.5 border-b border-rule px-3 pb-3 pt-2.5">
              <div className="font-semibold">{user?.full_name}</div>
              <div className="text-[13px] text-ink-faint">{roleName[user?.role ?? ""]} · {user?.tenant_name}</div>
            </div>
            <div className="mb-1.5 border-b border-rule pb-1.5 lg:hidden">
              {places.filter((p) => p.wide).map((p) => (
                <Link key={p.to} to={p.to} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-sm hover:bg-[#F3F5F6]"><p.icon className="h-4 w-4 text-ink-faint" />{p.label}</Link>
              ))}
            </div>
            <button onClick={() => { logout(); nav("/login"); }} className="w-full rounded-[9px] px-3 py-2 text-left text-sm hover:bg-[#F3F5F6]">Sign out</button>
          </div>
        </>
      )}

      <div id="app-main" className="flex min-h-screen min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-5 border-b border-rule bg-white/95 px-4 backdrop-blur sm:px-8">
          <h1 className="text-lg font-semibold">{title}</h1>
          {title === "Needs your attention" && <span className="hidden text-sm text-ink-faint md:inline">{easternNow().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} · {user?.tenant_name}</span>}
          <div className="ml-auto flex items-center gap-[18px] text-[13px] text-ink-soft">
            <Link to="/" className="hover:text-ink"><b className="font-mono font-semibold text-[#8A5A00]">{waiting}</b> waiting</Link>
            <span className="hidden sm:inline"><b className="font-mono font-semibold text-ink">{wfs ? motion : "–"}</b> in motion</span>
            <span className="inline-flex items-center gap-1.5" title={connected ? "Receiving live updates" : "Reconnecting to live updates"}>
              <span className={`h-[7px] w-[7px] rounded-full ${connected ? "bg-go shadow-[0_0_0_3px_rgba(47,143,91,0.15)]" : "bg-stop"}`} aria-hidden />
              <span className="hidden sm:inline">{connected ? "Live" : "Reconnecting"} · {t} ET</span>
            </span>
          </div>
          <button type="button" onClick={() => setPalette(true)} className="hidden h-[34px] items-center gap-2 rounded-lg border border-[#E1E4E8] bg-white px-3 text-[13px] text-ink-faint hover:text-ink md:inline-flex">
            <Search className="h-3.5 w-3.5" aria-hidden /> Search <kbd className={kbdCls}>⌘K</kbd>
          </button>
        </header>
        {sandbox.on && (
          <div className="flex items-center gap-2.5 border-b border-[#F1DDB4] bg-sand-tint px-4 py-2 text-[13px] text-[#8A5A00] sm:px-8">
            <FlaskConical className="h-4 w-4" aria-hidden />
            <span><b>Simulate · sandbox.</b> Inject faults and product outages for scenario testing. Everything goes through the same event backbone and adapters as real products.</span>
            <button className="ml-auto font-medium underline" onClick={() => { sandbox.set(false); nav("/"); }}>Leave Simulate</button>
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      {palette && <Palette wfs={wfs || []} onClose={() => setPalette(false)} />}
    </div>
  );
}

/** ⌘K: jump to a page or to a bus. */
function Palette({ wfs, onClose }: { wfs: Workflow[]; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => {
    const pages = [...places.map((p) => ({ l: p.label, h: p.to, k: "Page" })), { l: "Simulate", h: "/simulate", k: "Page" }];
    const incs = wfs.map((w) => ({ l: `${w.vehicle_label} · ${w.title.replace(`${w.vehicle_label}: `, "")}`, h: `/workflows/${w.id}`, k: "Orchestration" }));
    const n = q.trim().toLowerCase();
    return [...pages, ...incs].filter((x) => !n || x.l.toLowerCase().includes(n)).slice(0, 12);
  }, [q, wfs]);
  const go = (h: string) => { onClose(); nav(h); };
  return (
    <>
      <button className="fade-in fixed inset-0 z-[70] cursor-default bg-ink/30" aria-label="Close search" tabIndex={-1} onClick={onClose} />
      <div role="dialog" aria-label="Search" className="fade-in fixed left-1/2 top-[12vh] z-[71] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(15,23,32,0.45)]">
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Jump to a page or a vehicle…" aria-label="Search"
          className="w-full border-b border-rule px-5 py-[18px] text-base outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && items[sel]) go(items[sel].h);
          }} />
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.map((x, i) => (
            <li key={x.h}>
              <button role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(x.h)}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm ${i === sel ? "bg-[#F3F5F6]" : ""}`}>
                {x.l}<span className="ml-auto text-xs text-ink-faint">{x.k}</span>{i === sel && <Check className="h-3.5 w-3.5 text-ink-faint" aria-hidden />}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-3 text-sm text-ink-faint">Nothing matches.</li>}
        </ul>
      </div>
    </>
  );
}
