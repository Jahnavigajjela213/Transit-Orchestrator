import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { useData } from "../lib/live";
import { ago, workflowName } from "../lib/format";
import type { Workflow } from "../lib/types";
import LineMap from "../components/LineMap";
import { Head } from "../components/focus";
import { ErrorNote, Loading, SeverityTag, StatusBadge, VehicleId } from "../components/ui";

/* Orchestrations: every vehicle fault the agent picked up, and where each stands on the seven pilot steps. */

const FILTERS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "you", label: "Needs approval", statuses: ["awaiting_approval"] },
  { key: "working", label: "Running", statuses: ["running", "shadow"] },
  { key: "shop", label: "In the shop", statuses: ["awaiting_event"] },
  { key: "done", label: "Completed", statuses: ["completed", "completed_with_issues", "compensated", "failed", "rejected", "informational"] },
];

export default function Workflows() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [wtype, setWtype] = useState("");  // the pilot and the follow-on No-Show Recovery Agent
  const { data: all, error } = useData<Workflow[]>("/api/workflows?limit=200");
  const data = useMemo(() => all && all.filter((w) => !wtype || w.workflow_type === wtype), [all, wtype]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (data || []).filter((w) => !f.statuses || f.statuses.includes(w.status)).length])), [data]);
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const needle = q.trim().toLowerCase();
    return (data || []).filter((w) => (!f.statuses || f.statuses.includes(w.status)) && (!needle || `${w.vehicle_label} ${w.title}`.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  return (
    <div className="w-full max-w-[1240px] px-4 py-6 sm:px-10 sm:py-8">
      <Head title="Orchestrations" intro="Every event the agent picked up, and where each orchestration stands on its steps: the pilot (Vehicle Health to Service Continuity) and the No-Show Recovery Agent." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={wtype} onChange={(e) => setWtype(e.target.value)} aria-label="Use case">
          <option value="">All use cases</option>
          {Object.entries(workflowName).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}<span className="ml-1 font-mono text-xs text-ink-faint">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input className="input pl-9" placeholder="Search vehicle or fault" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orchestrations" />
        </label>
      </div>

      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : (
        <div className="overflow-hidden rounded-[14px] border border-rule">
          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center"><p className="font-semibold">No orchestrations match</p><p className="mt-1 text-sm text-ink-faint">Try another filter, or <Link to="/simulate" className="text-route underline">simulate a vehicle fault</Link>.</p></div>
          ) : rows.map((w) => (
            <Link key={w.id} to={`/workflows/${w.id}`}
              className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-rule px-[18px] py-4 last:border-b-0 hover:bg-[#FAFBFB] md:grid-cols-[70px_minmax(0,1.6fr)_minmax(180px,1fr)_150px_130px_20px]">
              <span><VehicleId label={w.vehicle_label} /></span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{w.title.replace(`${w.vehicle_label}: `, "")}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-faint">
                  <SeverityTag severity={w.severity} />{w.workflow_type !== "vehicle_health" && <span className="rounded-full bg-[#F3E8FF] px-2 py-0.5 text-[11px] font-semibold text-[#6A2FA0]">{workflowName[w.workflow_type] ?? w.workflow_type}</span>}<span>{w.human_touches} approval{w.human_touches === 1 ? "" : "s"} · updated {ago(w.updated_at)}</span>
                </span>
              </span>
              <span className="hidden md:block"><LineMap steps={w.steps} compact labels={false} /></span>
              <span className="hidden md:block"><StatusBadge status={w.status} /></span>
              <span className={`hidden font-mono text-[13px] md:block ${w.runs_at_risk && w.runs_covered < w.runs_at_risk && w.completed_at ? "font-semibold text-stop" : "text-ink-faint"}`}>{w.runs_covered}/{w.runs_at_risk} runs covered</span>
              <ChevronRight className="hidden h-4 w-4 text-ink-faint md:block" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
