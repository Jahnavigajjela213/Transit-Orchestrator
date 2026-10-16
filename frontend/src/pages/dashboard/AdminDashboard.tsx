import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, GitBranch, ShieldAlert, XCircle } from "lucide-react";
import { useData } from "../../lib/live";
import { useAttentionQueue } from "../../lib/queue";
import { ago, dayTime, sentence } from "../../lib/format";
import type { AuditRecord, FleetRow, Workflow } from "../../lib/types";
import { Empty, ErrorNote, Loading } from "../../components/ui";
import { StatTile, StatTileRow, ViewAllButton } from "../../components/dashboard/DashboardShell";
import { RecentActivity } from "../../components/dashboard/ActivityFeed";
import { STATUS, groupOf, type Group } from "../Workflows";

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const sevRank = (s: string | null | undefined) => SEV_RANK[s ?? ""] ?? 2;
const SEV_DOT: Record<string, string> = { critical: "bg-stop", high: "bg-signal", medium: "bg-route", low: "bg-ink-faint" };
/** No period switch in the header any more; KPIs read over a fixed trailing window. */
const DAYS = 28;

interface Alert { id: string; severity: string; title: string; ref?: string; description: string; at: string; onClick?: () => void }

export default function AdminDashboard() {
  const nav = useNavigate();

  const { data: queueRaw, all, escalations } = useAttentionQueue();
  const { data: wfs, error: wfErr } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=500");
  const { data: fleet } = useData<FleetRow[]>("/api/fleet");
  const { data: activity, error: activityErr } = useData<AuditRecord[]>("/api/audit?limit=8");
  const { data: governanceAudit } = useData<AuditRecord[]>("/api/audit?record_type=human_action,policy_change&limit=20");

  const liveWfs = useMemo(() => (wfs ?? []).filter((w) => w.status !== "shadow"), [wfs]);
  const vehicleOf = useMemo(() => Object.fromEntries((wfs ?? []).map((w) => [w.id, w.vehicle_label])), [wfs]);
  const since = Date.now() - DAYS * 86400000;
  const inPeriod = useMemo(() => liveWfs.filter((w) => new Date(w.started_at).getTime() >= since), [liveWfs, since]);

  const activeCount = liveWfs.filter((w) => groupOf(w) === "motion").length;
  const failedCount = inPeriod.filter((w) => w.status === "failed").length;

  // One row per Vestige defect; a vehicle can carry more than one, each counted once.
  const criticalDefects = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; vehicle: string; category: string; out_of_service: boolean; created_at: string }[] = [];
    (fleet ?? []).forEach((v) => (v.open_defects ?? []).forEach((d) => {
      if (d.severity === "critical" && !seen.has(d.id)) { seen.add(d.id); out.push({ id: d.id, vehicle: v.label, category: d.category, out_of_service: d.out_of_service, created_at: d.created_at }); }
    }));
    return out;
  }, [fleet]);

  const chartGroups = (["approval", "motion", "shop", "done", "issues"] as Group[]).map((g) => ({ g, label: STATUS[g][0], n: inPeriod.filter((w) => groupOf(w) === g).length }));
  const chartMax = Math.max(1, ...chartGroups.map((c) => c.n));

  const alertsLoaded = !!wfs && !!fleet && !!queueRaw && !!governanceAudit;
  const alerts: Alert[] = useMemo(() => {
    const out: Alert[] = [];
    all.filter((a) => a.kind === "escalation").forEach((a) => out.push({
      id: `esc-${a.id}`, severity: a.severity ?? "high", title: "Manual action needed",
      ref: a.vehicle_label ?? undefined, description: a.title, at: a.requested_at, onClick: () => nav("/attention?kind=escalation"),
    }));
    liveWfs.filter((w) => w.status === "failed").forEach((w) => out.push({
      id: `wf-${w.id}`, severity: w.severity ?? "high", title: "Orchestration failed",
      ref: w.vehicle_label ?? undefined, description: w.title, at: w.updated_at, onClick: () => nav(`/workflows/${w.id}`),
    }));
    criticalDefects.forEach((d) => out.push({
      id: `def-${d.id}`, severity: "critical", title: "Critical vehicle fault",
      ref: d.vehicle, description: `${sentence(d.category)}${d.out_of_service ? ", vehicle out of service" : ""}`, at: d.created_at,
      onClick: () => nav("/work-orders?priority=critical"),
    }));
    (governanceAudit ?? []).filter((r) => r.record_type === "policy_change" || r.human_action === "override" || r.outcome === "overridden")
      .forEach((r) => out.push({
        id: `aud-${r.id}`, severity: "medium", title: r.record_type === "policy_change" ? "Autonomy policy changed" : "Operational action overridden",
        ref: r.workflow_id ?? undefined, description: r.explanation || sentence(r.outcome ?? ""), at: r.created_at,
        onClick: r.record_type === "policy_change" ? () => nav("/policies") : r.workflow_id ? () => nav(`/workflows/${r.workflow_id}`) : undefined,
      }));
    return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.at.localeCompare(b.at)).slice(0, 3);
  }, [all, liveWfs, criticalDefects, governanceAudit, nav]);

  return (
    <div className="dash-scroll space-y-5 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
      <StatTileRow>
        <StatTile label="Active orchestrations" icon={GitBranch} value={wfs ? activeCount : "—"} sub="Currently running" onClick={() => nav("/workflows?status=motion")} />
        <StatTile label="Pending approvals" icon={Bell} value={queueRaw ? all.length : "—"} sub={`Awaiting authorized review${escalations ? ` · ${escalations} manual` : ""}`}
          tone={all.length ? "warn" : "good"} onClick={() => nav("/attention")} />
        <StatTile label="Failed workflows" icon={XCircle} value={wfs ? failedCount : "—"} sub={`Require investigation · ${DAYS}d`}
          tone={failedCount ? "bad" : "good"} onClick={() => nav("/workflows?status=issues")} />
        <StatTile label="Critical vehicle faults" icon={ShieldAlert} value={fleet ? criticalDefects.length : "—"} sub="Require safety assessment"
          tone={criticalDefects.length ? "bad" : "good"} onClick={() => nav("/work-orders?priority=critical")} />
      </StatTileRow>

      <div className="grid grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <section className="card flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Priority alerts</h2>
            <ViewAllButton onClick={() => nav("/work-orders")} />
          </div>
          {wfErr && <div className="mt-3"><ErrorNote message={wfErr} /></div>}
          {!alertsLoaded ? <div className="mt-2"><Loading /></div> : alerts.length === 0 ? (
            <div className="mt-2 flex-1"><Empty title="No priority alerts" /></div>
          ) : (
            <ul className="mt-3 flex-1 divide-y divide-rule-soft">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button type="button" disabled={!a.onClick} onClick={a.onClick} title={dayTime(a.at)}
                    className={`flex w-full items-start gap-3 rounded-lg py-2.5 text-left ${a.onClick ? "hover:bg-panel" : ""}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[a.severity] ?? "bg-ink-faint"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold">{a.title}{a.ref && <span className="chip-v">{a.ref}</span>}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-soft">{a.description}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">{ago(a.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex h-full flex-col p-4">
          <h2 className="text-[15px] font-semibold">Orchestration health</h2>
          {!wfs ? <div className="mt-2"><Loading /></div> : inPeriod.length === 0 ? <div className="mt-2 flex-1"><Empty title="No orchestrations in this period" /></div> : (
            <div className="mt-3 flex-1 space-y-2.5">
              {chartGroups.map((c) => (
                <button key={c.g} type="button" onClick={() => nav(`/workflows?status=${c.g}`)} aria-label={`${c.label}: ${c.n}. Open in Orchestrations.`}
                  className="flex w-full items-center gap-3 rounded-lg text-left hover:opacity-80">
                  <span className="w-28 shrink-0 text-[13px] font-medium">{c.label}</span>
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]"><div className="h-full rounded-full bg-route" style={{ width: `${(c.n / chartMax) * 100}%` }} /></div>
                  <span className="w-8 shrink-0 text-right text-xs font-semibold tnum">{c.n}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <RecentActivity title="Recent system activity" viewAllHref="/audit" activity={activity} error={activityErr} vehicleOf={vehicleOf} />
    </div>
  );
}
