import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/live";
import { ago, dayTime, workflowName } from "../lib/format";
import type { Workflow } from "../lib/types";
import LineMap from "../components/LineMap";
import { Empty, ErrorNote, Loading, PageHeader, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

const filters: [string, string][] = [
  ["", "All"], ["running,awaiting_approval,awaiting_event", "In motion"], ["awaiting_approval", "Needs approval"],
  ["completed,completed_with_issues", "Completed"], ["compensated,failed,rejected", "Stopped or rolled back"], ["informational", "Informational"],
];

export default function Workflows() {
  const [status, setStatus] = useState("");
  const [wtype, setWtype] = useState("");
  const { data, error } = useData<Workflow[]>(`/api/workflows?limit=200${status ? `&status=${status}` : ""}${wtype ? `&workflow_type=${wtype}` : ""}`, [status, wtype]);
  return (
    <div>
      <PageHeader title="Orchestrations" intro="Every vehicle health signal the agent picked up, and where each one stands on its seven-step line." />
      <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Workflow type">
        {[["", "All workflows"], ["vehicle_health", "Vehicle health"], ["no_show_recovery", "No-show recovery"]].map(([v, l]) => (
          <button key={l} onClick={() => setWtype(v)} className={`rounded-sm border px-3 py-1 text-xs font-medium ${wtype === v ? "border-ink bg-ink text-white" : "border-rule bg-white hover:border-ink"}`}>{l}</button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map(([v, l]) => (
          <button key={l} onClick={() => setStatus(v)} className={`rounded-full border px-3 py-1 text-xs font-medium ${status === v ? "border-route bg-route text-white" : "border-rule bg-white hover:border-route"}`}>{l}</button>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.length === 0 ? <div className="panel"><Empty title="No orchestrations match this filter" /></div> : (
        <div className="panel divide-y divide-rule">
          {data.map((w) => (
            <Link key={w.id} to={`/workflows/${w.id}`} className="grid gap-3 px-4 py-3 hover:bg-paper/60 lg:grid-cols-[minmax(0,1fr)_minmax(320px,44%)] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <VehicleId label={w.vehicle_label} /><span className="truncate text-sm font-semibold">{w.title.replace(`${w.vehicle_label}: `, "")}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <Tag>{workflowName[w.workflow_type] ?? w.workflow_type}</Tag><StatusBadge status={w.status} /><SeverityTag severity={w.severity} />
                  <span>Detected {dayTime(w.detected_at)}</span>
                  {w.workflow_type === "vehicle_health" && <span>{w.runs_covered}/{w.runs_at_risk} runs covered</span>}
                  <span>{w.human_touches} approval{w.human_touches === 1 ? "" : "s"}</span>
                  <span className="text-ink-faint">updated {ago(w.updated_at)}</span>
                </div>
              </div>
              <LineMap steps={w.steps} compact />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
