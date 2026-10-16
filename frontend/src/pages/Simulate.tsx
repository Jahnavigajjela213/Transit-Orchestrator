import { useSearchParams } from "react-router-dom";
import { CalendarClock, FlaskConical, MessageSquare, SlidersHorizontal, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import FaultForm from "../components/FaultForm";
import { useToast } from "../components/Toast";
import { PageHeader, Section } from "../components/ui";
import Schedule from "./Schedule";
import Riders from "./Riders";
import Simulator from "./Simulator";

const TABS = [
  { key: "fault", label: "Raise a fault", icon: Zap },
  { key: "scenarios", label: "Scenario testing", icon: FlaskConical },
  { key: "scheduling", label: "Scheduling data", icon: CalendarClock },
  { key: "riders", label: "Rider messages", icon: MessageSquare },
  { key: "controls", label: "Demo controls", icon: SlidersHorizontal },
] as const;

/** Testing playground: drive the synthetic products and look at the data they hold, outside the operational screens. */
export default function Simulate() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "fault";
  return (
    <div className="flex flex-col">
      <PageHeader title="Simulate" eyebrow="Testing · sandbox"
        intro="Scenario testing with fault injection: raise vehicle faults, simulate product outages, and inspect the synthetic scheduling and rider data. Everything goes through the same event backbone and product APIs a real integration uses." />
      <div className="tabs mb-5" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams({ tab: t.key })}>
            <t.icon className="h-4 w-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>
      {tab === "fault" && <FaultForm />}
      {tab === "scenarios" && <Simulator embedded />}
      {tab === "scheduling" && <Schedule embedded />}
      {tab === "riders" && <Riders embedded />}
      {tab === "controls" && <DemoControls />}
    </div>
  );
}

interface Failure { target: string; description: string; mode: string }

function DemoControls() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: failures, reload } = useData<Failure[]>("/api/simulator/failures");
  const canAct = user?.role !== "viewer";
  return (
    <div className="space-y-5">
      <Section title="Product outages" subtitle={'"Fails once" is a short outage: the adapter retries and the step succeeds. "Keeps failing" makes the step fail, so the agent rolls back earlier steps and asks a person to finish.'}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Product action</th><th className="w-80">Behaviour</th></tr></thead>
            <tbody>
              {(failures || []).map((f) => (
                <tr key={f.target}>
                  <td><div className="font-medium">{f.description}</div><code className="font-mono text-2xs text-ink-faint">{f.target}</code></td>
                  <td>
                    <div className="seg" role="radiogroup" aria-label={f.description}>
                      {[["off", "Works"], ["fail_once", "Fails once"], ["fail_always", "Keeps failing"]].map(([m, l]) => (
                        <button key={m} role="radio" aria-checked={f.mode === m} aria-selected={f.mode === m} disabled={!canAct}
                          onClick={async () => { try { await api.post("/api/simulator/failures", { target: f.target, mode: m }); reload(); toast(`${f.description}: ${l.toLowerCase()}`); } catch (e: any) { toast(e.message, "error"); } }}>{l}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {user?.role === "admin" && (
        <Section title="Reset demo data" subtitle="Deletes all orchestrations, events and audit records for both agencies and regenerates the synthetic data. Databricks re-copies every table afterwards (a few minutes).">
          <div className="flex justify-end px-5 py-4">
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
