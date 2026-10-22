import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import FaultForm from "../components/FaultForm";
import { useToast } from "../components/Toast";
import { Loading, PageHeader } from "../components/ui";
import Schedule from "./Schedule";
import Riders from "./Riders";

const TABS = [
  { key: "fault", label: "Raise a fault" },
  { key: "scheduling", label: "Scheduling data" },
  { key: "riders", label: "Rider messages" },
  { key: "controls", label: "Demo controls" },
] as const;

/** Testing playground: drive the synthetic products and look at the data they hold, outside the operational screens. */
export default function Simulate() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "fault";
  const pick = (key: string) => { const p = new URLSearchParams(params); p.set("tab", key); if (key !== "riders") p.delete("workflow"); setParams(p); };
  return (
    <>
      <PageHeader title="Simulate" eyebrow="Testing playground"
        badge={<span className="rounded-full border border-signal-line bg-signal-tint px-2.5 py-[3px] text-[11px] font-semibold tracking-normal text-signal-ink">Sandbox</span>}
        intro="Everything here goes through the same event backbone and product APIs a real integration would use." />
      <div role="tablist" aria-label="Playground" className="flex shrink-0 gap-6 overflow-x-auto border-b border-rule">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => pick(t.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium ${tab === t.key ? "border-route text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {tab === "fault" && <FaultForm />}
        {tab === "scheduling" && <Schedule embedded />}
        {tab === "riders" && <Riders embedded />}
        {tab === "controls" && <DemoControls />}
      </div>
    </>
  );
}

interface Failure { target: string; description: string; mode: string }
const MODES: [string, string][] = [["off", "Works"], ["fail_once", "Fails once"], ["fail_always", "Keeps failing"]];

function DemoControls() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: failures, reload } = useData<Failure[]>("/api/simulator/failures");
  const canAct = user?.role !== "viewer";

  async function set(f: Failure, mode: string, label: string) {
    try { await api.post("/api/simulator/failures", { target: f.target, mode }); reload(); toast(`${f.description}: ${label.toLowerCase()}`); }
    catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <section className="card overflow-hidden">
      <h2 className="px-[18px] pb-1 pt-4 text-sm font-semibold">Product outages</h2>
      <p className="px-[18px] pb-3 text-[12.5px] text-ink-soft">“Fails once” retries and succeeds; “Keeps failing” makes the agent roll back earlier steps and ask a person.</p>
      {!failures ? <Loading /> : failures.map((f) => (
        <div key={f.target} className="flex flex-wrap items-center gap-3 border-t border-rule-soft px-[18px] py-3">
          <span className="min-w-[220px] flex-1"><b className="font-semibold">{f.description}</b></span>
          <span role="radiogroup" aria-label={f.description} className="flex rounded-[10px] border border-rule p-[3px]">
            {MODES.map(([m, l]) => (
              <button key={m} type="button" role="radio" aria-checked={f.mode === m} disabled={!canAct} onClick={() => set(f, m, l)}
                className={`rounded-[7px] px-3 py-1.5 text-xs ${f.mode === m ? (m === "off" ? "bg-go text-white" : m === "fail_once" ? "bg-signal text-white" : "bg-stop text-white") : "text-ink-soft hover:text-ink"}`}>
                {l}
              </button>
            ))}
          </span>
        </div>
      ))}
      {user?.role === "admin" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-[#FBF7F6] px-[18px] py-4">
          <span className="flex-1 text-[13px] text-ink-soft">Reset deletes all orchestrations, events and audit records for both agencies and regenerates the data. Databricks re-copies every table afterwards (a few minutes).</span>
          <button type="button" className="h-10 rounded-[10px] border border-stop-line bg-white px-3.5 text-stop" onClick={async () => {
            if (!confirm("Reset all demo data for both agencies?")) return;
            try { await api.post("/api/admin/reset"); toast("Demo data reset"); setTimeout(() => location.reload(), 600); } catch (e: any) { toast(e.message, "error"); }
          }}>Reset demo data</button>
        </div>
      )}
    </section>
  );
}
