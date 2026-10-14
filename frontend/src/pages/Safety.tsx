import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { ago, dayTime, sentence } from "../lib/format";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Loading, PageHeader, Section, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

interface DriverRec {
  safety_id: string; name: string; compliant: boolean; blocking: string[]; wheelchair_ok: boolean; wheelchair_reasons: string[];
  status: string; medical_card_expires: string; drug_test_due: string; securement_training_due: string; preventable_incidents_12m: number;
}
interface Defect {
  id: string; vehicle_ref: string; vehicle_label: string; category: string; severity: string; description: string; status: string;
  out_of_service: boolean; source: string; external_ref: string | null; work_order_id: string | null; created_by: string; created_at: string;
  closed_at: string | null; closed_by: string | null; resolution: string | null;
}

/** Record a vehicle defect by hand in Vestige, as a safety officer or shop manager does today. */
function DefectForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { data: vehicles } = useData<{ vehicle_code: string; label: string }[]>("/products/trip-mgmt/vehicles");
  const [vehicle, setVehicle] = useState("");
  const [category, setCategory] = useState("Brakes");
  const [severity, setSeverity] = useState("high");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = (vehicles || []).map((v) => v.label).sort();
  const v = vehicle || labels[0] || "";
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-rule bg-paper/50 p-3 text-sm">
      <label><span className="label">Vehicle</span>
        <select className="input w-28" value={v} onChange={(e) => setVehicle(e.target.value)}>{labels.map((l) => <option key={l}>{l}</option>)}</select></label>
      <label><span className="label">Category</span>
        <select className="input w-36" value={category} onChange={(e) => setCategory(e.target.value)}>
          {["Brakes", "Accessibility", "Engine", "Electrical", "Tires", "Body", "Mechanical"].map((c) => <option key={c}>{c}</option>)}</select></label>
      <label><span className="label">Severity</span>
        <select className="input w-28" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {["critical", "high", "medium", "low"].map((x) => <option key={x} value={x}>{sentence(x)}</option>)}</select></label>
      <label className="min-w-[14rem] flex-1"><span className="label">What is wrong</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Wheelchair lift stalls halfway" /></label>
      <button className="btn-primary" disabled={busy || !v} onClick={async () => {
        setBusy(true);
        try {
          const d = await api.post<{ id: string }>("/products/safety/defects", { vehicle_label: v, category, severity, description: description || `${category} defect reported by hand` });
          toast(`${d.id} recorded for ${v}`); setDescription(""); onDone();
        } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
      }}>Record defect</button>
    </div>
  );
}

export default function Safety() {
  const { user } = useAuth();
  const toast = useToast();
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [defStatus, setDefStatus] = useState("open");
  const { data: drivers, error } = useData<DriverRec[]>("/products/safety/drivers");
  const { data: defects, reload } = useData<Defect[]>(`/products/safety/defects${defStatus ? `?status=${defStatus}` : ""}`, [defStatus]);
  const rows = (drivers || []).filter((d) => !onlyIssues || !d.compliant || !d.wheelchair_ok);
  const canClose = user?.role === "shop_manager" || user?.role === "admin";
  const canRecord = canClose || user?.role === "dispatcher";
  const [recording, setRecording] = useState(false);

  async function close(id: string) {
    try { await api.post(`/products/safety/defects/${id}/close`, { resolution: "Repaired and inspected" }); toast(`${id} cleared`); reload(); }
    catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Safety & compliance" intro="The synthetic Vestige product. The safety agent checks every driver the agent proposes against these records, and records a vehicle defect alongside the work order for brake, accessibility and critical faults." />
      {error && <ErrorNote message={error} />}

      <Section title="Vehicle defects" aside={
        <span className="flex items-center gap-2">
          {canRecord && <button className="btn-quiet px-2 py-1 text-xs" onClick={() => setRecording(!recording)}>{recording ? "Close" : "Record defect by hand"}</button>}
          <select className="input w-36 py-1 text-xs" value={defStatus} onChange={(e) => setDefStatus(e.target.value)} aria-label="Defect status">
            <option value="open">Open</option><option value="closed">Cleared</option><option value="">All</option>
          </select>
        </span>}>
        {recording && <DefectForm onDone={() => { setRecording(false); reload(); }} />}
        {!defects ? <Loading /> : defects.length === 0 ? <Empty title="No defects">Send a brake or wheelchair-lift fault from the simulator to see one recorded.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Defect</th><th>Vehicle</th><th>Category</th><th>Severity</th><th>Recorded</th><th>Work order</th><th>Status</th><th></th></tr></thead>
              <tbody>{defects.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.id}<div className="max-w-xs text-2xs text-ink-soft">{d.description}</div></td>
                  <td><VehicleId label={d.vehicle_label} /><div className="text-2xs text-ink-soft">{d.vehicle_ref}</div></td>
                  <td>{d.category}{d.out_of_service && <div><Tag color="red">Out of service</Tag></div>}</td>
                  <td><SeverityTag severity={d.severity} /></td>
                  <td className="text-xs">{ago(d.created_at)}<div className="text-2xs text-ink-soft">{d.source === "orchestrator" ? "by the safety agent" : `by ${d.created_by}`}</div></td>
                  <td className="text-xs">{d.work_order_id ?? "—"}</td>
                  <td><StatusBadge status={d.status} />{d.closed_at && <div className="text-2xs text-ink-soft">{dayTime(d.closed_at)} by {d.closed_by}</div>}</td>
                  <td>{d.status === "open" && canClose && <button className="btn-quiet px-2 py-0.5 text-xs" onClick={() => close(d.id)}>Clear</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Driver compliance" aside={
        <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-route" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Only drivers with issues</label>}>
        {!drivers ? <Loading /> : rows.length === 0 ? <Empty title="Everyone is in compliance" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Driver</th><th>Status</th><th>Medical card</th><th>Drug test due</th><th>Securement training</th><th>Preventable incidents, 12 mo</th><th>Agent may propose</th></tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.safety_id}>
                  <td className="font-medium">{d.name}<div className="text-2xs text-ink-soft">{d.safety_id}</div></td>
                  <td><StatusBadge status={d.status === "suspended" ? "suspended" : d.compliant ? (d.wheelchair_ok ? "compliant" : "restricted") : "not_compliant"} /></td>
                  <td className="text-xs tnum">{d.medical_card_expires}</td>
                  <td className="text-xs tnum">{d.drug_test_due}</td>
                  <td className="text-xs tnum">{d.securement_training_due}</td>
                  <td className="tnum">{d.preventable_incidents_12m}</td>
                  <td className="text-xs">
                    {!d.compliant ? <><Tag color="red">No</Tag> {d.blocking.map(sentence).join("; ")}</>
                      : !d.wheelchair_ok ? <><Tag color="amber">Not for wheelchair runs</Tag> {d.wheelchair_reasons.map(sentence).join("; ")}</>
                      : <Tag color="green">Yes</Tag>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Make a driver non-compliant from the Simulator to watch the agent stop proposing them.</p>
      </Section>
    </div>
  );
}
