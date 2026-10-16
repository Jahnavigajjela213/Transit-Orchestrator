import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BadgeCheck, Building2, CalendarClock, ClipboardList, Cpu, Eye, Gauge, GitBranch, KeyRound, MapPin,
  MessageSquare, Plug, ShieldAlert, Sparkles, Target, UserCheck, Users, UserX, Wrench, type LucideIcon,
} from "lucide-react";
import { useData } from "../../lib/live";
import { useAttentionQueue } from "../../lib/queue";
import { ago, dayTime, fmtMin, pct, roleName, seconds, sentence, words } from "../../lib/format";
import { panelFullPageLink, panelModuleTag } from "../../lib/modules";
import type { AuditRecord, FleetRow, Role, ShadowRec, Workflow } from "../../lib/types";
import { Empty, ErrorNote, Loading, SeverityTag, StatusBadge, Tag, VehicleId } from "../ui";
import PerformanceChat from "../PerformanceChat";
import { HBar, Sparkline } from "./charts";
import { SidePanel, usePanelParam } from "./SidePanel";

/** A panel's footer "Open X →" link — callers pass `to` only after checking `hasModule(role, path)` themselves,
 *  so a dashboard never hands a role a link to a module it cannot see in its own rail. */
export function FullPageLink({ to, label }: { to: string | null; label: string }) {
  if (!to) return null;
  return <Link to={to} className="text-[13px] font-medium text-route hover:underline">{label} →</Link>;
}

const Th = (p: { children?: React.ReactNode; right?: boolean }) => <th className={`sticky top-0 z-10 bg-white ${p.right ? "text-right" : ""}`}>{p.children}</th>;

// ------------------------------------------------------------------ escalations
function EscalationsPanel({ open }: { open: boolean }) {
  const { all } = useAttentionQueue();
  const rows = useMemo(() => all.filter((a) => a.kind === "escalation"), [all]);
  if (!open) return null;
  return rows.length === 0 ? <Empty title="No manual actions needed">Every escalation has been handled.</Empty> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Vehicle</Th><Th>What's needed</Th><Th>Severity</Th><Th right>Waiting</Th></tr></thead>
      <tbody>{rows.map((a) => (
        <tr key={a.id}><td><VehicleId label={a.vehicle_label} /></td><td className="font-medium">{a.title}</td>
          <td><SeverityTag severity={a.severity} /></td><td className="text-right text-xs tnum">{ago(a.requested_at)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

// ------------------------------------------------------------------ in-motion / orchestration outcomes
function InMotionPanel({ open }: { open: boolean }) {
  const { data } = useData<Workflow[]>(open ? "/api/workflows?workflow_type=vehicle_health&limit=200" : null);
  const active = useMemo(() => (data || []).filter((w) => ["running", "awaiting_approval", "awaiting_event"].includes(w.status)), [data]);
  if (!data) return <Loading />;
  return active.length === 0 ? <Empty title="Nothing in motion" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Vehicle</Th><Th>Incident</Th><Th>Status</Th><Th right>Updated</Th></tr></thead>
      <tbody>{active.map((w) => (
        <tr key={w.id}><td><VehicleId label={w.vehicle_label} /></td>
          <td><Link to={`/workflows/${w.id}`} className="font-medium hover:underline">{w.title.replace(`${w.vehicle_label}: `, "")}</Link></td>
          <td><StatusBadge status={w.status} /></td><td className="text-right text-xs tnum">{ago(w.updated_at)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function OrchestrationOutcomesPanel({ open }: { open: boolean }) {
  const { data } = useData<{ workflows: { total: number; vehicle_health: number; no_show_recovery: number; by_status: Record<string, number> } }>(open ? "/api/metrics/summary" : null);
  if (!data) return <Loading />;
  const w = data.workflows;
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-2xs text-ink-soft">Total</div><div className="text-lg font-semibold tnum">{w.total}</div></div>
        <div><div className="text-2xs text-ink-soft">Vehicle health</div><div className="text-lg font-semibold tnum">{w.vehicle_health}</div></div>
        <div><div className="text-2xs text-ink-soft">No-show recovery</div><div className="text-lg font-semibold tnum">{w.no_show_recovery}</div></div>
      </div>
      <table className="table">
        <thead><tr><Th>Status</Th><Th right>Count</Th></tr></thead>
        <tbody>{Object.entries(w.by_status).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
          <tr key={k}><td><StatusBadge status={k} /></td><td className="text-right tnum">{n}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ out-of-service / pm-due / spares-drivers
function OutOfServicePanel({ open }: { open: boolean }) {
  const { data } = useData<FleetRow[]>(open ? "/api/fleet" : null);
  const rows = useMemo(() => (data || []).filter((v) => v.schedule_status !== "available"), [data]);
  if (!data) return <Loading />;
  return rows.length === 0 ? <Empty title="Every vehicle is in service" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Vehicle</Th><Th>Depot</Th><Th>Why</Th><Th right>Until</Th></tr></thead>
      <tbody>{rows.map((v) => (
        <tr key={v.vehicle_id}><td><VehicleId label={v.label} /></td><td>{v.depot}</td>
          <td className="text-xs">{v.unavailable_reason ?? sentence(v.schedule_status)}</td>
          <td className="text-right text-xs tnum">{v.unavailable_until ? dayTime(v.unavailable_until) : "—"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function PmDuePanel({ open }: { open: boolean }) {
  const { data } = useData<FleetRow[]>(open ? "/api/fleet" : null);
  const rows = useMemo(() => (data || []).filter((v) => v.pm_miles_over >= 0).sort((a, b) => b.pm_miles_over - a.pm_miles_over), [data]);
  if (!data) return <Loading />;
  return rows.length === 0 ? <Empty title="Nothing is overdue for preventive maintenance" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Vehicle</Th><Th>Depot</Th><Th right>Miles overdue</Th></tr></thead>
      <tbody>{rows.map((v) => (
        <tr key={v.vehicle_id}><td><VehicleId label={v.label} /></td><td>{v.depot}</td>
          <td className="text-right tnum"><Tag color="red">{v.pm_miles_over.toLocaleString()} mi</Tag></td></tr>
      ))}</tbody>
    </table></div>
  );
}

function SparesDriversPanel({ open }: { open: boolean }) {
  const { data: fleet } = useData<FleetRow[]>(open ? "/api/fleet" : null);
  const { data: drivers } = useData<{ safety_id: string; name: string; compliant: boolean; blocking: string[]; status: string }[]>(open ? "/products/safety/drivers" : null);
  const spares = useMemo(() => (fleet || []).filter((v) => v.schedule_status === "available" && !v.active_workflow), [fleet]);
  const nonCompliant = useMemo(() => (drivers || []).filter((d) => !d.compliant), [drivers]);
  if (!fleet || !drivers) return <Loading />;
  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Spare vehicles · {spares.length}</h3>
        {spares.length === 0 ? <p className="text-sm text-ink-soft">No spare vehicles free right now.</p> : (
          <div className="flex flex-wrap gap-1.5">{spares.map((v) => <VehicleId key={v.vehicle_id} label={v.label} />)}</div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Drivers not compliant · {nonCompliant.length}</h3>
        {nonCompliant.length === 0 ? <p className="text-sm text-ink-soft">Every driver is in compliance.</p> : (
          <ul className="space-y-1.5 text-sm">{nonCompliant.map((d) => (
            <li key={d.safety_id} className="flex items-start gap-2"><Tag color="red">No</Tag><span>{d.name}: {d.blocking.map(sentence).join("; ")}</span></li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

function DriverCompliancePanel({ open }: { open: boolean }) {
  const { data } = useData<{ safety_id: string; name: string; compliant: boolean; wheelchair_ok: boolean; blocking: string[]; wheelchair_reasons: string[]; status: string }[]>(open ? "/products/safety/drivers" : null);
  const rows = useMemo(() => (data || []).filter((d) => !d.compliant || !d.wheelchair_ok), [data]);
  if (!data) return <Loading />;
  return rows.length === 0 ? <Empty title="Everyone is in compliance" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Driver</Th><Th>May drive</Th><Th>Why</Th></tr></thead>
      <tbody>{rows.map((d) => (
        <tr key={d.safety_id}><td className="font-medium">{d.name}</td>
          <td>{!d.compliant ? <Tag color="red">No</Tag> : <Tag color="amber">No wheelchair runs</Tag>}</td>
          <td className="text-xs">{(!d.compliant ? d.blocking : d.wheelchair_reasons).map(sentence).join("; ")}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

// ------------------------------------------------------------------ defects / work-orders / shop bays
function DefectsPanel({ open }: { open: boolean }) {
  const { data } = useData<{ id: string; vehicle_label: string; category: string; severity: string; out_of_service: boolean; created_at: string }[]>(open ? "/products/safety/defects?status=open" : null);
  if (!data) return <Loading />;
  return data.length === 0 ? <Empty title="No open defects" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Defect</Th><Th>Vehicle</Th><Th>Category</Th><Th>Severity</Th><Th right>Opened</Th></tr></thead>
      <tbody>{data.map((d) => (
        <tr key={d.id}><td className="font-mono text-xs">{d.id}</td><td><VehicleId label={d.vehicle_label} /></td>
          <td>{d.category}{d.out_of_service && <div><Tag color="red">Out of service</Tag></div>}</td>
          <td><SeverityTag severity={d.severity} /></td><td className="text-right text-xs tnum">{ago(d.created_at)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function WorkOrdersPanel({ open }: { open: boolean }) {
  const { data } = useData<{ id: string; asset_number: string; status: string; priority: string; title: string; shop_start: string | null }[]>(open ? "/products/asset-mgmt/work-orders" : null);
  const rows = useMemo(() => (data || []).filter((w) => w.status === "open" || w.status === "in_progress"), [data]);
  if (!data) return <Loading />;
  return rows.length === 0 ? <Empty title="No open work orders right now" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Work order</Th><Th>Title</Th><Th>Priority</Th><Th>Status</Th></tr></thead>
      <tbody>{rows.map((w) => (
        <tr key={w.id}><td className="font-mono text-xs">{w.id}</td><td className="font-medium">{w.title}</td>
          <td><SeverityTag severity={w.priority} /></td><td><StatusBadge status={w.status} /></td></tr>
      ))}</tbody>
    </table></div>
  );
}

function ShopBaysPanel({ open }: { open: boolean }) {
  const { data } = useData<{ day: string; depot: string; bays_total: number; bays_booked: number }[]>(open ? "/products/asset-mgmt/shop-capacity?days=4" : null);
  const byDepot = useMemo(() => {
    const m = new Map<string, { booked: number; total: number }>();
    for (const b of data || []) { const d = m.get(b.depot) ?? { booked: 0, total: 0 }; d.booked += b.bays_booked; d.total += b.bays_total; m.set(b.depot, d); }
    return [...m.entries()];
  }, [data]);
  if (!data) return <Loading />;
  return byDepot.length === 0 ? <Empty title="No shop bay data" /> : (
    <div className="space-y-3 p-4">{byDepot.map(([depot, v]) => (
      <div key={depot}>
        <div className="flex justify-between text-[13px]"><span className="font-medium">{depot}</span><span className="text-ink-soft tnum">{v.booked} of {v.total} booked, next 4 days</span></div>
        <div className="mt-1"><HBar pct={(v.booked / Math.max(1, v.total)) * 100} tone={v.booked / Math.max(1, v.total) >= 0.8 ? "signal" : "route"} /></div>
      </div>
    ))}</div>
  );
}

// ------------------------------------------------------------------ todays-runs / no-show-recovery / rider-messages
function TodaysRunsPanel({ open }: { open: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = useData<{ id: string; route_name: string; block_name: string; start_time: string; vehicle_code: string; driver_code: string; status: string; delay_minutes: number }[]>(
    open ? `/products/trip-mgmt/runs?service_date=${today}` : null);
  if (!data) return <Loading />;
  const late = [...data].sort((a, b) => b.delay_minutes - a.delay_minutes);
  return data.length === 0 ? <Empty title="No runs today" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Run</Th><Th>Starts</Th><Th>Vehicle</Th><Th>Driver</Th><Th>Status</Th><Th right>Late</Th></tr></thead>
      <tbody>{late.slice(0, 60).map((r) => (
        <tr key={r.id}><td>{r.route_name} <span className="text-2xs text-ink-soft">{r.block_name}</span></td>
          <td className="text-xs tnum">{dayTime(r.start_time)}</td><td className="font-mono text-xs">{r.vehicle_code}</td>
          <td className="text-xs">{r.driver_code}</td><td><StatusBadge status={r.status} /></td>
          <td className="text-right tnum">{r.delay_minutes > 0 ? `+${r.delay_minutes} min` : "On time"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function NoShowRecoveryPanel({ open }: { open: boolean }) {
  const { data } = useData<{ no_show: { orchestrations: number; finished: number; minutes_freed: number; standby_riders_booked: number; pickups_retimed: number; late_pickups_avoided: number; riders_flagged_for_review: number; recovered_pct: number | null } }>(open ? "/api/metrics/summary" : null);
  if (!data) return <Loading />;
  const n = data.no_show;
  const rows: [string, number | string][] = [
    ["Started", n.orchestrations], ["Handled", n.finished], ["Recovered", n.recovered_pct === null ? "—" : `${n.recovered_pct}%`],
    ["Minutes freed", n.minutes_freed], ["Standby riders seated", n.standby_riders_booked], ["Pickups re-timed", n.pickups_retimed],
    ["Late pickups avoided", n.late_pickups_avoided], ["Flagged for review", n.riders_flagged_for_review],
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 p-4 text-sm">{rows.map(([k, v]) => (
      <div key={k}><dt className="text-2xs text-ink-soft">{k}</dt><dd className="text-lg font-semibold tnum">{v}</dd></div>
    ))}</dl>
  );
}

function RiderMessagesPanel({ open }: { open: boolean }) {
  const { data } = useData<{ id: string; rider_name: string; channel: string; language: string; kind: string; message: string; created_at: string }[]>(open ? "/products/rider-comms/notifications" : null);
  const recent = useMemo(() => (data || []).filter((n) => Date.now() - new Date(n.created_at).getTime() < 24 * 3600e3), [data]);
  if (!data) return <Loading />;
  return recent.length === 0 ? <Empty title="No rider messages in the last 24 hours" /> : (
    <ul className="divide-y divide-rule text-sm">{recent.slice(0, 40).map((n) => (
      <li key={n.id} className="px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-ink-soft"><span className="font-medium text-ink">{n.rider_name}</span><Tag>{n.channel}</Tag><span>{words(n.kind)}</span><span className="ml-auto">{ago(n.created_at)}</span></div>
        <p className="mt-1">{n.message}</p>
      </li>
    ))}</ul>
  );
}

// ------------------------------------------------------------------ shop approvals (dispatcher/shop)
export function useOpenWorkOrderApprovals() {
  const { all } = useAttentionQueue();
  return useMemo(() => all.filter((a) => a.step === "open_work_order" && a.can_decide), [all]);
}

function ShopApprovalsPanel({ open }: { open: boolean }) {
  const rows = useOpenWorkOrderApprovals();
  if (!open) return null;
  return rows.length === 0 ? <Empty title="Nothing waiting for your approval" /> : (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Vehicle</Th><Th>Work order</Th><Th>Priority</Th><Th right>Waiting</Th></tr></thead>
      <tbody>{rows.map((a) => (
        <tr key={a.id}><td><VehicleId label={a.vehicle_label} /></td><td className="font-medium">{a.title}</td>
          <td><SeverityTag severity={a.severity} /></td><td className="text-right text-xs tnum">{ago(a.requested_at)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

// ------------------------------------------------------------------ shadow / audit
function ShadowPanel({ open }: { open: boolean }) {
  const { data: summary } = useData<{ steps: { step: string; agreement_pct: number | null; ready_to_go_live: boolean }[] }>(open ? "/api/shadow/summary" : null);
  const { data: recs } = useData<ShadowRec[]>(open ? "/api/shadow" : null);
  if (!summary || !recs) return <Loading />;
  return (
    <div className="space-y-4 p-4">
      <table className="table">
        <thead><tr><Th>Step</Th><Th right>Agreement</Th><Th /></tr></thead>
        <tbody>{summary.steps.map((s) => (
          <tr key={s.step}><td>{sentence(s.step)}</td><td className="text-right tnum">{s.agreement_pct === null ? "—" : `${s.agreement_pct}%`}</td>
            <td>{s.ready_to_go_live && <Tag color="green">Ready to go live</Tag>}</td></tr>
        ))}</tbody>
      </table>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Recent comparisons</h3>
        <ul className="divide-y divide-rule text-sm">{recs.slice(0, 15).map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2"><VehicleId label={r.vehicle_label} /><span className="flex-1 truncate">{sentence(r.step)}</span>
            <span className="tnum text-ink-soft">{r.agreement_pct === null ? "—" : `${r.agreement_pct}%`}</span></li>
        ))}</ul>
      </div>
    </div>
  );
}

function AuditPanel({ open }: { open: boolean }) {
  const { data } = useData<AuditRecord[]>(open ? "/api/audit?limit=20" : null);
  if (!data) return <Loading />;
  return data.length === 0 ? <Empty title="No audit records yet" /> : (
    <ul className="divide-y divide-rule text-sm">{data.map((r) => (
      <li key={r.id} className="px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-ink-soft"><span className="font-mono">{seconds(r.created_at)}</span>
          <span className="font-semibold text-ink">{sentence(r.record_type)}</span>{r.step && <span>· {words(r.step)}</span>}</div>
        <p className="mt-0.5 truncate">{r.explanation}</p>
      </li>
    ))}</ul>
  );
}

// ------------------------------------------------------------------ pilot measures (admin + analyst, read-only)
export interface PilotValues {
  detect_to_work_order_minutes: number | null; detect_to_work_order_samples: number; manual_reentries_per_incident: number | null;
  runs_covered_pct: number | null; runs_at_risk: number; runs_covered: number; audit_complete_pct: number | null;
  acceptance_pct: number | null; decisions: number; auto_returned_pct: number | null;
}
export interface PilotData { measures: PilotValues; weeks: ({ week: string } & PilotValues)[]; baseline: Record<string, number | null>; baseline_source: string }

export function measureCards(m: PilotValues, b: Record<string, number | null>) {
  const pctv = (v: number | null | undefined) => (v == null ? "not set" : `${v}%`);
  return [
    { key: "detect_to_work_order_minutes", label: "Fault detection to open work order", question: "When a bus reports a fault, how long until a repair job exists in FASTER?", value: fmtMin(m.detect_to_work_order_minutes), unit: m.detect_to_work_order_minutes == null ? "no data yet" : `median · ${m.detect_to_work_order_samples} work order${m.detect_to_work_order_samples === 1 ? "" : "s"}`, baseline: fmtMin(b.detect_to_work_order_minutes), target: "Under 5 min", ok: (m.detect_to_work_order_minutes ?? 99) < 5 },
    { key: "manual_reentries_per_incident", label: "Manual re-entry per incident", question: "How often did someone retype the same thing into another system by hand?", value: m.manual_reentries_per_incident == null ? "—" : String(m.manual_reentries_per_incident), unit: "per incident", baseline: b.manual_reentries_per_incident == null ? "not set" : `${b.manual_reentries_per_incident}`, target: "Eliminated", ok: m.manual_reentries_per_incident === 0 },
    { key: "runs_covered_pct", label: "Affected runs covered before pull-out", question: "When a bus comes off the road, how many of its trips got a spare bus and driver?", value: m.runs_covered_pct == null ? "—" : `${m.runs_covered_pct}%`, unit: m.runs_covered_pct == null ? "no data yet" : `${m.runs_covered} of ${m.runs_at_risk} runs`, baseline: pctv(b.runs_covered_pct),
      target: b.runs_covered_pct == null ? "Better than before" : b.runs_covered_pct >= 100 ? "Stay at 100%" : `Above ${b.runs_covered_pct}%`,
      ok: b.runs_covered_pct == null ? (m.runs_covered_pct ?? 0) >= 90 : b.runs_covered_pct >= 100 ? m.runs_covered_pct === 100 : (m.runs_covered_pct ?? 0) > b.runs_covered_pct },
    { key: "audit_complete_pct", label: "Decisions with a complete audit record", question: "Can every decision be explained afterwards: who, why, and from which data?", value: m.audit_complete_pct == null ? "—" : `${m.audit_complete_pct}%`, unit: "of orchestrations", baseline: pctv(b.audit_complete_pct), target: "100%", ok: m.audit_complete_pct === 100 },
    { key: "acceptance_pct", label: "Dispatcher acceptance", question: "How often did the dispatcher approve the agent's suggestion without changing it?", value: m.acceptance_pct == null ? "—" : `${m.acceptance_pct}%`, unit: m.acceptance_pct == null ? "no decisions yet" : `${m.decisions} decision${m.decisions === 1 ? "" : "s"}`, baseline: "—", target: "Tracked weekly", ok: (m.acceptance_pct ?? 0) >= 90 },
    { key: "auto_returned_pct", label: "Vehicle returned to schedule after close", question: "Once the shop finishes, does the bus go back on the schedule by itself?", value: m.auto_returned_pct == null ? "—" : `${m.auto_returned_pct}%`, unit: "returned automatically", baseline: b.manual_steps_to_return == null ? "manual" : `${b.manual_steps_to_return} steps`, target: "Automatic", ok: m.auto_returned_pct === 100 },
  ] as const;
}

export function PilotMeasuresPanel({ open }: { open: boolean }) {
  const { data } = useData<PilotData>(open ? "/api/metrics/pilot?days=28" : null);
  if (!data) return <Loading />;
  const cards = measureCards(data.measures, data.baseline);
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
      {cards.map((c) => {
        const series = data.weeks.map((w) => w[c.key] as number | null);
        return (
          <div key={c.label} className="rounded-[12px] border border-rule p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[12.5px] font-semibold">{c.label}</span>
                <p className="mt-0.5 text-2xs leading-snug text-ink-faint">{c.question}</p>
              </div>
              <span className={`shrink-0 pill text-[10.5px] ${c.value === "—" ? "bg-[#EEF1F0] text-ink-soft" : c.ok ? "bg-go-tint text-go" : "bg-signal-tint text-signal-ink"}`}>{c.value === "—" ? "No data" : c.ok ? "On target" : "Not yet"}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xl font-semibold tnum">{c.value}</div>
                <div className="text-2xs text-ink-faint">{c.unit}</div>
              </div>
              <Sparkline values={series} tone="route" ariaLabel={`${c.label}, last ${series.length} weeks`} />
            </div>
            <div className="mt-2 flex justify-between border-t border-rule-soft pt-2 text-2xs"><span>Before (by hand) <b className="font-medium">{c.baseline}</b></span><span>Target <b className="font-medium">{c.target}</b></span></div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ product connections / model eval / persona matrix (admin)
interface SystemInfo {
  app: string; environment: string; llm_provider: string; adapter_mode: string; audit_mirror: string;
  adapters?: Record<string, { calls: number; errors: number; retries: number }>;
}
function ProductConnectionsPanel({ open }: { open: boolean }) {
  const { data, error } = useData<SystemInfo>(open ? "/api/metrics/system" : null);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const adapters = Object.entries(data.adapters ?? {});
  return (
    <div className="p-4">
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-2xs text-ink-soft">Adapter mode</dt><dd>{sentence(data.adapter_mode)}</dd></div>
        <div><dt className="text-2xs text-ink-soft">Event bus</dt><dd>{sentence(data.environment)}</dd></div>
      </dl>
      {adapters.length === 0 ? <Empty title="No adapter calls recorded yet this run" /> : (
        <table className="table">
          <thead><tr><Th>Product adapter</Th><Th right>Calls</Th><Th right>Errors</Th><Th right>Retries</Th></tr></thead>
          <tbody>{adapters.map(([name, s]) => (
            <tr key={name}><td className="font-mono text-xs">{name}</td><td className="text-right tnum">{s.calls}</td>
              <td className={`text-right tnum ${s.errors ? "text-stop font-semibold" : ""}`}>{s.errors}</td><td className="text-right tnum">{s.retries}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function ModelEvalPanel({ open }: { open: boolean }) {
  const { data } = useData<{ runs: { id: string; provider: string; status: string; score_pct: number | null; started_at: string }[] }>(open ? "/api/evals" : null);
  if (!data) return <Loading />;
  return data.runs.length === 0 ? <Empty title="No evaluation runs yet" /> : (
    <table className="table">
      <thead><tr><Th>When</Th><Th>Provider</Th><Th right>Score</Th><Th>Result</Th></tr></thead>
      <tbody>{data.runs.slice(0, 20).map((r) => (
        <tr key={r.id}><td className="text-xs">{ago(r.started_at)}</td><td>{r.provider}</td>
          <td className="text-right tnum">{r.score_pct === null ? "—" : `${r.score_pct}%`}</td><td><StatusBadge status={r.status} /></td></tr>
      ))}</tbody>
    </table>
  );
}

function PersonaMatrixPanel({ open }: { open: boolean }) {
  interface Pol { rules: { persona_permissions: Record<string, string[]> }; meta: { personas: string[]; persona_permission_options: string[] } }
  const { data } = useData<Pol>(open ? "/api/policies/vehicle_health" : null);
  if (!data) return <Loading />;
  return (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><Th>Product action</Th>{data.meta.personas.map((r) => <Th key={r}>{roleName[r] ?? r}</Th>)}</tr></thead>
      <tbody>{data.meta.persona_permission_options.map((perm) => (
        <tr key={perm}><td className="font-mono text-xs">{perm}</td>
          {data.meta.personas.map((r) => {
            const list = data.rules.persona_permissions?.[r] ?? [];
            const can = list.includes("*") || list.includes(perm);
            return <td key={r} className="text-center">{can ? <span className="text-go">✓</span> : <span className="text-ink-faint">—</span>}</td>;
          })}</tr>
      ))}</tbody>
    </table></div>
  );
}

// ------------------------------------------------------------------ analyst: otp-path / late-by-route / coaching / ask
interface PerfSummary {
  otp_30d: number; late_pickups_30d: number; no_show_rate_30d: number; no_shows_30d: number;
  by_route: { key: string; otp: number; runs: number }[]; coaching_candidates: { driver_name: string; tenure_band: string; otp: number; runs: number }[];
  slm_provider: string; suggested_questions: string[];
}
interface Plan { current_otp: number; target_otp: number; reached: boolean; plan: { key: string; name: string; uplift_pp: number; cumulative_otp?: number }[]; projected_otp: number; max_with_all_levers: number }

function OtpPathPanel({ open }: { open: boolean }) {
  const { data } = useData<Plan>(open ? "/api/performance/plan?target=95" : null);
  if (!data) return <Loading />;
  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-ink-soft">From {pct(data.current_otp)} toward {pct(data.target_otp)}{data.reached ? `, projected ${pct(data.projected_otp)}` : ` — not reachable; best is ${pct(data.max_with_all_levers)}`}.</p>
      <ol className="space-y-2">{data.plan.map((l, i) => (
        <li key={l.key} className="rounded-[10px] border border-rule-soft p-3">
          <div className="flex items-center justify-between text-sm"><span><b className="mr-1.5 font-mono text-xs text-ink-faint">{i + 1}</b>{l.name}</span>
            <span className="font-semibold text-go tnum">+{l.uplift_pp.toFixed(1)} pts</span></div>
          <div className="mt-1.5"><HBar pct={((l.cumulative_otp ?? data.current_otp) - data.current_otp) / Math.max(0.1, data.target_otp - data.current_otp) * 100} tone="go" /></div>
        </li>
      ))}</ol>
    </div>
  );
}

function LateByRoutePanel({ open }: { open: boolean }) {
  const { data } = useData<PerfSummary>(open ? "/api/performance/summary" : null);
  if (!data) return <Loading />;
  const rows = [...data.by_route].sort((a, b) => a.otp - b.otp);
  return (
    <table className="table">
      <thead><tr><Th>Route</Th><Th right>OTP</Th><Th right>Runs</Th></tr></thead>
      <tbody>{rows.map((g) => (
        <tr key={g.key}><td className="font-medium">{g.key}</td>
          <td className={`text-right tnum font-semibold ${g.otp < 85 ? "text-stop" : g.otp < 90 ? "text-signal-ink" : "text-go"}`}>{pct(g.otp)}</td>
          <td className="text-right tnum">{g.runs}</td></tr>
      ))}</tbody>
    </table>
  );
}

function CoachingPanel({ open }: { open: boolean }) {
  const { data } = useData<PerfSummary>(open ? "/api/performance/summary" : null);
  if (!data) return <Loading />;
  return data.coaching_candidates.length === 0 ? <Empty title="No coaching candidates right now" /> : (
    <table className="table">
      <thead><tr><Th>Operator</Th><Th>Experience</Th><Th right>Runs</Th><Th right>OTP</Th></tr></thead>
      <tbody>{data.coaching_candidates.map((d) => (
        <tr key={d.driver_name}><td>{d.driver_name}</td><td>{sentence(d.tenure_band)}</td><td className="text-right tnum">{d.runs}</td>
          <td className="text-right tnum font-semibold text-signal-ink">{pct(d.otp)}</td></tr>
      ))}</tbody>
    </table>
  );
}

function AskQuestionPanel({ open }: { open: boolean }) {
  const { data } = useData<PerfSummary>(open ? "/api/performance/summary" : null);
  if (!data) return <Loading />;
  return <div className="h-[70vh]"><PerformanceChat provider={data.slm_provider} suggestions={data.suggested_questions} /></div>;
}

// ------------------------------------------------------------------ registry
export interface PanelDef { key: string; title: string; description: string; icon: LucideIcon; Content: (p: { open: boolean }) => React.ReactNode }

export const PANELS: Record<string, PanelDef> = {
  "escalations": { key: "escalations", title: "Manual actions needed", description: "Decisions the agent could not make on its own and raised with a person.", icon: AlertTriangle, Content: EscalationsPanel },
  "in-motion": { key: "in-motion", title: "Orchestrations in motion", description: "Vehicle-health orchestrations currently running, awaiting approval, or in the shop.", icon: GitBranch, Content: InMotionPanel },
  "orchestration-outcomes": { key: "orchestration-outcomes", title: "Orchestration outcomes", description: "Every orchestration, by type and by where it stands.", icon: GitBranch, Content: OrchestrationOutcomesPanel },
  "out-of-service": { key: "out-of-service", title: "Vehicles out of service", description: "Every vehicle currently off the schedule, and why.", icon: Wrench, Content: OutOfServicePanel },
  "pm-due": { key: "pm-due", title: "Preventive maintenance due", description: "Vehicles overdue for scheduled maintenance, most overdue first.", icon: Gauge, Content: PmDuePanel },
  "spares-drivers": { key: "spares-drivers", title: "Spares and drivers available", description: "Vehicles free to cover a run, and drivers currently not compliant.", icon: Users, Content: SparesDriversPanel },
  "driver-compliance": { key: "driver-compliance", title: "Driver compliance", description: "Drivers the agent will not propose right now, and why.", icon: BadgeCheck, Content: DriverCompliancePanel },
  "defects": { key: "defects", title: "Safety defects", description: "Open vehicle defects recorded in Vestige.", icon: ShieldAlert, Content: DefectsPanel },
  "work-orders": { key: "work-orders", title: "Open work orders", description: "Every work order waiting for or under way in the shop.", icon: Wrench, Content: WorkOrdersPanel },
  "shop-bays-by-depot": { key: "shop-bays-by-depot", title: "Shop bays by depot", description: "Booked bays against capacity, next 4 days, by depot.", icon: Building2, Content: ShopBaysPanel },
  "todays-runs": { key: "todays-runs", title: "Today's runs and trips", description: "Every run today, worst delays first.", icon: CalendarClock, Content: TodaysRunsPanel },
  "no-show-recovery": { key: "no-show-recovery", title: "No-show recovery", description: "What the agent has recovered from no-shows and late cancellations.", icon: UserX, Content: NoShowRecoveryPanel },
  "rider-messages": { key: "rider-messages", title: "Rider messages, 24h", description: "Every message sent to a rider in the last day.", icon: MessageSquare, Content: RiderMessagesPanel },
  "shop-approvals": { key: "shop-approvals", title: "Work orders to approve", description: "Open-work-order decisions waiting on your approval.", icon: UserCheck, Content: ShopApprovalsPanel },
  "shadow-comparisons": { key: "shadow-comparisons", title: "Shadow mode summary", description: "Agreement between the agent and people, by step.", icon: Eye, Content: ShadowPanel },
  "audit-recent": { key: "audit-recent", title: "Audit log", description: "The most recent recorded decisions and actions.", icon: ClipboardList, Content: AuditPanel },
  "pilot-measures": { key: "pilot-measures", title: "Pilot measures", description: "All six success measures against the Phase 0 baseline, 28 days.", icon: Target, Content: PilotMeasuresPanel },
  "product-connections": { key: "product-connections", title: "Product connections", description: "Calls, errors and retries to each connected product this run.", icon: Plug, Content: ProductConnectionsPanel },
  "model-eval": { key: "model-eval", title: "Model evaluation", description: "Recent evaluation runs and their scores.", icon: Cpu, Content: ModelEvalPanel },
  "persona-matrix": { key: "persona-matrix", title: "Who may do what", description: "Each persona's permissions in the connected products, read-only here.", icon: KeyRound, Content: PersonaMatrixPanel },
  "otp-path": { key: "otp-path", title: "Path to 95%", description: "The ranked levers the model found to reach a 95% target.", icon: Target, Content: OtpPathPanel },
  "late-by-route": { key: "late-by-route", title: "Late pickups by route", description: "On-time performance by route, worst first.", icon: MapPin, Content: LateByRoutePanel },
  "coaching": { key: "coaching", title: "Operators to coach first", description: "Lowest on-time performance among operators with enough runs to judge.", icon: Users, Content: CoachingPanel },
  "ask-question": { key: "ask-question", title: "Ask a question", description: "Ask about on-time performance; answers cite your agency's own history.", icon: Sparkles, Content: AskQuestionPanel },
};

/** The one side panel a dashboard ever has open, driven entirely by `?panel=` — a role dashboard just needs to
 *  render this once and call `setPanel(key)` from its tiles and launcher cards. */
export function usePanel() {
  return usePanelParam();
}

export function PanelHost({ role, panelKey, onClose }: { role: Role | undefined; panelKey: string | null; onClose: () => void }) {
  const def = panelKey ? PANELS[panelKey] : null;
  const tag = def ? panelModuleTag(def.key, role) : null;
  return (
    <SidePanel open={!!def} onClose={onClose} title={def?.title ?? ""} description={def?.description}
      footer={def ? <FullPageLink to={panelFullPageLink(def.key, role)} label={`Open ${tag?.label ?? "the full page"}`} /> : undefined}>
      {def && <def.Content open={!!def} />}
    </SidePanel>
  );
}
