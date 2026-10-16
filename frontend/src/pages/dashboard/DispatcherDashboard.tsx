import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, GitBranch, RefreshCw, ShieldAlert } from "lucide-react";
import { useData } from "../../lib/live";
import { useAttentionQueue } from "../../lib/queue";
import { ago, dayTime, sentence } from "../../lib/format";
import type { AuditRecord, Approval, FleetRow, Workflow } from "../../lib/types";
import { Empty, ErrorNote, Loading } from "../../components/ui";
import { DashboardHeader, StatTile, StatTileRow } from "../../components/dashboard/DashboardShell";
import { RecentActivity } from "../../components/dashboard/ActivityFeed";
import { STATUS, currentStep, escalated, groupOf } from "../Workflows";

interface FleetLite { label: string; open_defects?: FleetRow["open_defects"] }

const SEV_DOT: Record<string, string> = { critical: "bg-stop", high: "bg-signal", medium: "bg-route", low: "bg-ink-faint" };

/** The decision's own words, without the vehicle repeated ("Open work order for V-101" -> "Open work order"). */
function shortTitle(a: Approval): string {
  return a.title.replace(new RegExp(`\\s*(for|on)\\s+${a.vehicle_label}\\b`), "").replace(`${a.vehicle_label} `, "").trim();
}

export default function DispatcherDashboard() {
  const nav = useNavigate();
  const { data: queueRaw, all, reload: reloadQueue } = useAttentionQueue();
  const { data: wfs, error: wfErr, reload: reloadWfs } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=500");
  const { data: fleet, reload: reloadFleet } = useData<FleetLite[]>("/api/fleet");
  const { data: activity, error: activityErr, reload: reloadActivity } = useData<AuditRecord[]>("/api/audit?limit=8");

  function refresh() { reloadQueue(); reloadWfs(); reloadFleet(); reloadActivity(); }

  const liveWfs = useMemo(() => (wfs ?? []).filter((w) => w.status !== "shadow"), [wfs]);
  const vehicleOf = useMemo(() => Object.fromEntries((wfs ?? []).map((w) => [w.id, w.vehicle_label])), [wfs]);
  // Running, awaiting approval or waiting on the shop; not yet finished one way or the other.
  const activeWfs = useMemo(() => liveWfs.filter((w) => !["done", "issues"].includes(groupOf(w))), [liveWfs]);

  // Only what this dispatcher can actually act on - the same server-computed flag the Focus Queue itself uses.
  const decidable = useMemo(() => all.filter((a) => a.can_decide), [all]);

  // One row per Vestige defect; a vehicle can carry more than one, each counted once.
  const serviceDefects = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; vehicle: string; category: string; severity: string }[] = [];
    (fleet ?? []).forEach((v) => (v.open_defects ?? []).forEach((d) => {
      if (d.out_of_service && !seen.has(d.id)) { seen.add(d.id); out.push({ id: d.id, vehicle: v.label, category: d.category, severity: d.severity }); }
    }));
    return out;
  }, [fleet]);
  const escalationCount = all.filter((a) => a.kind === "escalation").length;
  const disruptionCount = escalationCount + serviceDefects.length;

  const vehiclesWithDefects = useMemo(() => (fleet ?? []).filter((v) => (v.open_defects?.length ?? 0) > 0), [fleet]);
  const criticalVehicles = useMemo(() => vehiclesWithDefects.filter((v) => v.open_defects!.some((d) => d.severity === "critical")), [vehiclesWithDefects]);

  const activeSorted = useMemo(() => [...activeWfs].sort((a, b) =>
    (escalated(b) ? 1 : 0) - (escalated(a) ? 1 : 0) || b.started_at.localeCompare(a.started_at)), [activeWfs]);

  return (
    <div className="space-y-5 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
      <DashboardHeader
        title="Dispatcher Dashboard"
        actions={<button type="button" onClick={refresh} className="btn-quiet flex h-9 items-center gap-1.5 px-3 text-[13px]"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</button>} />

      <StatTileRow>
        <StatTile label="Pending decisions" icon={ClipboardCheck} value={queueRaw ? decidable.length : "—"} sub="Awaiting your approval"
          tone={decidable.length ? "warn" : "good"} onClick={() => nav("/attention")} />
        <StatTile label="Active orchestrations" icon={GitBranch} value={wfs ? activeWfs.length : "—"} sub="Running or awaiting action"
          onClick={() => nav("/workflows")} />
        <StatTile label="Service disruptions" icon={AlertTriangle} value={queueRaw && fleet ? disruptionCount : "—"} sub="Trips and vehicles affected"
          tone={disruptionCount ? "bad" : "good"} onClick={() => nav("/attention?kind=escalation")} />
        <StatTile label="Vehicles requiring attention" icon={ShieldAlert} value={fleet ? vehiclesWithDefects.length : "—"}
          sub={`${criticalVehicles.length} critical`} tone={criticalVehicles.length ? "bad" : vehiclesWithDefects.length ? "warn" : "good"}
          onClick={() => nav(criticalVehicles.length ? "/work-orders?priority=critical" : "/work-orders")} />
      </StatTileRow>

      <div className="grid grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <section className="card flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Needs your attention</h2>
            <button type="button" className="text-[13px] font-medium text-route hover:underline" onClick={() => nav("/attention")}>View all</button>
          </div>
          {!queueRaw ? <div className="mt-2"><Loading /></div> : decidable.length === 0 ? (
            <div className="mt-2 flex-1"><Empty title="No operational decisions require your attention" /></div>
          ) : (
            <ul className="mt-3 flex-1 divide-y divide-rule-soft">
              {decidable.slice(0, 3).map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="flex w-full items-center gap-3">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[a.severity ?? "low"] ?? "bg-ink-faint"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[13px] font-semibold">{shortTitle(a)}</span>
                        <span className="chip-v">{a.vehicle_label}</span>
                        <span className={`pill text-[10.5px] ${a.kind === "escalation" ? "bg-stop-tint text-stop" : "bg-signal-tint text-signal-ink"}`}>
                          {a.kind === "escalation" ? "Manual action" : "Approval"}
                        </span>
                        <span className="text-[11px] text-ink-faint" title={dayTime(a.requested_at)}>{ago(a.requested_at)}</span>
                      </div>
                    </div>
                    <button type="button" className="btn-quiet h-8 shrink-0 px-3 text-[12.5px]" onClick={() => nav("/attention")}>Review</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Active orchestrations</h2>
            <button type="button" className="text-[13px] font-medium text-route hover:underline" onClick={() => nav("/workflows")}>View all</button>
          </div>
          {wfErr && <div className="mt-3"><ErrorNote message={wfErr} /></div>}
          {!wfs ? <div className="mt-2"><Loading /></div> : activeSorted.length === 0 ? (
            <div className="mt-2 flex-1"><Empty title="Nothing in motion">Every orchestration has finished or needs a decision first.</Empty></div>
          ) : (
            <ul className="mt-3 flex-1 divide-y divide-rule-soft">
              {activeSorted.slice(0, 3).map((w) => {
                const g = groupOf(w);
                const [label, tone] = STATUS[g];
                const idx = currentStep(w);
                const step = w.steps[Math.min(idx, 7) - 1];
                const esc = escalated(w);
                return (
                  <li key={w.id} className="py-2.5">
                    <div className="flex w-full items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-[13px] font-semibold">{w.title.replace(`${w.vehicle_label}: `, "")}</span>
                          <span className="chip-v">{w.vehicle_label}</span>
                          <span className={`pill text-[10.5px] ${esc ? "bg-stop-tint text-stop" : tone}`}>{esc ? "Blocked" : label}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          Step {Math.min(idx, 7)}/7 · {step?.label ?? sentence(w.current_step ?? "")} · started {ago(w.started_at)} · {w.runs_covered}/{w.runs_at_risk} runs covered
                        </p>
                      </div>
                      <button type="button" className="btn-quiet h-8 shrink-0 px-3 text-[12.5px]" onClick={() => nav(`/workflows/${w.id}`)}>Open</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <RecentActivity title="Recent operational activity" viewAllHref="/audit" activity={activity} error={activityErr} vehicleOf={vehicleOf} />
    </div>
  );
}
