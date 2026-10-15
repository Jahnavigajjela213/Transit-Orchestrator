import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import type { FleetRow } from "../lib/types";
import { useToast } from "./Toast";
import { SeverityTag } from "./ui";

interface FC { code: string; description: string; system: string; severity: string; est_repair_hours: number }
const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** The demo shows a few clear faults first; the rest stay one click away. */
const FEATURED = 4;

/** Raise a vehicle fault: sends a diagnostic trouble code from telematics, the way a real bus would, then opens the orchestration it starts. */
export default function FaultForm() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: vehicleList, error: vehicleError } = useData<{ source: string; table: string | null; vehicles: FleetRow[] }>("/api/simulator/vehicles");
  const { data: codes } = useData<FC[]>("/products/asset-mgmt/fault-codes");
  const [vehicle, setVehicle] = useState("");
  const [code, setCode] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  // vehicles on the schedule only: a spare with no runs has nothing for the agent to cover
  const usable = (vehicleList?.vehicles || []).filter((v) => !v.active_workflow && v.schedule_status === "available" && v.runs_today > 0)
    .sort((a, b) => b.runs_today - a.runs_today || a.label.localeCompare(b.label));
  const sorted = (codes || []).filter((c) => c.code !== "PM-DUE").sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.code.localeCompare(b.code));
  const shown = all ? sorted : sorted.slice(0, FEATURED);
  const chosen = usable.find((v) => v.label === vehicle);
  useEffect(() => { if (!vehicle && usable.length) setVehicle(usable[0].label); }, [usable, vehicle]);
  useEffect(() => { if (!code && sorted.length) setCode(sorted[0].code); }, [sorted, code]);

  const canAct = user?.role !== "viewer";

  async function send() {
    setBusy(true);
    try {
      await api.post("/api/simulator/fault", { vehicle_label: vehicle, fault_code: code });
      toast(`${vehicle} reported ${code}. The agent's decision for you is on Needs your attention.`);
      nav("/");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel">
        <div className="border-b border-rule px-5 py-3.5">
          <h2 className="text-sm font-semibold">Fault code</h2>
          <p className="mt-0.5 text-xs text-ink-soft">A diagnostic trouble code as the bus's telematics unit would send it.</p>
        </div>
        <fieldset className="space-y-2 p-5">
          <legend className="sr-only">Fault</legend>
          {shown.map((c) => (
            <label key={c.code} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${code === c.code ? "border-route bg-route-tint/50 ring-1 ring-route" : "border-rule bg-white hover:border-ink-faint"}`}>
              <input type="radio" name="code" className="accent-route" checked={code === c.code} onChange={() => setCode(c.code)} />
              <span className="w-16 shrink-0 font-mono text-xs font-medium text-ink-soft">{c.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.description}</span>
                <span className="block text-xs text-ink-soft">{c.system} · about {c.est_repair_hours} h in the shop</span>
              </span>
              <SeverityTag severity={c.severity} />
            </label>
          ))}
          {sorted.length > FEATURED && (
            <button className="pt-1 text-xs font-medium text-route hover:underline" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${sorted.length} fault codes`}
            </button>
          )}
        </fieldset>
      </section>

      <aside className="panel">
        <div className="border-b border-rule px-5 py-3.5">
          <h2 className="text-sm font-semibold">Vehicle</h2>
          <p className="mt-0.5 text-xs text-ink-soft">In service, with runs on the schedule.</p>
        </div>
        <div className="space-y-4 p-5">
          <label className="block"><span className="label">Vehicle</span>
            <select className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)} disabled={!vehicleList}>
              {!vehicleList && <option value="">Loading vehicles…</option>}
              {usable.map((v) => <option key={v.label} value={v.label}>{v.label} · {v.vehicle_type}</option>)}
            </select>
            {vehicleList && <span className="mt-1.5 block text-2xs text-ink-faint">
              {vehicleList.source === "databricks" ? <>From Databricks <code className="font-mono">{vehicleList.table}</code></> : "From the operational database"}
            </span>}
            {vehicleError && <span className="mt-1 block text-xs text-stop">{vehicleError}</span>}
          </label>
          {chosen && (
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-paper px-4 py-3 text-xs">
              <div><dt className="text-ink-faint">Type</dt><dd className="font-medium">{chosen.vehicle_type}</dd></div>
              <div><dt className="text-ink-faint">Depot</dt><dd className="font-medium">{chosen.depot}</dd></div>
              <div><dt className="text-ink-faint">Seats</dt><dd className="font-medium tnum">{chosen.capacity}</dd></div>
              <div><dt className="text-ink-faint">Runs today</dt><dd className="font-medium tnum">{chosen.runs_today}</dd></div>
            </dl>
          )}
          {!canAct && <p className="text-xs text-ink-soft">Analysts can watch but not raise faults.</p>}
          <button className="btn-primary w-full justify-center py-2.5" disabled={busy || !canAct || !vehicle || !code} onClick={send}>
            <Zap className="h-4 w-4" aria-hidden /> {busy ? "Sending…" : "Raise fault"}
          </button>
          <p className="flex items-start gap-2 text-2xs leading-relaxed text-ink-faint">
            <Radio className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            The agent picks the event up from the event backbone, assesses it and starts the orchestration. You'll be taken to Needs your attention to decide.
          </p>
        </div>
      </aside>
    </div>
  );
}
