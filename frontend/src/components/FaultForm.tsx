import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import type { FleetRow } from "../lib/types";
import { useToast } from "./Toast";

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
      nav("/attention");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  const SEV: Record<string, string> = { critical: "bg-stop-tint text-stop", high: "bg-signal-tint text-signal-ink", medium: "bg-route-tint text-route-dark", low: "bg-[#EEF1F0] text-ink-soft" };

  return (
    <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="card p-[18px]">
        <h2 className="mb-1 text-sm font-semibold">Fault code</h2>
        <p className="mb-3.5 text-[12.5px] text-ink-soft">As the bus’s telematics unit would send it.</p>
        <div role="radiogroup" aria-label="Fault code" className="flex flex-col gap-2">
          {shown.map((c) => (
            <button key={c.code} type="button" role="radio" aria-checked={code === c.code} onClick={() => setCode(c.code)}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left ${code === c.code ? "border-2 border-route bg-[#F1F7F6]" : "border border-rule bg-white hover:border-ink-faint"}`}>
              <span className="w-16 shrink-0 font-mono text-xs text-ink-soft">{c.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{c.description}</span>
                <span className="block text-xs text-ink-soft">{c.system} · about {c.est_repair_hours} h in the shop</span>
              </span>
              <span className={`pill text-[11px] ${SEV[c.severity] ?? SEV.low}`}>{c.severity[0].toUpperCase() + c.severity.slice(1)}</span>
            </button>
          ))}
        </div>
        {sorted.length > FEATURED && (
          <button className="mt-3 text-xs font-medium text-route hover:underline" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${sorted.length} fault codes`}
          </button>
        )}
      </section>

      <aside className="card flex flex-col gap-3.5 p-[18px]">
        <label className="flex flex-col gap-1.5 text-[12.5px] text-ink-soft">Vehicle in service
          <select className="h-[42px] rounded-[10px] border border-rule bg-white px-2.5 text-sm text-ink" value={vehicle} onChange={(e) => setVehicle(e.target.value)} disabled={!vehicleList}>
            {!vehicleList && <option value="">Loading vehicles…</option>}
            {usable.map((v) => <option key={v.label} value={v.label}>{v.label} · {v.vehicle_type}</option>)}
          </select>
          {vehicleError && <span className="text-xs text-stop">{vehicleError}</span>}
        </label>
        {chosen && (
          <dl className="grid grid-cols-2 gap-2.5 rounded-[10px] bg-[#F6F8F7] px-3.5 py-3 text-[12.5px]">
            <div><dt className="text-ink-faint">Depot</dt><dd className="mt-0.5 font-medium">{chosen.depot}</dd></div>
            <div><dt className="text-ink-faint">Seats</dt><dd className="mt-0.5 font-medium">{chosen.capacity} · {chosen.wheelchair_positions} wheelchair</dd></div>
            <div><dt className="text-ink-faint">Runs today</dt><dd className="mt-0.5 font-medium tnum">{chosen.runs_today}</dd></div>
            <div><dt className="text-ink-faint">Source</dt><dd className="mt-0.5 font-medium" title={vehicleList?.table ?? undefined}>{vehicleList?.source === "databricks" ? "Databricks" : "Operational DB"}</dd></div>
          </dl>
        )}
        {!canAct && <p className="text-xs text-ink-soft">Analysts can watch but not raise faults.</p>}
        <button className="btn-lg h-[46px] bg-route font-semibold text-white" disabled={busy || !canAct || !vehicle || !code} onClick={send}>
          <Zap className="h-4 w-4" aria-hidden /> {busy ? "Sending…" : `Raise ${code || ""} fault`}
        </button>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
          <Radio className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          You’ll be taken to Needs your attention, where the agent’s first decision will be waiting.
        </p>
      </aside>
    </div>
  );
}
