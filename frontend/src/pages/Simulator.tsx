import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { sentence } from "../lib/format";
import type { FleetRow } from "../lib/types";
import { useToast } from "../components/Toast";
import { PageHeader, Section, SeverityTag, StatusBadge } from "../components/ui";

interface FC { code: string; description: string; system: string; severity: string; est_repair_hours: number }
const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
interface Failure { target: string; description: string; mode: string }

/** `embedded`: the Scenario testing tab of Simulate. Fault injection, outages and reset have their own tabs there. */
export default function Simulator({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: vehicleList, error: vehicleError } = useData<{ source: string; table: string | null; vehicles: FleetRow[] }>("/api/simulator/vehicles");
  const fleet = vehicleList?.vehicles;
  const { data: codes } = useData<FC[]>("/products/asset-mgmt/fault-codes");
  const { data: failures, reload: reloadFailures } = useData<Failure[]>("/api/simulator/failures");
  const { data: stream, reload: reloadStream } = useData<{ enabled: boolean; fault_probability: number; no_show_probability: number }>("/api/simulator/stream");
  const [nsKind, setNsKind] = useState("no_show");
  const [nsPrefer, setNsPrefer] = useState("standby");
  const [nsResult, setNsResult] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [code, setCode] = useState("P0217");
  const [busy, setBusy] = useState(false);
  const [lastWf, setLastWf] = useState<string | null>(null);

  const usable = (fleet || []).filter((v) => !v.active_workflow && v.schedule_status === "available");
  useEffect(() => { if (!vehicle && usable.length) setVehicle(usable.find((v) => v.runs_today > 0)?.label ?? usable[0].label); }, [usable, vehicle]);

  async function run(path: string, body: any, done: string) {
    setBusy(true);
    try {
      await api.post(path, body);
      toast(done);
      const wfs = await api.get<{ id: string; vehicle_label: string }[]>(`/api/workflows?vehicle=${body.vehicle_label ?? ""}`);
      setLastWf(wfs[0]?.id ?? null);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  const canAct = user?.role !== "viewer";

  return (
    <div className="space-y-5">
      {!embedded && <PageHeader title="Simulator" intro="Drive the synthetic products to see the orchestrator respond. Everything here goes through the same event backbone real products will use." />}
      {!canAct && <p className="text-sm text-ink-soft">Analysts can watch but not run simulations.</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {!embedded && <Section title="Report a vehicle fault">
          <div className="space-y-3 p-4">
            <label className="block"><span className="label">Vehicle (in service, no active orchestration)</span>
              <select className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                {usable.map((v) => <option key={v.label} value={v.label}>{v.label}, {v.vehicle_type}, {v.runs_today} runs today</option>)}
              </select>
              {vehicleList && <span className="mt-1 block text-2xs text-ink-faint">
                {vehicleList.source === "databricks" ? <>Vehicles from Databricks <code>{vehicleList.table}</code></> : "Vehicles from the operational database"}
              </span>}
              {vehicleError && <span className="mt-1 block text-xs text-stop">{vehicleError}</span>}
            </label>
            <fieldset>
              <legend className="label">Diagnostic trouble code</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(codes || []).filter((c) => c.code !== "PM-DUE").sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.code.localeCompare(b.code)).map((c) => (
                  <label key={c.code} className={`flex cursor-pointer items-start gap-2 rounded-sm border px-2.5 py-1.5 text-xs ${code === c.code ? "border-route bg-route-tint" : "border-rule bg-white"}`}>
                    <input type="radio" name="code" className="mt-0.5 accent-route" checked={code === c.code} onChange={() => setCode(c.code)} />
                    <span className="flex-1"><span className="font-semibold">{c.code}</span> {c.description}</span>
                    <SeverityTag severity={c.severity} />
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy || !canAct || !vehicle} onClick={() => run("/api/simulator/fault", { vehicle_label: vehicle, fault_code: code }, `${vehicle} reported ${code}`)}>Send fault from telematics</button>
              <button className="btn-quiet" disabled={busy || !canAct || !vehicle} onClick={() => run("/api/simulator/pm-overdue", { vehicle_label: vehicle, miles_over: 600 }, `${vehicle} flagged for overdue maintenance`)}>Flag maintenance overdue</button>
            </div>
            {lastWf && <p className="text-sm">Started. <Link to={`/workflows/${lastWf}`} className="text-route underline">Follow the orchestration</Link> or open <Link to="/" className="text-route underline">Needs your attention</Link>.</p>}
          </div>
        </Section>}

        <div className={`space-y-5 ${embedded ? "lg:col-span-2 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0" : ""}`}>
          <Section title="Late and duplicate events">
            <div className="space-y-2 p-4 text-sm">
              <p className="text-ink-soft">The orchestrator tolerates late or duplicate events. Re-send the last fault for a vehicle within the hour; the event backbone records it as a duplicate and no second orchestration starts.</p>
              <DuplicateForm fleet={fleet || []} disabled={!canAct} onDone={(m) => toast(m)} onError={(m) => toast(m, "error")} />
            </div>
          </Section>

          <Section title="Live telemetry stream">
            <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="accent-route" disabled={!canAct} checked={!!stream?.enabled}
                  onChange={async (e) => { await api.post("/api/simulator/stream", { enabled: e.target.checked }); reloadStream(); }} />
                Stream readings from 6 random vehicles every few seconds
              </label>
              <label className="inline-flex items-center gap-2">Chance of a fault per reading
                <select className="input w-24" disabled={!canAct} value={stream?.fault_probability ?? 0.04}
                  onChange={async (e) => { await api.post("/api/simulator/stream", { enabled: !!stream?.enabled, fault_probability: Number(e.target.value) }); reloadStream(); }}>
                  {[0, 0.02, 0.04, 0.1, 0.25].map((p) => <option key={p} value={p}>{p * 100}%</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2">Chance of a no-show per tick
                <select className="input w-24" disabled={!canAct} value={stream?.no_show_probability ?? 0}
                  onChange={async (e) => { await api.post("/api/simulator/stream", { enabled: !!stream?.enabled, no_show_probability: Number(e.target.value) }); reloadStream(); }}>
                  {[0, 0.1, 0.25, 0.5].map((p) => <option key={p} value={p}>{p * 100}%</option>)}
                </select>
              </label>
              <button className="btn-quiet" disabled={!canAct} onClick={async () => { const r = await api.post<{ flagged: number }>("/api/simulator/pm-scan"); toast(`Maintenance scan flagged ${r.flagged} vehicle(s)`); }}>Run maintenance scan now</button>
            </div>
          </Section>
        </div>
      </div>

      <Section title="No-Show Recovery Agent: record a no-show" subtitle="Follow-on use case: detects no-shows and cancellations in trip management and proposes schedule adjustments.">
        <div className="flex flex-wrap items-end gap-4 p-4 text-sm">
          <fieldset>
            <legend className="label">What happened</legend>
            <div className="flex gap-3">
              {[["no_show", "Rider did not show up"], ["late_cancel", "Rider cancelled late"]].map(([v, l]) => (
                <label key={v} className="inline-flex items-center gap-1.5"><input type="radio" className="accent-route" checked={nsKind === v} onChange={() => setNsKind(v)} />{l}</label>
              ))}
            </div>
          </fieldset>
          <label><span className="label">Pick a run where</span>
            <select className="input w-72" value={nsPrefer} onChange={(e) => setNsPrefer(e.target.value)}>
              <option value="standby">a standby rider could take the seat</option>
              <option value="late">the run is running late</option>
              <option value="any">anything, next upcoming pickup</option>
            </select></label>
          <button className="btn-primary" disabled={busy || !canAct} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ trip_id: string; route: string }>("/api/simulator/no-show", { kind: nsKind, prefer: nsPrefer });
              const wfs = await api.get<{ id: string; trigger_event_id: string }[]>("/api/workflows?workflow_type=no_show_recovery&limit=1");
              setNsResult(wfs[0]?.id ?? null);
              toast(`Recorded on ${r.route}`);
            } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
          }}>Record it in trip management</button>
          {nsResult && <p className="w-full">The agent is on it. <Link to={`/workflows/${nsResult}`} className="text-route underline">Follow the orchestration</Link>.</p>}
        </div>
      </Section>

      <ScenarioPanel canAct={canAct} />

      <div className="grid gap-5 lg:grid-cols-2">
        <ReplayPanel canAct={canAct} />
        <CompliancePanel canAct={canAct} />
      </div>

      {!embedded && <Section title="Simulate a product outage">
        <p className="px-4 pt-3 text-sm text-ink-soft">
          "Fails once" is a short outage: the adapter retries and the step succeeds. "Keeps failing" makes the step fail, so the agent rolls back earlier steps and asks a person to finish.
        </p>
        <div className="overflow-x-auto">
          <table className="table mt-2">
            <thead><tr><th>Product action</th><th>Behaviour</th></tr></thead>
            <tbody>
              {(failures || []).map((f) => (
                <tr key={f.target}>
                  <td><div className="font-medium">{f.description}</div><code className="text-2xs text-ink-soft">{f.target}</code></td>
                  <td>
                    <div className="inline-flex overflow-hidden rounded-sm border border-rule" role="radiogroup" aria-label={f.description}>
                      {[["off", "Works"], ["fail_once", "Fails once"], ["fail_always", "Keeps failing"]].map(([m, l]) => (
                        <button key={m} role="radio" aria-checked={f.mode === m} disabled={!canAct}
                          onClick={async () => { try { await api.post("/api/simulator/failures", { target: f.target, mode: m }); reloadFailures(); toast(`${f.description}: ${l.toLowerCase()}`); } catch (e: any) { toast(e.message, "error"); } }}
                          className={`px-3 py-1 text-xs ${f.mode === m ? (m === "off" ? "bg-go text-white" : "bg-stop text-white") : "bg-white hover:bg-paper"}`}>{l}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>}

      {!embedded && user?.role === "admin" && (
        <Section title="Reset demo data">
          <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <p className="flex-1 text-ink-soft">Deletes all orchestrations, events and audit records for both agencies and regenerates the synthetic data.</p>
            <button className="btn-danger" onClick={async () => {
              if (!confirm("Reset all demo data for both agencies?")) return;
              try { await api.post("/api/admin/reset"); toast("Demo data reset"); setTimeout(() => location.reload(), 600); } catch (e: any) { toast(e.message, "error"); }
            }}>Reset demo data</button>
          </div>
        </Section>
      )}
    </div>
  );
}

function DuplicateForm({ fleet, disabled, onDone, onError }: { fleet: FleetRow[]; disabled: boolean; onDone: (m: string) => void; onError: (m: string) => void }) {
  const withWf = fleet.filter((v) => v.active_workflow);
  const [v, setV] = useState("");
  useEffect(() => { if (!v && withWf.length) setV(withWf[0].label); }, [withWf, v]);
  if (withWf.length === 0) return <p className="text-xs text-ink-faint">Send a fault first, then come back here.</p>;
  return (
    <div className="flex gap-2">
      <select className="input w-40" value={v} onChange={(e) => setV(e.target.value)} aria-label="Vehicle">
        {withWf.map((x) => <option key={x.label} value={x.label}>{x.label}</option>)}
      </select>
      <button className="btn-quiet" disabled={disabled} onClick={async () => {
        try { await api.post("/api/simulator/duplicate", { vehicle_label: v }); onDone(`Re-sent the last fault for ${v}. Check the event stream for the duplicate.`); }
        catch (e: any) { onError(e.message); }
      }}>Re-send last fault</button>
      <span className="self-center text-xs text-ink-faint">{sentence(withWf.find((x) => x.label === v)?.active_workflow?.current_step)}</span>
    </div>
  );
}


interface Scenario { id: string; title: string; description: string }
interface ScenarioEvent { id: string; type: string; subject: string | null; time: string; status?: string; note?: string | null; error?: string | null; publish_status: string; original_id?: string }

function EventResults({ events }: { events: ScenarioEvent[] }) {
  return (
    <table className="table text-xs">
      <thead><tr><th>Event</th><th>Happened</th><th>Result</th></tr></thead>
      <tbody>{events.map((e) => (
        <tr key={e.id}><td>{e.type}<div className="text-2xs text-ink-faint">{e.subject}</div></td>
          <td className="tnum">{new Date(e.time).toLocaleTimeString()}</td>
          <td><StatusBadge status={e.status ?? e.publish_status} />{(e.note || e.error) && <div className="text-2xs text-ink-soft">{e.note || e.error}</div>}</td></tr>
      ))}</tbody>
    </table>
  );
}

function ScenarioPanel({ canAct }: { canAct: boolean }) {
  const toast = useToast();
  const { data: scenarios } = useData<Scenario[]>("/api/simulator/scenarios");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ scenario: string; events?: ScenarioEvent[]; no_shows?: any[] } | null>(null);
  return (
    <Section title="Scenario testing">
      <p className="px-4 pt-3 text-sm text-ink-soft">Replay realistic event sequences through the backbone: repeats, bursts, late and out-of-order signals. De-duplication, ordering, policy and audit all apply.</p>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {(scenarios || []).map((sc) => (
          <div key={sc.id} className="rounded-sm border border-rule p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{sc.title}</div>
              <button className="btn-quiet shrink-0 px-2 py-1 text-xs" disabled={!canAct || !!busy} onClick={async () => {
                setBusy(sc.id);
                try { setResult(await api.post("/api/simulator/scenarios/run", { scenario_id: sc.id })); toast(`Ran: ${sc.title}`); }
                catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); }
              }}>{busy === sc.id ? "Running…" : "Run"}</button>
            </div>
            <p className="mt-1 text-xs text-ink-soft">{sc.description}</p>
          </div>
        ))}
      </div>
      {result && (
        <div className="border-t border-rule">
          {result.events && <EventResults events={result.events} />}
          {result.no_shows && <ul className="p-4 text-xs">{result.no_shows.map((n, i) => <li key={i}>{n.error ? `${n.prefer}: ${n.error}` : `${n.prefer}: no-show recorded on ${n.route} (${n.trip_id})`}</li>)}</ul>}
          <p className="px-4 py-2 text-xs"><Link to="/workflows" className="text-route underline">See the orchestrations</Link> · <Link to="/events" className="text-route underline">Event stream</Link></p>
        </div>
      )}
    </Section>
  );
}

function ReplayPanel({ canAct }: { canAct: boolean }) {
  const toast = useToast();
  const [events, setEvents] = useState<any[] | null>(null);
  const [name, setName] = useState("");
  const [shift, setShift] = useState(true);
  const [keepDedupe, setKeepDedupe] = useState(false);
  const [result, setResult] = useState<ScenarioEvent[] | null>(null);
  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    try {
      const parsed = text.trim().startsWith("[") ? JSON.parse(text) : text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
      setEvents(parsed); setName(f.name); setResult(null);
    } catch { toast("That file is not JSON Lines or a JSON array of CloudEvents.", "error"); }
  }
  return (
    <Section title="Replay an event file">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-ink-soft">CloudEvents as JSON Lines, e.g. from <button className="text-route underline" onClick={() => api.download("/api/events/export?since_hours=72", "events.jsonl")}>Export events</button> or an EventBridge archive. Events get new ids and keep their spacing.</p>
        <input type="file" accept=".jsonl,.json,.ndjson,application/json" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Event file" className="text-xs" />
        {events && <p className="text-xs">{name}: {events.length} event(s)</p>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-route" checked={shift} onChange={(e) => setShift(e.target.checked)} />Shift times so the newest event happens now</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-route" checked={keepDedupe} onChange={(e) => setKeepDedupe(e.target.checked)} />Keep dedupe keys (re-sending within 24 h shows as duplicates)</label>
        <button className="btn-primary" disabled={!canAct || !events} onClick={async () => {
          try { const r = await api.post<{ events: ScenarioEvent[] }>("/api/simulator/replay", { events, shift_to_now: shift, keep_dedupe: keepDedupe }); setResult(r.events); toast(`Replayed ${r.events.length} event(s)`); }
          catch (e: any) { toast(e.message, "error"); }
        }}>Replay</button>
      </div>
      {result && <div className="max-h-72 overflow-auto border-t border-rule"><EventResults events={result} /></div>}
    </Section>
  );
}

function CompliancePanel({ canAct }: { canAct: boolean }) {
  const toast = useToast();
  const [issue, setIssue] = useState("medical_card");
  const [last, setLast] = useState<{ driver: string; compliant: boolean; blocking: string[]; wheelchair_reasons: string[] } | null>(null);
  return (
    <Section title="Driver compliance (Vestige)">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-ink-soft">Put a rostered driver out of compliance in Vestige. The next cover plan will not propose them, and the orchestration shows why.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="label">What lapses</span>
            <select className="input w-60" value={issue} onChange={(e) => setIssue(e.target.value)}>
              <option value="medical_card">DOT medical card expires</option><option value="drug_test">Random drug test overdue</option>
              <option value="training">Wheelchair securement refresher overdue</option><option value="suspended">Suspended pending review</option>
            </select></label>
          <button className="btn-primary" disabled={!canAct} onClick={async () => {
            try { const r = await api.post<any>("/api/simulator/driver-compliance", { issue }); setLast(r); toast(`${r.driver} is now out of compliance`); }
            catch (e: any) { toast(e.message, "error"); }
          }}>Apply to a driver</button>
          {last && <button className="btn-quiet" disabled={!canAct} onClick={async () => {
            try { await api.post("/api/simulator/driver-compliance", { driver_name: last.driver, issue: "clear" }); toast(`${last.driver} cleared`); setLast(null); }
            catch (e: any) { toast(e.message, "error"); }
          }}>Clear {last.driver}</button>}
        </div>
        {last && <p className="text-xs">{last.driver}: {[...last.blocking, ...last.wheelchair_reasons].join("; ")}. <Link to="/safety" className="text-route underline">Safety & compliance</Link></p>}
      </div>
    </Section>
  );
}
