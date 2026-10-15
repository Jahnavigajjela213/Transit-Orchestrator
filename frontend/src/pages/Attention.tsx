import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Eye, FlaskConical, GitBranch, UserCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { easternNow } from "../lib/format";
import type { Approval, Workflow } from "../lib/types";
import DecisionCard from "../components/DecisionCard";
import { ErrorNote, Loading } from "../components/ui";

interface Summary { operations: { vehicles: { total: number; out_of_service: number } } }
interface Pol { rules: { mode?: string } }

const ACTIVE = ["running", "awaiting_approval", "awaiting_event"];
type Kind = "all" | "escalation" | "approval";

export default function Attention() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [kind, setKind] = useState<Kind>("all");
  const status = tab === "pending" ? "pending" : "approved,rejected,overridden,acknowledged";
  const { data, error, reload } = useData<Approval[]>(`/api/approvals?status=${status}&limit=60`, [tab]);
  const { data: wfs } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=200");
  const { data: m } = useData<Summary>("/api/metrics/summary");
  const { data: pol } = useData<Pol>("/api/policies/vehicle_health");
  const byId = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w])), [wfs]);

  // right after a tab switch `data` still holds the other tab's items until the new list arrives: show only this tab's.
  // Only vehicle-health orchestrations are part of this screen.
  const items = useMemo(() => (data || []).filter((a) => (a.status === "pending") === (tab === "pending") && (!wfs || byId[a.workflow_id])), [data, tab, wfs, byId]);
  const sorted = useMemo(() => {
    const rank: Record<string, number> = { escalation: 0, approval: 1, informational: 2 };
    const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return items.filter((a) => kind === "all" || a.kind === kind || (kind === "approval" && a.kind === "informational")).sort((a, b) => tab === "pending"
      ? (rank[a.kind] - rank[b.kind]) || ((sev[a.severity ?? "low"] ?? 4) - (sev[b.severity ?? "low"] ?? 4)) || a.requested_at.localeCompare(b.requested_at)
      : (b.decided_at ?? "").localeCompare(a.decided_at ?? ""));
  }, [items, kind, tab]);

  const escalations = tab === "pending" ? items.filter((a) => a.kind === "escalation").length : 0;
  const approvals = tab === "pending" ? items.length - escalations : 0;
  const active = (wfs || []).filter((w) => ACTIVE.includes(w.status)).length;
  const v = m?.operations.vehicles;
  const now = easternNow();
  const hello = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const waiting = tab === "pending" && data ? items.length : null;

  return (
    // Desktop: the banner, stat cards and toolbar stay put and only the decision list scrolls, inside itself.
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      {/* hero */}
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#0F1C2B_0%,#12324A_55%,#0B6E69_130%)] shrink-0 px-6 pb-4 pt-4 text-white shadow-[0_12px_32px_-16px_rgba(15,28,43,0.6)]">
        <svg className="pointer-events-none absolute -right-10 -top-16 h-72 w-72 opacity-[0.07]" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="80" fill="none" stroke="#fff" strokeWidth="18" /><circle cx="100" cy="100" r="40" fill="none" stroke="#fff" strokeWidth="18" />
        </svg>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-white/60">{hello}, {user?.full_name?.split(" ")[0]} · {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
            <h1 className="mt-1 text-[1.4rem] font-semibold leading-tight tracking-tight">Needs your attention</h1>
            <p className="mt-1 max-w-xl text-[13px] text-white/70">
              {waiting === null ? "Checking what the agent needs from you…"
                : waiting === 0 ? "You're all caught up. The agent will bring the next decision here as soon as it needs a person."
                : <>The agent is waiting on <span className="font-semibold text-white">{waiting} decision{waiting === 1 ? "" : "s"}</span> from you{escalations ? <>, including <span className="font-semibold text-[#FFB4A8]">{escalations} that need{escalations === 1 ? "s" : ""} manual action</span></> : null}.</>}
            </p>
          </div>
          <Link to="/simulate" className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
            <FlaskConical className="h-4 w-4" aria-hidden /> Simulate a fault
          </Link>
        </div>
        <div className="relative mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HeroStat icon={UserCheck} label="Approvals waiting" value={tab === "pending" && data ? approvals : "—"} accent="text-[#FFD48A]" />
          <HeroStat icon={GitBranch} label="Orchestrations in motion" value={wfs ? active : "—"} />
          <HeroStat icon={CheckCircle2} label="Vehicles in service" value={v ? `${v.total - v.out_of_service}/${v.total}` : "…"} accent="text-[#8FE3D6]" />
        </div>
      </section>

      {pol?.rules.mode === "shadow" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-route/30 bg-route-tint px-4 py-2.5 text-sm text-route-dark">
          <Eye className="h-4 w-4" aria-hidden />
          <span className="flex-1"><strong>Shadow mode is on.</strong> The agent records what it would do at each step but takes no action. People keep working in the connected systems.</span>
          <Link to="/shadow" className="font-semibold underline">Compare</Link>
        </div>
      )}

      {/* queue */}
      <section aria-labelledby="queue" className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 id="queue" className="text-base font-semibold">Decisions</h2>
            <div className="seg" role="tablist" aria-label="Decision state">
              {(["pending", "decided"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setKind("all"); }}>
                  {t === "pending" ? "Waiting" : "Decided"}{t === "pending" && waiting !== null && <span className="ml-1.5 opacity-60 tnum">{waiting}</span>}
                </button>
              ))}
            </div>
          </div>
          {tab === "pending" && items.length > 0 && (
            <div className="flex gap-1.5" role="radiogroup" aria-label="Kind">
              {([["all", "All", items.length], ["escalation", "Manual action", escalations], ["approval", "Approvals", approvals]] as [Kind, string, number][]).map(([k, l, n]) => (
                <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${kind === k ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink-soft hover:text-ink"}`}>
                  {l} <span className="opacity-60 tnum">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <ErrorNote message={error} />}
        {!data ? <div className="panel"><Loading /></div> : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rule bg-white px-6 py-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-go-tint text-go"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
            <p className="mt-4 font-semibold">{tab === "pending" ? "You're all caught up" : "No decisions yet"}</p>
            {tab === "pending" && (
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">New decisions appear here as soon as the agent needs a person. <Link to="/simulate" className="font-medium text-route hover:underline">Simulate a vehicle fault</Link> to start one.</p>
            )}
          </div>
        ) : (
          // Desktop: each decision fills the visible area, so one whole card is on screen at a time; scrolling snaps card to card.
          <div className={`space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${tab === "pending" ? "lg:snap-y lg:snap-mandatory" : ""}`}>
            {sorted.map((a) => tab === "pending" ? (
              <div key={a.id} className="lg:flex lg:min-h-full lg:snap-start lg:flex-col">
                <DecisionCard item={a} steps={byId[a.workflow_id]?.steps} onDone={reload} fill />
              </div>
            ) : <DecisionCard key={a.id} item={a} steps={byId[a.workflow_id]?.steps} onDone={reload} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function HeroStat({ icon: Icon, label, value, accent = "text-white" }: { icon: any; label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-1.5 text-xs text-white/60"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</div>
      <div className={`text-xl font-semibold leading-none tracking-tight tnum ${accent}`}>{value}</div>
    </div>
  );
}
