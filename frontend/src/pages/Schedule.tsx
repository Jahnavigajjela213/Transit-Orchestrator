import { useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility } from "lucide-react";
import { useData } from "../lib/live";
import { time } from "../lib/format";
import { ErrorNote, Loading, PageHeader, StatusBadge, Tag, VehicleId, Empty } from "../components/ui";

interface Sched {
  service_date: string;
  runs: { run_id: string; route_name: string; block_name: string; start: string; end: string; status: string; vehicle_label: string | null;
    driver_name: string | null; original_vehicle_label: string | null; original_driver_name: string | null; reassigned: boolean;
    workflow_id: string | null; riders: number; wheelchair_riders: number; delay_minutes: number; standby_riders: number }[];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Schedule() {
  const today = new Date();
  const days = [-1, 0, 1, 2].map((o) => { const d = new Date(today); d.setDate(d.getDate() + o); return d; });
  const [day, setDay] = useState(iso(today));
  const [changed, setChanged] = useState(false);
  const { data, error } = useData<Sched>(`/api/schedule?service_date=${day}${changed ? "&only_changed=true" : ""}`, [day, changed]);

  return (
    <div>
      <PageHeader title="Schedule" intro="Runs from trip management, with driver names resolved from workforce. Runs the agent moved to a spare are marked." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {days.map((d) => (
          <button key={iso(d)} onClick={() => setDay(iso(d))}
            className={`rounded-sm border px-3 py-1.5 text-sm ${day === iso(d) ? "border-route bg-route text-white" : "border-rule bg-white hover:border-route"}`}>
            {d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
          </button>
        ))}
        <label className="ml-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} className="accent-route" /> Only reassigned runs
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.runs.length === 0 ? <div className="panel"><Empty title="No runs match" /></div> : (
        <div className="panel overflow-x-auto">
          <table className="table">
            <thead><tr><th>Run</th><th>Time</th><th>Vehicle</th><th>Driver</th><th>Riders</th><th>Status</th></tr></thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.run_id} className={r.reassigned ? "bg-route-tint/40" : ""}>
                  <td><div className="font-medium">{r.route_name}</div><div className="text-2xs text-ink-soft">{r.block_name}</div></td>
                  <td className="tnum whitespace-nowrap">{time(r.start)} to {time(r.end)}{r.delay_minutes > 0 && r.status !== "completed" && <div><Tag color={r.delay_minutes > 10 ? "red" : "amber"}>{r.delay_minutes} min late</Tag></div>}</td>
                  <td>
                    <VehicleId label={r.vehicle_label} />
                    {r.reassigned && (
                      <div className="mt-0.5 text-2xs text-ink-soft">
                        was <span className="line-through">{r.original_vehicle_label}</span>
                        {r.workflow_id && <> by <Link to={`/workflows/${r.workflow_id}`} className="text-route hover:underline">orchestration</Link></>}
                      </div>
                    )}
                  </td>
                  <td>{r.driver_name}{r.original_driver_name && <div className="text-2xs text-ink-soft">was <span className="line-through">{r.original_driver_name}</span></div>}</td>
                  <td className="tnum">{r.riders}{r.standby_riders > 0 && <Tag color="teal">+{r.standby_riders} standby</Tag>}{r.wheelchair_riders > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-route"><Accessibility className="h-3.5 w-3.5" aria-label="wheelchair riders" />{r.wheelchair_riders}</span>}</td>
                  <td>{r.reassigned ? <Tag color="teal">Reassigned</Tag> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
