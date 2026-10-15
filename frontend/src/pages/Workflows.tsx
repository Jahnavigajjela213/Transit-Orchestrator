import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, FlaskConical, Search } from "lucide-react";
import { useData } from "../lib/live";
import { ago, dayTime } from "../lib/format";
import type { Workflow } from "../lib/types";
import LineMap from "../components/LineMap";
import { Empty, ErrorNote, Loading, PageHeader, SeverityTag, StatusBadge, VehicleId } from "../components/ui";

const FILTERS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "approval", label: "Needs approval", statuses: ["awaiting_approval"] },
  { key: "shop", label: "In the shop", statuses: ["awaiting_event", "running"] },
  { key: "done", label: "Completed", statuses: ["completed"] },
  { key: "issues", label: "With issues", statuses: ["completed_with_issues", "compensated", "failed", "rejected"] },
];

export default function Workflows() {
  const nav = useNavigate();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const { data, error } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=200");

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (data || []).filter((w) => !f.statuses || f.statuses.includes(w.status)).length])), [data]);
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const needle = q.trim().toLowerCase();
    return (data || []).filter((w) => (!f.statuses || f.statuses.includes(w.status))
      && (!needle || `${w.vehicle_label} ${w.title}`.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  return (
    <div>
      <PageHeader title="Orchestrations" intro="Every vehicle fault the agent picked up, and where each one stands on its seven steps."
        actions={<Link to="/simulate" className="btn-quiet"><FlaskConical className="h-4 w-4" aria-hidden /> Simulate a fault</Link>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="seg" role="tablist" aria-label="Status">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="ml-1 opacity-60 tnum">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input className="input pl-8" placeholder="Search vehicle or fault" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orchestrations" />
        </label>
      </div>

      {error && <ErrorNote message={error} />}
      {!data ? <div className="panel"><Loading /></div> : rows.length === 0 ? (
        <div className="panel"><Empty title="No orchestrations match">Try another filter, or <Link to="/simulate" className="text-route underline">simulate a vehicle fault</Link>.</Empty></div>
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr><th>Vehicle</th><th>Incident</th><th>Status</th><th className="hidden w-64 lg:table-cell">Progress</th><th className="text-right">Runs covered</th><th>Detected</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} onClick={() => nav(`/workflows/${w.id}`)} className="cursor-pointer hover:bg-paper/70">
                  <td className="align-middle"><VehicleId label={w.vehicle_label} /></td>
                  <td className="align-middle">
                    <Link to={`/workflows/${w.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-route">{w.title.replace(`${w.vehicle_label}: `, "")}</Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
                      <SeverityTag severity={w.severity} />
                      <span>{w.human_touches} approval{w.human_touches === 1 ? "" : "s"}</span>
                      <span className="text-ink-faint">· updated {ago(w.updated_at)}</span>
                    </div>
                  </td>
                  <td className="align-middle"><StatusBadge status={w.status} /></td>
                  <td className="hidden align-middle lg:table-cell"><LineMap steps={w.steps} compact labels={false} /></td>
                  <td className="text-right align-middle tnum">
                    <span className={w.runs_at_risk && w.runs_covered < w.runs_at_risk && w.completed_at ? "font-semibold text-stop" : ""}>{w.runs_covered}</span>
                    <span className="text-ink-faint"> / {w.runs_at_risk}</span>
                  </td>
                  <td className="whitespace-nowrap align-middle text-xs text-ink-soft">{dayTime(w.detected_at)}</td>
                  <td className="align-middle text-ink-faint"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
