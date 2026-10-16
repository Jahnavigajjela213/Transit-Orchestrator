import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import type { FleetRow } from "../lib/types";
import { Dropdown } from "./ui";
import { useToast } from "./Toast";

interface FC { code: string; description: string; system: string; severity: string; est_repair_hours: number }
const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Raise a vehicle fault: sends a diagnostic trouble code from telematics, the way a real bus would, then opens the orchestration it starts. */
export default function FaultForm() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: vehicleList, error: vehicleError } = useData<{ source: string; table: string | null; vehicles: FleetRow[] }>("/api/simulator/vehicles");
  const { data: codes } = useData<FC[]>("/products/asset-mgmt/fault-codes");
  const [vehicle, setVehicle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // vehicles on the schedule only: a spare with no runs has nothing for the agent to cover
  const usable = (vehicleList?.vehicles || []).filter((v) => !v.active_workflow && v.schedule_status === "available" && v.runs_today > 0)
    .sort((a, b) => b.runs_today - a.runs_today || a.label.localeCompare(b.label));
  const shown = (codes || []).filter((c) => c.code !== "PM-DUE").sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.code.localeCompare(b.code));
  const vehicleItems = useMemo(() => usable.map((v) => ({ id: v.label, label: `${v.label} · ${v.vehicle_type}` })), [usable]);
  const chosen = usable.find((v) => v.label === vehicle);
  useEffect(() => { if (!vehicle && usable.length) setVehicle(usable[0].label); }, [usable, vehicle]);
  useEffect(() => { if (!code && shown.length) setCode(shown[0].code); }, [shown, code]);

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
    <div className="flex flex-col gap-[18px]">
      <section className="card flex flex-wrap items-end gap-3 p-3.5">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-soft">Vehicle in service
          <Dropdown value={vehicle} items={vehicleItems} onChange={setVehicle} placeholder={!vehicleList ? "Loading vehicles…" : "Select a vehicle"} className="w-60" />
          {vehicleError && <span className="text-xs text-stop">{vehicleError}</span>}
        </label>
        {chosen && (
          <dl className="grid min-w-[280px] flex-1 grid-cols-2 gap-2 rounded-[10px] bg-[#F6F8F7] px-3 py-2 text-[12.5px] sm:grid-cols-4">
            <div><dt className="text-ink-faint">Depot</dt><dd className="mt-0.5 font-medium">{chosen.depot}</dd></div>
            <div><dt className="text-ink-faint">Seats</dt><dd className="mt-0.5 font-medium">{chosen.capacity} · {chosen.wheelchair_positions} wheelchair</dd></div>
            <div><dt className="text-ink-faint">Runs today</dt><dd className="mt-0.5 font-medium tnum">{chosen.runs_today}</dd></div>
            <div><dt className="text-ink-faint">Source</dt><dd className="mt-0.5 font-medium" title={vehicleList?.table ?? undefined}>{vehicleList?.source === "databricks" ? "Databricks" : "Operational DB"}</dd></div>
          </dl>
        )}
        <div className="flex items-center gap-2.5">
          {!canAct && <p className="text-xs text-ink-soft">Analysts can watch but not raise faults.</p>}
          <button className="btn-lg h-[36px] whitespace-nowrap bg-route font-semibold text-white" disabled={busy || !canAct || !vehicle || !code} onClick={send}>
            <Zap className="h-4 w-4" aria-hidden /> {busy ? "Sending…" : `Raise ${code || ""} fault`}
          </button>
        </div>
        <p className="flex w-full items-start gap-2 text-xs leading-relaxed text-ink-faint">
          <Radio className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          You’ll be taken to Needs your attention, where the agent’s first decision will be waiting.
        </p>
      </section>

      <section className="card p-[18px]">
        <h2 className="mb-1 text-sm font-semibold">Fault code</h2>
        <p className="mb-3.5 text-[12.5px] text-ink-soft">As the bus’s telematics unit would send it.</p>
        <div role="radiogroup" aria-label="Fault code" className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {shown.map((c) => (
            <button key={c.code} type="button" role="radio" aria-checked={code === c.code} onClick={() => setCode(c.code)}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left ${code === c.code ? "border-2 border-route bg-[#F1F7F6]" : "border border-rule bg-white hover:border-ink-faint"}`}>
              <span className="w-16 shrink-0 font-mono text-xs text-ink-soft">{c.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.description}</span>
                <span className="block truncate text-xs text-ink-soft">{c.system} · about {c.est_repair_hours} h in the shop</span>
              </span>
              <span className={`pill shrink-0 text-[11px] ${SEV[c.severity] ?? SEV.low}`}>{c.severity[0].toUpperCase() + c.severity.slice(1)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
