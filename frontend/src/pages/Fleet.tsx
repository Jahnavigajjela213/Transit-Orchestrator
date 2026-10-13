import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { useToast } from "../components/Toast";
import { dayTime, sentence } from "../lib/format";
import type { FleetRow } from "../lib/types";
import { ErrorNote, Loading, PageHeader, StatusBadge, Tag, VehicleId } from "../components/ui";

export default function Fleet() {
  const { data, error } = useData<FleetRow[]>("/api/fleet");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => (data || []).filter((v) => !q || `${v.label} ${v.vehicle_type} ${v.depot}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const unavailable = (data || []).filter((v) => v.schedule_status !== "available").length;

  return (
    <div>
      <PageHeader title="Fleet" intro="One row per vehicle, joined across asset management, trip management and telematics through the shared identity crosswalk."
        actions={<input className="input w-56" placeholder="Filter by vehicle, type or depot" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter fleet" />} />
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : (
        <>
          <p className="mb-3 text-sm text-ink-soft"><span className="tnum">{data.length}</span> vehicles, <span className="tnum">{unavailable}</span> unavailable now.</p>
          <div className="panel overflow-x-auto">
            <table className="table">
              <thead><tr><th>Vehicle</th><th>Type</th><th>Depot</th><th>Schedule</th><th>Runs today</th><th>Maintenance</th><th>Telemetry</th><th>Orchestration</th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <Fragment key={v.vehicle_id}>
                    <tr className="cursor-pointer hover:bg-paper/60" onClick={() => setOpen(open === v.vehicle_id ? null : v.vehicle_id)}>
                      <td><VehicleId label={v.label} /></td>
                      <td>{v.vehicle_type}<div className="text-2xs text-ink-soft">{v.capacity} seats, {v.wheelchair_positions} wheelchair</div></td>
                      <td>{v.depot}</td>
                      <td><StatusBadge status={v.schedule_status} />{v.unavailable_until && <div className="mt-0.5 text-2xs text-ink-soft">until {dayTime(v.unavailable_until)}</div>}</td>
                      <td className="tnum">{v.runs_today}</td>
                      <td>
                        {v.open_work_orders.map((w) => <div key={w.id} className="text-xs"><Tag color="amber">{w.id}</Tag> {w.title}</div>)}
                        {(v.open_defects || []).map((d) => <div key={d.id} className="text-xs"><Tag color="red">{d.id}</Tag> Vestige defect: {d.category}{d.out_of_service ? ", out of service" : ""}</div>)}
                        {v.pm_miles_over >= 0 ? <Tag color="red">PM {v.pm_miles_over.toLocaleString()} mi overdue</Tag> : v.open_work_orders.length === 0 && <span className="text-xs text-ink-faint">PM in {(-v.pm_miles_over).toLocaleString()} mi</span>}
                      </td>
                      <td className="text-xs tnum">
                        {v.telemetry ? <>{v.telemetry.engine_temp_c}°C, {v.telemetry.oil_pressure_kpa} kPa{v.telemetry.dtc_codes.length > 0 && <div><Tag color="red">{v.telemetry.dtc_codes.join(", ")}</Tag></div>}</> : "—"}
                      </td>
                      <td>{v.active_workflow ? <Link onClick={(e) => e.stopPropagation()} to={`/workflows/${v.active_workflow.id}`} className="text-xs text-route hover:underline">{sentence(v.active_workflow.current_step)}</Link> : <span className="text-xs text-ink-faint">None</span>}</td>
                    </tr>
                    {open === v.vehicle_id && (
                      <tr className="bg-paper/50">
                        <td colSpan={8}>
                          <div className="grid gap-2 py-1 text-xs sm:grid-cols-5">
                            <div><span className="text-ink-soft">Canonical ID</span><div className="font-medium">{v.vehicle_id}</div></div>
                            <div><span className="text-ink-soft">Asset management (FASTER)</span><div className="font-medium">{v.ids.asset_mgmt}</div></div>
                            <div><span className="text-ink-soft">Trip management</span><div className="font-medium">{v.ids.trip_mgmt}</div></div>
                            <div><span className="text-ink-soft">Telematics device</span><div className="font-medium">{v.ids.telematics}</div></div>
                            <div><span className="text-ink-soft">Safety & compliance (Vestige)</span><div className="font-medium">{v.ids.safety ?? "—"}</div></div>
                            <div className="sm:col-span-2"><span className="text-ink-soft">Asset</span><div>{v.make_model}, {v.odometer?.toLocaleString()} mi, {sentence(v.asset_status)}</div></div>
                            {v.unavailable_reason && <div className="sm:col-span-2"><span className="text-ink-soft">Unavailable because</span><div>{v.unavailable_reason}</div></div>}
                          </div>
                          <ManualActions v={v} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


// The backend works in naive local time (see backend/app/core/clock.py).
const localIso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 19);

/** What a dispatcher or shop manager does by hand today, directly in the products. Used to compare with the agent in shadow mode. */
function ManualActions({ v }: { v: FleetRow }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canWo = user?.role === "dispatcher" || user?.role === "shop_manager" || user?.role === "admin";
  const canPull = user?.role === "dispatcher" || user?.role === "admin";
  if (!canWo && !canPull) return null;
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast(done); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-rule pt-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <span className="text-ink-soft">Do it by hand in the product (as today, without the agent):</span>
      {canWo && v.ids.asset_mgmt && <button className="btn-quiet px-2 py-1 text-xs" disabled={busy} onClick={() => run(
        () => api.post("/products/asset-mgmt/work-orders", { asset_number: v.ids.asset_mgmt, priority: "critical", title: `Fault reported on ${v.label} (opened by hand)` }),
        `Work order opened by hand for ${v.label}`)}>Open work order in FASTER</button>}
      {canPull && v.ids.trip_mgmt && v.schedule_status === "available" && <button className="btn-quiet px-2 py-1 text-xs" disabled={busy} onClick={() => run(
        () => api.post(`/products/trip-mgmt/vehicles/${v.ids.trip_mgmt}/block`, { end: localIso(Date.now() + 8 * 3600e3), reason: "Pulled by dispatcher" }),
        `${v.label} pulled from the schedule by hand for 8 hours`)}>Pull from schedule (8 h)</button>}
    </div>
  );
}
