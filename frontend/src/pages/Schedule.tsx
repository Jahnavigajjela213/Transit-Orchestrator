import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { useToast } from "../components/Toast";
import { easternNow, time } from "../lib/format";
import { ErrorNote, Loading, PageHeader, VehicleId, Empty } from "../components/ui";
import { Pager, usePaged } from "../components/Pager";

interface Sched {
  service_date: string;
  runs: { run_id: string; route_name: string; block_name: string; start: string; end: string; status: string; vehicle_label: string | null;
    driver_name: string | null; original_vehicle_label: string | null; original_driver_name: string | null; reassigned: boolean;
    workflow_id: string | null; riders: number; wheelchair_riders: number; delay_minutes: number; standby_riders: number }[];
}

interface TmVehicle { vehicle_code: string; label: string; vehicle_type: string; wheelchair_positions: number; status: string }
interface TmDriver { driver_code: string; name: string }

/** Reassign a run by hand in trip management, the way a dispatcher does it today. */
function ReassignForm({ run, onDone }: { run: Sched["runs"][number]; onDone: () => void }) {
  const toast = useToast();
  const { data: vehicles } = useData<TmVehicle[]>("/products/trip-mgmt/vehicles");
  const { data: drivers } = useData<TmDriver[]>("/products/trip-mgmt/drivers");
  const [v, setV] = useState("");
  const [d, setD] = useState("");
  const [busy, setBusy] = useState(false);
  if (!vehicles || !drivers) return <div className="p-3"><Loading /></div>;
  const vSel = v || vehicles.find((x) => x.label === run.vehicle_label)?.vehicle_code || "";
  const dSel = d || drivers.find((x) => x.name === run.driver_name)?.driver_code || "";
  return (
    <div className="flex flex-wrap items-end gap-2 p-3 text-sm">
      <label><span className="label">Vehicle</span>
        <select className="input w-56" value={vSel} onChange={(e) => setV(e.target.value)}>
          {vehicles.map((x) => <option key={x.vehicle_code} value={x.vehicle_code}>{x.label}, {x.vehicle_type}{x.wheelchair_positions ? " ♿" : ""}{x.status !== "available" ? " (out of service)" : ""}</option>)}
        </select></label>
      <label><span className="label">Driver</span>
        <select className="input w-56" value={dSel} onChange={(e) => setD(e.target.value)}>
          {drivers.map((x) => <option key={x.driver_code} value={x.driver_code}>{x.name}</option>)}
        </select></label>
      <button className="btn-primary" disabled={busy || !vSel || !dSel} onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/products/trip-mgmt/runs/${run.run_id}/assign`, { vehicle_code: vSel, driver_code: dSel });
          toast(`${run.route_name} ${run.block_name} reassigned by hand`);
          onDone();
        } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
      }}>Reassign by hand</button>
      {run.wheelchair_riders > 0 && <span className="text-2xs text-ink-soft">This run has {run.wheelchair_riders} wheelchair rider(s): pick a ♿ vehicle.</span>}
    </div>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const STATUS: Record<string, [string, string]> = {
  reassigned: ["Reassigned", "bg-route-tint text-route-dark"], completed: ["Completed", "bg-go-tint text-go"],
  in_progress: ["In progress", "bg-shop-tint text-shop"], scheduled: ["Scheduled", "bg-[#EEF1F0] text-ink-soft"],
};
const COLS = "grid min-w-[900px] grid-cols-[minmax(0,1.3fr)_215px_90px_minmax(0,1fr)_80px_120px_90px] items-center gap-3";

export default function Schedule({ embedded = false }: { embedded?: boolean }) {
  const today = easternNow();
  const days = [-1, 0, 1, 2].map((o) => { const d = new Date(today); d.setDate(d.getDate() + o); return d; });
  const [day, setDay] = useState(iso(today));
  const [changed, setChanged] = useState(false);
  const { user } = useAuth();
  const canAssign = user?.role === "dispatcher" || user?.role === "admin";
  const [editing, setEditing] = useState<string | null>(null);
  const { data, error, reload } = useData<Sched>(`/api/schedule?service_date=${day}${changed ? "&only_changed=true" : ""}`, [day, changed]);
  const pg = usePaged(data?.runs, [day, changed]);

  return (
    <div className="flex flex-col gap-3.5">
      {!embedded && <PageHeader title="Schedule" intro="Runs from trip management, with driver names resolved from workforce. Runs the agent moved to a spare are marked." />}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Service day" className="flex gap-0.5 rounded-[10px] border border-rule bg-white p-[3px]">
          {days.map((d) => (
            <button key={iso(d)} role="tab" aria-selected={day === iso(d)} onClick={() => setDay(iso(d))}
              className={`h-[30px] rounded-[7px] px-3 text-xs ${day === iso(d) ? "bg-ink font-semibold text-white" : "text-ink-soft"}`}>
              {d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
            </button>
          ))}
        </div>
        {data && <span className="text-xs text-ink-soft tnum">{data.runs.length} runs</span>}
        <label className="ml-auto inline-flex items-center gap-2 text-[13px] text-ink-soft">
          <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} className="accent-route" /> Only reassigned runs
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <div className="card"><Loading /></div> : data.runs.length === 0 ? <div className="card"><Empty title="No runs match" /></div> : (
        <>
        <section className={`card overflow-x-auto ${pg.big ? "max-h-[min(640px,calc(100vh-300px))] overflow-y-auto" : ""}`}>
          <div className={`${COLS} eyebrow sticky top-0 z-10 border-b border-rule bg-panel px-[18px] py-3`}>
            <span>Run</span><span>Time</span><span>Vehicle</span><span>Driver</span><span>Riders</span><span>Status</span><span />
          </div>
          {pg.rows.map((r) => {
            const [label, cls] = STATUS[r.reassigned ? "reassigned" : r.status] ?? [r.status, STATUS.scheduled[1]];
            return (
              <Fragment key={r.run_id}>
                <div className={`${COLS} border-b border-rule-soft px-[18px] py-3`}>
                  <span className="min-w-0 truncate"><b className="font-semibold">{r.route_name}</b> <span className="text-xs text-ink-faint">{r.block_name}</span></span>
                  <span className="whitespace-nowrap tnum">{time(r.start)} → {time(r.end)}{r.delay_minutes > 0 && r.status !== "completed" && <span className={`ml-1.5 text-[11px] font-semibold ${r.delay_minutes > 10 ? "text-stop" : "text-signal-ink"}`}>+{r.delay_minutes}m</span>}</span>
                  <span title={r.reassigned && r.original_vehicle_label ? `was ${r.original_vehicle_label}` : undefined}><VehicleId label={r.vehicle_label} /></span>
                  <span className="min-w-0 truncate" title={r.original_driver_name ? `was ${r.original_driver_name}` : undefined}>{r.driver_name}</span>
                  <span className="inline-flex items-center gap-1 tnum">{r.riders}
                    {r.wheelchair_riders > 0 && <span className="inline-flex items-center text-route"><Accessibility className="h-3.5 w-3.5" aria-label="wheelchair riders" />{r.wheelchair_riders}</span>}
                    {r.standby_riders > 0 && <span className="text-[11px] text-route">+{r.standby_riders}</span>}</span>
                  <span>
                    {r.reassigned && r.workflow_id ? <Link to={`/workflows/${r.workflow_id}`} className={`pill no-underline ${cls}`}>{label}</Link> : <span className={`pill ${cls}`}>{label}</span>}
                  </span>
                  <span className="text-right">
                    {canAssign && r.status !== "completed" && (
                      <button className="h-7 rounded-[10px] border border-rule bg-white px-2.5 text-[11.5px] text-ink-soft" onClick={() => setEditing(editing === r.run_id ? null : r.run_id)}>
                        {editing === r.run_id ? "Close" : "Reassign"}
                      </button>
                    )}
                  </span>
                </div>
                {editing === r.run_id && <div className="border-b border-rule-soft bg-panel"><ReassignForm run={r} onDone={() => { setEditing(null); reload(); }} /></div>}
              </Fragment>
            );
          })}
        </section>
        <Pager {...pg} />
        </>
      )}
    </div>
  );
}
