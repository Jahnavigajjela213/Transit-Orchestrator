import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { useData } from "../lib/live";
import { ago, dayTime, sentence } from "../lib/format";
import type { Workflow } from "../lib/types";
import { Empty, ErrorNote, Loading } from "../components/ui";

const STEPS = ["Detect", "Assess", "Open work order", "Pull vehicle", "Reassign runs", "Notify riders", "Return to service"];

export type Group = "approval" | "motion" | "shop" | "done" | "issues";
export const FILTERS: [Group | "all", string][] = [
  ["all", "All"], ["approval", "Needs approval"], ["motion", "In motion"], ["shop", "In the shop"], ["done", "Completed"], ["issues", "With issues"],
];
export const groupOf = (w: Workflow): Group =>
  w.status === "awaiting_approval" ? "approval"
    : w.status === "awaiting_event" ? "shop"
    : w.status === "completed" ? "done"
    : ["completed_with_issues", "compensated", "failed", "rejected"].includes(w.status) ? "issues"
    : "motion";

export const STATUS: Record<Group, [string, string]> = {
  approval: ["Needs approval", "bg-signal-tint text-signal-ink"],
  motion: ["Assessing", "bg-route-tint text-route-dark"],
  shop: ["In the shop", "bg-shop-tint text-shop"],
  done: ["Completed", "bg-go-tint text-go"],
  issues: ["With issues", "bg-stop-tint text-stop"],
};
const SEV: Record<string, string> = { critical: "text-stop", high: "text-signal-ink", medium: "text-route-dark", low: "text-ink-soft" };

/** Index of the step the orchestration is on (1..7); 8 when every step is behind it. */
export function currentStep(w: Workflow): number {
  if (w.status === "completed") return 8;
  const i = w.steps.findIndex((s) => ["awaiting_approval", "active", "waiting", "escalated", "failed"].includes(s.status));
  if (i >= 0) return i + 1;
  const last = w.steps.reduce((acc, s, k) => (["done", "skipped", "compensated", "recommended", "shadowed"].includes(s.status) ? k : acc), -1);
  return Math.min(last + 2, 8);
}
export const escalated = (w: Workflow) => w.steps.some((s) => s.status === "escalated" || s.status === "failed");

export default function Workflows() {
  const [params] = useSearchParams();
  // A dashboard KPI can land here pre-filtered, e.g. /workflows?status=issues.
  const [filter, setFilter] = useState<Group | "all">(() => {
    const s = params.get("status");
    return FILTERS.some(([key]) => key === s) ? (s as Group | "all") : "all";
  });
  const [q, setQ] = useState("");
  const { data, error } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=200");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    (data || []).forEach((w) => { c[groupOf(w)] = (c[groupOf(w)] ?? 0) + 1; });
    return c;
  }, [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data || []).filter((w) => (filter === "all" || groupOf(w) === filter) && (!needle || `${w.vehicle_label} ${w.title}`.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <div className="min-w-[260px] flex-1">
          <p className="text-ink-soft">Every vehicle fault the agent picked up, and where it stands on its seven steps.</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={`h-[34px] rounded-[10px] px-3.5 text-[12.5px] ${filter === key ? "bg-ink text-white" : "border border-rule bg-white text-ink-soft"}`}>
              {label} <span className="opacity-60 tnum">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <label className="relative w-full sm:w-[280px]">
          <span className="sr-only">Search</span>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicle or fault"
            className="h-10 w-full rounded-[10px] border border-rule bg-white pl-9 pr-3 focus:border-route focus:outline-hidden" />
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-faint" aria-hidden />
        </label>
      </div>

      {error && <ErrorNote message={error} />}
      {!data ? <div className="card"><Loading /></div> : rows.length === 0 ? (
        <div className="card"><Empty title="No orchestrations match">Try another filter, or <Link to="/simulate" className="text-route underline">simulate a vehicle fault</Link>.</Empty></div>
      ) : <ListView rows={rows} />}
    </>
  );
}

// Laptop and up: the design's table. Narrower: each orchestration as a compact block (vehicle, incident, status /
// progress / runs and detected time).
const GRID = "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 lg:grid-cols-[90px_minmax(0,2.2fr)_150px_minmax(0,1.4fr)_110px_150px_28px] lg:gap-3";

function ListView({ rows }: { rows: Workflow[] }) {
  return (
    // From tablet width up the table fills the window and only its rows scroll, under a fixed header.
    <section className="card flex flex-col overflow-hidden md:min-h-0 md:flex-1">
      <div className={`${GRID} shrink-0 border-b border-rule bg-panel px-[18px] py-3 eyebrow max-lg:hidden`}>
        <span>Vehicle</span><span>Incident</span><span>Status</span><span>Progress</span><span className="text-right">Runs covered</span><span>Detected</span><span />
      </div>
      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
      {rows.map((w) => {
        const g = groupOf(w), step = currentStep(w), esc = escalated(w);
        const [label, tone] = STATUS[g];
        return (
          <Link key={w.id} to={`/workflows/${w.id}`} className={`${GRID} items-center border-b border-rule-soft px-[18px] py-3 text-ink last:border-b-0 hover:bg-panel`}>
            <span><span className="chip-v">{w.vehicle_label}</span></span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{w.title.replace(`${w.vehicle_label}: `, "")}</span>
              <span className="mt-1 flex gap-2 text-xs text-ink-soft">
                {w.severity && <span className={`font-semibold ${SEV[w.severity] ?? ""}`}>{sentence(w.severity)}</span>}
                {w.human_touches} approval{w.human_touches === 1 ? "" : "s"} · updated {ago(w.updated_at)}
              </span>
            </span>
            <span><span className={`pill ${tone}`}>{label}</span></span>
            <span className="col-span-3 flex gap-[3px] lg:col-span-1" aria-label={`Step ${Math.min(step, 7)} of 7`}>
              {STEPS.map((s, i) => {
                const n = i + 1;
                const bg = n < step ? "bg-route" : n === step ? (esc ? "bg-stop" : g === "approval" ? "bg-signal" : "bg-[#5FB3AA]") : "bg-rule";
                return <span key={s} title={s} className={`h-1.5 flex-1 rounded-[3px] ${bg}`} />;
              })}
            </span>
            <span className="col-span-2 text-xs tnum lg:col-span-1 lg:text-right lg:text-sm">
              <b className={w.runs_covered < w.runs_at_risk && g !== "motion" ? "text-stop" : "text-ink"}>{w.runs_covered}</b>
              <span className="text-ink-faint"> / {w.runs_at_risk}<span className="lg:hidden"> runs covered</span></span>
            </span>
            <span className="text-right text-xs text-ink-soft lg:text-left">{dayTime(w.detected_at)}</span>
            <ChevronRight className="h-4 w-4 text-[#9AA4AB] max-lg:hidden" aria-hidden />
          </Link>
        );
      })}
      </div>
    </section>
  );
}
