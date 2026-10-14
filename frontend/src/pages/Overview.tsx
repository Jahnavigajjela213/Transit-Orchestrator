import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData, useLive } from "../lib/live";
import { useToast } from "../components/Toast";
import { ago, sentence, words, workflowName } from "../lib/format";
import type { Workflow } from "../lib/types";
import LineMap from "../components/LineMap";
import { Empty, ErrorNote, Loading, PageHeader, Section, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

interface Summary {
  no_show: { orchestrations: number; finished: number; minutes_freed: number; standby_riders_booked: number; pickups_retimed: number;
    late_pickups_avoided: number; riders_notified: number; riders_flagged_for_review: number; recovered_pct: number | null };
  baseline: Record<string, number | null>;
  baseline_source: "none" | "shadow_live" | "entered" | "measured_shadow"; baseline_updated_at: string | null;
  baseline_notes: string | null; baseline_updated_by: string | null;
  operations: Operations;
  generated_at: string;
  measures: Record<string, any>;
  autonomy_readiness: { workflow_type: string; step: string; decisions_28d: number; acceptance_pct: number | null; ready: boolean; rule: string }[];
  shadow: { workflows: number; total: number; steps: { step: string; recommended: number; matched: number; agreement_pct: number | null; ready_to_go_live: boolean }[] };
  audit_mirror: { pending: number; sent: number; failed: number };
  workflows: { total: number; by_status: Record<string, number> };
  pending_attention: number;
  events: Record<string, number>;
  llm_usage: { provider: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; fallbacks: number }[];
}

interface Operations {
  vehicles: { total: number; available: number; out_of_service: number };
  work_orders_open: { total: number; by_priority: Record<string, number> };
  defects_open: { total: number; out_of_service: number };
  drivers: { total: number; not_compliant: number; no_wheelchair_runs: number };
  runs_today: { total: number; reassigned: number; running_late: number };
  trips_today: { total: number; booked: number; completed: number; no_show: number };
  rider_messages_24h: number;
  on_time: { last_30d: number | null; prior_30d: number | null; road_calls_30d: number | null; no_shows_30d: number | null; as_of: string | null };
}

function Measure({ label, now, before, unit = "", better = "lower", note }: {
  label: string; now: number | null | undefined; before?: number | null; unit?: string; better?: "lower" | "higher"; note?: string;
}) {
  const has = now !== null && now !== undefined;
  const hasBefore = before !== null && before !== undefined;
  const improved = has && hasBefore && (better === "lower" ? now! < before! : now! > before!);
  return (
    <div className="border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-sign text-2xl font-bold tnum ${improved ? "text-go" : ""}`}>{has ? `${now}${unit}` : "No data yet"}</span>
        {hasBefore && <span className="text-xs text-ink-faint tnum">baseline {before}{unit}</span>}
      </div>
      {note && <div className="mt-0.5 text-2xs text-ink-faint">{note}</div>}
    </div>
  );
}

const BASELINE_LABELS: Record<string, string> = {
  detect_to_work_order_minutes: "Fault to open work order (min)", manual_reentries_per_incident: "Manual re-entries per incident",
  runs_covered_pct: "Affected runs covered (%)", audit_complete_pct: "Decisions with full audit record (%)", manual_steps_to_return: "Manual steps to return a vehicle",
};
const SOURCE_TEXT: Record<string, string> = {
  none: "no baseline yet", shadow_live: "baseline measured live from shadow mode",
  entered: "baseline entered from Phase 0 discovery", measured_shadow: "baseline saved from shadow mode",
};

/** One figure from the products, with an optional warning tone. */
function Stat({ label, value, sub, tone, to }: { label: string; value: string | number; sub?: string; tone?: "warn" | "bad" | "good"; to?: string }) {
  const color = tone === "bad" ? "text-stop" : tone === "warn" ? "text-signal" : tone === "good" ? "text-go" : "";
  const body = (
    <>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-1 font-sign text-2xl font-bold tnum ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-ink-faint">{sub}</div>}
    </>
  );
  const cls = "block border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0";
  return to ? <Link to={to} className={`${cls} hover:bg-paper/60`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function OperationsNow({ o }: { o: Operations }) {
  const pri = Object.entries(o.work_orders_open.by_priority).map(([p, n]) => `${n} ${p}`).join(", ");
  const otp = o.on_time;
  const delta = otp.last_30d !== null && otp.prior_30d !== null ? Math.round((otp.last_30d - otp.prior_30d) * 10) / 10 : null;
  return (
    <div className="grid sm:grid-cols-4 xl:grid-cols-8">
      <Stat label="Vehicles in service" value={`${o.vehicles.total - o.vehicles.out_of_service}/${o.vehicles.total}`}
        sub={o.vehicles.out_of_service ? `${o.vehicles.out_of_service} out of service now` : "none out of service"} tone={o.vehicles.out_of_service ? "warn" : "good"} to="/fleet" />
      <Stat label="Open work orders" value={o.work_orders_open.total} sub={pri || "none open"} tone={o.work_orders_open.by_priority.critical ? "bad" : undefined} to="/work-orders" />
      <Stat label="Open vehicle defects" value={o.defects_open.total} sub={`${o.defects_open.out_of_service} out-of-service defect(s)`} tone={o.defects_open.total ? "warn" : "good"} to="/safety" />
      <Stat label="Drivers not compliant" value={o.drivers.not_compliant} sub={`of ${o.drivers.total}; ${o.drivers.no_wheelchair_runs} not for wheelchair runs`} tone={o.drivers.not_compliant ? "bad" : "good"} to="/safety" />
      <Stat label="Runs today" value={o.runs_today.total} sub={`${o.runs_today.reassigned} reassigned, ${o.runs_today.running_late} running late`} tone={o.runs_today.running_late ? "warn" : undefined} to="/schedule" />
      <Stat label="Trips today" value={o.trips_today.total} sub={`${o.trips_today.booked} booked, ${o.trips_today.completed} done, ${o.trips_today.no_show} no-show`} to="/schedule" />
      <Stat label="Rider messages, 24 h" value={o.rider_messages_24h} to="/riders" />
      <Stat label="On-time pickups, 30 d" value={otp.last_30d === null ? "—" : `${otp.last_30d}%`}
        sub={delta === null ? "no history yet" : `${delta >= 0 ? "+" : ""}${delta} pts vs prior 30 d · ${otp.road_calls_30d} road calls`} tone={delta === null ? undefined : delta >= 0 ? "good" : "bad"} to="/performance" />
    </div>
  );
}

function BaselineEditor({ values, saved, onSaved }: { values: Record<string, number | null>; saved: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, number | null>>(values);
  const [notes, setNotes] = useState("");
  return (
    <div className="grid gap-3 border-t border-rule p-4 text-sm sm:grid-cols-3">
      {Object.keys(BASELINE_LABELS).map((k) => (
        <label key={k} className="block"><span className="label">{BASELINE_LABELS[k]}</span>
          <input type="number" min={0} className="input" value={v[k] ?? ""} placeholder="not known"
            onChange={(e) => setV({ ...v, [k]: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      ))}
      <label className="block sm:col-span-2"><span className="label">Where these numbers come from</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Phase 0 time study, 3 depots, Nov 2026" /></label>
      <div className="flex items-end gap-2">
        <button className="btn-primary" onClick={async () => {
          const known = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined));
          if (!Object.keys(known).length) { toast("Enter at least one number", "error"); return; }
          try { await api.put("/api/metrics/baseline", { values: known, notes }); toast("Baseline saved"); onSaved(); } catch (e: any) { toast(e.message, "error"); }
        }}>Save baseline</button>
        <button className="btn-quiet" onClick={async () => {
          try { const r = await api.post<{ sample: number }>("/api/metrics/baseline/measure"); toast(`Measured from ${r.sample} shadow incident(s)`); onSaved(); }
          catch (e: any) { toast(e.message, "error"); }
        }}>Measure from shadow mode</button>
        {saved && <button className="btn-quiet" onClick={async () => {
          try { await api.del("/api/metrics/baseline"); toast("Saved baseline cleared: measuring live from shadow mode again"); onSaved(); }
          catch (e: any) { toast(e.message, "error"); }
        }}>Clear saved baseline</button>}
      </div>
    </div>
  );
}

export default function Overview() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const { data: m, error, reload } = useData<Summary>("/api/metrics/summary");
  const { data: active } = useData<Workflow[]>("/api/workflows?status=running,awaiting_approval,awaiting_event");
  const { data: recent } = useData<Workflow[]>("/api/workflows?limit=8");
  const { last } = useLive();

  if (error) return <ErrorNote message={error} />;
  if (!m) return <Loading />;
  const mm = m.measures;
  const acceptance = Object.entries(mm.dispatcher_acceptance || {}) as [string, any][];

  return (
    <div className="space-y-5">
      <PageHeader title="Overview" intro="How the pilot workflow is performing against the Phase 0 baseline, and what is in motion right now." actions={
        <Link to="/attention" className="btn-primary">{m.pending_attention} waiting for you</Link>
      } />

      <Section title="Operations right now" aside={<span className="text-2xs text-ink-soft">From the products · updated {new Date(m.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}>
        <OperationsNow o={m.operations} />
      </Section>

      <Section title="Vehicle health pilot: success measures" aside={
        <span className="flex items-center gap-2 text-2xs text-ink-soft">
          <span title={m.baseline_notes ?? ""}>{SOURCE_TEXT[m.baseline_source] ?? m.baseline_source}</span>
          {user?.role === "admin" && <button className="text-route hover:underline" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit baseline"}</button>}
        </span>}>
        <div className="grid sm:grid-cols-3 xl:grid-cols-6">
          <Measure label="Fault to open work order" now={mm.detect_to_work_order_minutes} before={m.baseline.detect_to_work_order_minutes} unit=" min"
            note={`${mm.detect_to_work_order_samples} orchestration(s), includes approval wait`} />
          <Measure label="Manual re-entry per incident" now={mm.manual_reentries_per_incident} before={m.baseline.manual_reentries_per_incident}
            note={`${mm.manual_reentries_total ?? 0} manual product entries counted; ${mm.approval_clicks_per_incident ?? 0} approval click(s) per incident`} />
          <Measure label="Affected runs covered" now={mm.runs_covered_pct} before={m.baseline.runs_covered_pct} unit="%" better="higher"
            note={`${mm.runs_covered_total} of ${mm.runs_at_risk_total} runs`} />
          <Measure label="Decisions with full audit record" now={mm.audit_complete_pct} before={m.baseline.audit_complete_pct} unit="%" better="higher" />
          <Measure label="Returned to schedule automatically" now={mm.auto_returned_pct} unit="%" better="higher" />
          <Measure label="Orchestrations" now={m.workflows.total} note={Object.entries(m.workflows.by_status).map(([k, v]) => `${v} ${words(k)}`).join(", ")} />
        </div>
        {m.baseline_source === "none" && !editing && (
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">{m.baseline_notes} <Link to="/shadow" className="text-route underline">Shadow mode</Link></p>
        )}
        {editing && <BaselineEditor values={m.baseline} saved={m.baseline_source === "entered" || m.baseline_source === "measured_shadow"}
          onSaved={() => { setEditing(false); reload(); }} />}
      </Section>

      <div className="grid gap-5 xl:grid-cols-3">
        <Section title="Ready for more autonomy?">
          {m.autonomy_readiness.length === 0 ? <Empty title="No steps waiting for approval in the policy" /> : (
            <table className="table">
              <thead><tr><th>Step</th><th>Decisions, 28 d</th><th>Approved unchanged</th><th></th></tr></thead>
              <tbody>{m.autonomy_readiness.map((r) => (
                <tr key={r.workflow_type + r.step}><td>{sentence(r.step)}<div className="text-2xs text-ink-soft">{workflowName[r.workflow_type]}</div></td>
                  <td className="tnum">{r.decisions_28d}</td><td className="tnum">{r.acceptance_pct === null ? "—" : `${r.acceptance_pct}%`}</td>
                  <td>{r.ready ? <Tag color="green">Ready</Tag> : <Tag>Not yet</Tag>}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">{m.autonomy_readiness[0]?.rule}. Move a ready step to "Agent acts" on the <Link to="/policies" className="text-route underline">policy</Link> screen.</p>
        </Section>
        <Section title="Shadow mode" aside={<Link to="/shadow" className="text-xs text-route hover:underline">Compare</Link>}>
          {m.shadow.total === 0 ? <Empty title="No shadow runs yet">Switch a workflow to shadow mode on the policy screen to compare the agent with how people work today.</Empty> : (
            <table className="table">
              <thead><tr><th>Step</th><th>Compared</th><th>Agreement</th><th></th></tr></thead>
              <tbody>{m.shadow.steps.map((s) => (
                <tr key={s.step}><td>{sentence(s.step)}</td><td className="tnum">{s.matched} / {s.recommended}</td>
                  <td className="tnum">{s.agreement_pct === null ? "—" : `${s.agreement_pct}%`}</td>
                  <td>{s.ready_to_go_live ? <Tag color="green">Ready</Tag> : null}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Section>
        <Section title="Audit log delivery">
          <div className="grid grid-cols-3 p-4 text-center">
            {([["Delivered", m.audit_mirror.sent, ""], ["Waiting", m.audit_mirror.pending, m.audit_mirror.pending > 50 ? "text-signal" : ""], ["Failed", m.audit_mirror.failed, m.audit_mirror.failed ? "text-stop" : ""]] as [string, number, string][]).map(([k, n, c]) => (
              <div key={k}><div className={`font-sign text-2xl font-bold tnum ${c}`}>{n}</div><div className="text-2xs text-ink-soft">{k}</div></div>
            ))}
          </div>
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Every audit record is queued in the same transaction and shipped to the analytics mirror (JSONL or the Databricks Delta table) with retries.
            {m.audit_mirror.failed > 0 && user?.role === "admin" && <> <button className="text-route underline" onClick={async () => { await api.post("/api/audit/mirror/retry"); reload(); }}>Retry failed</button></>}</p>
        </Section>
      </div>

      <Section title="No-show recovery" aside={<Link to="/workflows" className="text-xs text-route hover:underline">See orchestrations</Link>}>
        <div className="grid sm:grid-cols-3 xl:grid-cols-6">
          <Measure label="No-shows handled" now={m.no_show.finished} note={`${m.no_show.orchestrations} started`} />
          <Measure label="Minutes of service freed" now={m.no_show.minutes_freed} better="higher" />
          <Measure label="Standby riders given a seat" now={m.no_show.standby_riders_booked} better="higher" />
          <Measure label="Pickups re-timed" now={m.no_show.pickups_retimed} better="higher" />
          <Measure label="Late pickups avoided" now={m.no_show.late_pickups_avoided} better="higher" />
          <Measure label="Riders flagged for review" now={m.no_show.riders_flagged_for_review} note="Repeat no-shows, 30 days" />
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Section title="In motion" aside={<Link to="/workflows" className="text-xs text-route hover:underline">All orchestrations</Link>}>
          {!active ? <Loading /> : active.length === 0 ? (
            <Empty title="Nothing in motion">Inject a vehicle fault from the <Link className="text-route underline" to="/simulator">simulator</Link> to watch an orchestration run.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {active.map((w) => (
                <li key={w.id}>
                  <Link to={`/workflows/${w.id}`} className="block px-4 py-3 hover:bg-paper/60">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <VehicleId label={w.vehicle_label} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.title.replace(`${w.vehicle_label}: `, "")}</span>
                      <SeverityTag severity={w.severity} /> <StatusBadge status={w.status} />
                    </div>
                    <LineMap steps={w.steps} compact />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-5">
          <Section title="Dispatcher acceptance, last 7 days" aside={<span className="text-2xs text-ink-soft">tracked weekly</span>}>
            {acceptance.length === 0 ? <Empty title="No decisions yet" /> : (
              <table className="table">
                <thead><tr><th>Step</th><th>Approved</th><th>Changed</th><th>Rejected</th><th>Accepted</th></tr></thead>
                <tbody>{acceptance.map(([step, v]) => (
                  <tr key={step}><td>{sentence(step)}</td><td className="tnum">{v.approved}</td><td className="tnum">{v.overridden}</td>
                    <td className="tnum">{v.rejected}</td><td className="tnum font-semibold">{v.acceptance_pct ?? "—"}%</td></tr>
                ))}</tbody>
              </table>
            )}
            {Object.keys(mm.dispatcher_acceptance_weekly || {}).length > 0 && (
              <div className="border-t border-rule px-4 py-2">
                <div className="mb-1 text-2xs font-semibold text-ink-soft">Weekly acceptance, last 8 weeks</div>
                {Object.entries(mm.dispatcher_acceptance_weekly as Record<string, { week: string; acceptance_pct: number }[]>).map(([step, weeks]) => (
                  <div key={step} className="flex items-center gap-2 text-2xs">
                    <span className="w-28 shrink-0">{sentence(step)}</span>
                    <span className="flex items-end gap-0.5" aria-label={`${sentence(step)} weekly acceptance`}>
                      {weeks.map((w) => <span key={w.week} title={`Week of ${w.week}: ${w.acceptance_pct}%`} className="inline-block w-3 rounded-xs bg-route" style={{ height: `${Math.max(3, w.acceptance_pct / 5)}px` }} />)}
                    </span>
                    <span className="tnum text-ink-soft">{weeks[weeks.length - 1]?.acceptance_pct}% this week</span>
                  </div>
                ))}
              </div>
            )}
            <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Steps with steady high acceptance are candidates to move to autonomous in the policy.</p>
          </Section>

          <Section title="Model usage">
            <table className="table">
              <thead><tr><th>Model</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr></thead>
              <tbody>{m.llm_usage.map((u) => (
                <tr key={u.model}><td>{u.model}{u.fallbacks > 0 && <span className="text-2xs text-signal"> ({u.fallbacks} fallback)</span>}</td>
                  <td className="tnum">{u.calls}</td><td className="tnum">{(u.input_tokens + u.output_tokens).toLocaleString()}</td><td className="tnum">${u.cost_usd.toFixed(4)}</td></tr>
              ))}</tbody>
            </table>
          </Section>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Recently finished">
          <ul className="divide-y divide-rule text-sm">
            {(recent || []).filter((w) => w.completed_at).slice(0, 6).map((w) => (
              <li key={w.id} className="flex items-center gap-2 px-4 py-2">
                <VehicleId label={w.vehicle_label} />
                <Link to={`/workflows/${w.id}`} className="min-w-0 flex-1 truncate hover:underline">{w.title.replace(`${w.vehicle_label}: `, "")}</Link>
                <StatusBadge status={w.status} /><span className="text-xs text-ink-faint">{ago(w.completed_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Live activity" aside={<Link to="/events" className="text-xs text-route hover:underline">Event stream</Link>}>
          {last.length === 0 ? <Empty title="Waiting for activity">Updates appear here as products publish events and the agent acts.</Empty> : (
            <ul className="max-h-64 divide-y divide-rule overflow-y-auto text-xs">
              {last.slice(0, 20).map((x, i) => (
                <li key={i} className="flex gap-3 px-4 py-1.5">
                  <span className="tnum text-ink-faint">{new Date(x.at).toLocaleTimeString()}</span>
                  <span className="font-medium">{sentence(x.kind)}</span>
                  <span className="truncate text-ink-soft">{x.data.type || x.data.record_type || x.data.step_status || x.data.status || ""} {x.data.step ? `(${words(x.data.step)})` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
