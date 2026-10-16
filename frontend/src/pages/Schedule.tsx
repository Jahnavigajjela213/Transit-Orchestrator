import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { useToast } from "../components/Toast";
import { easternNow, time } from "../lib/format";
import { ErrorNote, Loading, PageHeader, StatusBadge, Tag, VehicleId, Empty } from "../components/ui";

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

export default function Schedule({ embedded = false }: { embedded?: boolean }) {
  const today = easternNow();
  const days = [-1, 0, 1, 2].map((o) => { const d = new Date(today); d.setDate(d.getDate() + o); return d; });
  const [day, setDay] = useState(iso(today));
  const [changed, setChanged] = useState(false);
  const { user } = useAuth();
  const canAssign = user?.role === "dispatcher" || user?.role === "admin";
  const [editing, setEditing] = useState<string | null>(null);
  const { data, error, reload } = useData<Sched>(`/api/schedule?service_date=${day}${changed ? "&only_changed=true" : ""}`, [day, changed]);

  return (
    <div className="fit-page">
      {!embedded && <PageHeader title="Schedule" intro="Runs from trip management, with driver names resolved from workforce. Runs the agent moved to a spare are marked." />}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="seg" role="tablist" aria-label="Service day">
          {days.map((d) => (
            <button key={iso(d)} role="tab" aria-selected={day === iso(d)} onClick={() => setDay(iso(d))}>
              {d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
            </button>
          ))}
        </div>
        {data && <span className="text-xs text-ink-soft tnum">{data.runs.length} runs</span>}
        <label className="ml-auto inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} className="accent-route" /> Only reassigned runs
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.runs.length === 0 ? <div className="panel"><Empty title="No runs match" /></div> : (
        <div className="panel fit-scroll">
          <table className="table">
            <thead><tr><th>Run</th><th>Time</th><th>Vehicle</th><th>Driver</th><th>Riders</th><th>Status</th>{canAssign && <th></th>}</tr></thead>
            <tbody>
              {data.runs.map((r) => (
                <Fragment key={r.run_id}>
                <tr className={r.reassigned ? "bg-route-tint/40" : ""}>
                  <td><div className="font-medium">{r.route_name}</div><div className="text-2xs text-ink-soft">{r.block_name}</div></td>
                  <td className="tnum whitespace-nowrap">{time(r.start)} to {time(r.end)}{r.delay_minutes > 0 && r.status !== "completed" && <div><Tag color={r.delay_minutes > 10 ? "red" : "amber"}>{r.delay_minutes} min late</Tag></div>}</td>
                  <td>
                    <VehicleId label={r.vehicle_label} />
                    {r.reassigned && (
                      <div className="mt-0.5 text-2xs text-ink-soft">
                        was <span className="line-through">{r.original_vehicle_label}</span>
                        {r.workflow_id && <> by <Link to={`/workflows/${r.workflow_id}`} className="text-route hover:underline">incident</Link></>}
                      </div>
                    )}
                  </td>
                  <td>{r.driver_name}{r.original_driver_name && <div className="text-2xs text-ink-soft">was <span className="line-through">{r.original_driver_name}</span></div>}</td>
                  <td className="tnum">{r.riders}{r.standby_riders > 0 && <Tag color="teal">+{r.standby_riders} standby</Tag>}{r.wheelchair_riders > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-route"><Accessibility className="h-3.5 w-3.5" aria-label="wheelchair riders" />{r.wheelchair_riders}</span>}</td>
                  <td>{r.reassigned ? <Tag color="teal">Reassigned</Tag> : <StatusBadge status={r.status} />}</td>
                  {canAssign && <td>{r.status !== "completed" && <button className="btn-quiet px-2 py-0.5 text-2xs" onClick={() => setEditing(editing === r.run_id ? null : r.run_id)}>{editing === r.run_id ? "Close" : "Reassign"}</button>}</td>}
                </tr>
                {editing === r.run_id && <tr><td colSpan={7} className="bg-paper/50"><ReassignForm run={r} onDone={() => { setEditing(null); reload(); }} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
