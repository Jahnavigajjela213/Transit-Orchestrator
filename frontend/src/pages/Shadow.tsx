import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { ago, dayTime, sentence, toLocalInput } from "../lib/format";
import type { ShadowRec } from "../lib/types";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Json, Loading, PageHeader, Section, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

interface StepSummary {
  step: string; recommended: number; matched: number; differed: number; no_action: number; open: number;
  agreement_pct: number | null; median_agent_ahead_minutes: number | null; agent_better: number; human_better: number; same: number;
  ready_to_go_live: boolean;
}

function describe(r: ShadowRec): string {
  const x = r.recommendation || {};
  switch (r.step) {
    case "open_work_order": return `Open a ${x.priority} work order: ${x.title} (${x.fault_code}), shop ${dayTime(x.shop_start)} to ${dayTime(x.shop_end)}`;
    case "pull_vehicle": return `Pull ${x.vehicle_label} ${dayTime(x.from)} to ${dayTime(x.until)}; ${x.runs_affected?.length ?? 0} run(s) affected`;
    case "reassign_runs": return (x.assignments || []).map((a: any) => `${a.route_name} ${a.block_name}: ${a.vehicle_label ?? "no spare"} with ${a.driver_name ?? "no driver"}`).join("; ") || "No cover possible";
    case "notify_riders": return `Message riders on ${x.runs?.length ?? 0} run(s)${x.riders ? `, about ${x.riders} rider(s)` : ""}`;
    case "return_to_service": return `Return ${x.vehicle_label} to service when ${x.work_order_id ?? "the work order"} closes`;
    case "adjust_schedule": return `${sentence(x.mode)}: ${x.reason ?? ""}`;
    default: return sentence(r.step);
  }
}

function timeLeft(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "counts as no action now";
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return `${h ? `${h} h ` : ""}${m} min left before it counts as no action`;
}

const BY_HAND = ["open_work_order", "pull_vehicle", "reassign_runs", "notify_riders", "return_to_service"];

/** Play the person on shift: do this step by hand in the product, starting from the agent's proposal. */
function ByHandForm({ r, onDone }: { r: ShadowRec; onDone: () => void }) {
  const toast = useToast();
  const x = r.recommendation || {};
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState<string>(x.priority ?? "high");
  const [shopStart, setShopStart] = useState(toLocalInput(x.shop_start));
  const [shopEnd, setShopEnd] = useState(toLocalInput(x.shop_end));
  const [from, setFrom] = useState(toLocalInput(x.from));
  const [until, setUntil] = useState(toLocalInput(x.until));
  const [message, setMessage] = useState(`Your ride may be delayed: vehicle ${r.vehicle_label} is out of service and a replacement is on its way.`);
  const plan: any[] = (x.assignments || []).filter((a: any) => a.vehicle_id);
  const [assign, setAssign] = useState<Record<string, { vehicle_id: string; driver_id: string }>>(
    () => Object.fromEntries(plan.map((a) => [a.run_id, { vehicle_id: a.vehicle_id, driver_id: a.driver_id }])));
  const { data: opts } = useData<{ vehicles: { id: string; label: string; type: string; wheelchair: boolean; status: string }[]; drivers: { id: string; label: string }[] }>(
    r.step === "reassign_runs" ? `/api/shadow/${r.id}/options` : null);

  async function submit() {
    setBusy(true);
    const iso = (v: string) => (v ? `${v}:00` : undefined);
    const body: Record<string, unknown> =
      r.step === "open_work_order" ? { priority, shop_start: iso(shopStart), shop_end: iso(shopEnd) }
      : r.step === "pull_vehicle" ? { start: iso(from), end: iso(until) }
      : r.step === "reassign_runs" ? { assignments: Object.entries(assign).map(([run_id, a]) => ({ run_id, ...a })) }
      : r.step === "notify_riders" ? { message } : {};
    try {
      const res = await api.post<{ done: string[] }>(`/api/shadow/${r.id}/by-hand`, body);
      toast(res.done.join("; ") || "Done");
      onDone();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="text-xs text-ink-soft">Do this step <b>by hand in the product</b>, as the person on shift would. The form starts from the agent's proposal: keep it to agree, or change it to see how a different choice scores.</p>
      {r.step === "open_work_order" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="label">Priority</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {["critical", "high", "medium", "low"].map((p) => <option key={p} value={p}>{sentence(p)}{p === x.priority ? " (agent)" : ""}</option>)}
            </select></label>
          <label><span className="label">Shop from</span><input type="datetime-local" className="input" value={shopStart} onChange={(e) => setShopStart(e.target.value)} /></label>
          <label><span className="label">Shop until</span><input type="datetime-local" className="input" value={shopEnd} onChange={(e) => setShopEnd(e.target.value)} /></label>
        </div>
      )}
      {r.step === "pull_vehicle" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Out of service from</span><input type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className="label">Until</span><input type="datetime-local" className="input" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        </div>
      )}
      {r.step === "reassign_runs" && (plan.length === 0 ? <p className="text-xs text-ink-soft">The agent found no cover to compare against.</p> : !opts ? <Loading /> : (
        <table className="table">
          <thead><tr><th>Run</th><th>Agent proposed</th><th>Spare vehicle</th><th>Driver</th></tr></thead>
          <tbody>{plan.map((a) => (
            <tr key={a.run_id}>
              <td className="text-xs">{a.route_name} {a.block_name}<div className="text-2xs text-ink-soft">{a.start_h}{a.needs_wheelchair ? " · wheelchair" : ""}</div></td>
              <td className="text-xs">{a.vehicle_label} with {a.driver_name}</td>
              <td><select className="input" value={assign[a.run_id]?.vehicle_id} onChange={(e) => setAssign({ ...assign, [a.run_id]: { ...assign[a.run_id], vehicle_id: e.target.value } })}>
                {opts.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}{v.wheelchair ? " ♿" : ""}{v.status !== "available" ? " (out of service)" : ""}{v.id === a.vehicle_id ? " (agent)" : ""}</option>)}
              </select></td>
              <td><select className="input" value={assign[a.run_id]?.driver_id} onChange={(e) => setAssign({ ...assign, [a.run_id]: { ...assign[a.run_id], driver_id: e.target.value } })}>
                {opts.drivers.map((d) => <option key={d.id} value={d.id}>{d.label}{d.id === a.driver_id ? " (agent)" : ""}</option>)}
              </select></td>
            </tr>
          ))}</tbody>
        </table>
      ))}
      {r.step === "notify_riders" && (
        <label className="block"><span className="label">Message to riders on {x.runs?.length ?? 0} run(s)</span>
          <textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      )}
      {r.step === "return_to_service" && <p className="text-xs">Put {r.vehicle_label} back on the schedule in trip management.</p>}
      <button className="btn-primary" disabled={busy || (r.step === "reassign_runs" && plan.length === 0)} onClick={submit}>Do it by hand</button>
    </div>
  );
}

export default function Shadow() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);  // the row whose by-hand form is open
  const { data: summary } = useData<{ steps: StepSummary[]; total: number }>("/api/shadow/summary");
  const { data, error, reload } = useData<ShadowRec[]>(`/api/shadow${status ? `?status=${status}` : ""}`, [status]);
  const { data: pol } = useData<{ rules: any }>("/api/policies/vehicle_health");
  const canReview = user?.role === "dispatcher" || user?.role === "shop_manager" || user?.role === "admin";
  const inShadow = pol?.rules?.mode === "shadow";

  async function review(id: string, verdict: string) {
    try { await api.post(`/api/shadow/${id}/review`, { verdict }); toast("Review saved"); reload(); } catch (e: any) { toast(e.message, "error"); }
  }

  async function noAction(id: string) {
    try { await api.post(`/api/shadow/${id}/no-action`); toast("Closed as no action needed"); reload(); } catch (e: any) { toast(e.message, "error"); }
  }

  async function measure() {
    try {
      const r = await api.post<{ sample: number; measured: Record<string, number> }>("/api/metrics/baseline/measure");
      toast(`Baseline measured from ${r.sample} shadow incident(s). See the Overview.`);
    } catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Shadow mode"
        intro="Before go-live the agent runs on real events but takes no action. It records what it would have done; people keep working in the products; this screen puts the two side by side."
        actions={<>
          <Link to="/policies" className="btn-quiet">{inShadow ? "Vehicle health is in shadow mode" : "Turn on shadow mode"}</Link>
          {user?.role === "admin" && <button className="btn-primary" onClick={measure}>Measure Phase 0 baseline from shadow runs</button>}
        </>} />

      <Section title="Agent compared with people, by step">
        {!summary ? <Loading /> : summary.steps.length === 0 ? (
          <Empty title="No shadow runs yet">Set the run mode to Shadow on the <Link to="/policies" className="text-route underline">Autonomy policy</Link> screen, then send a fault from the simulator and handle it by hand in the products (Work orders, Schedule).</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Step</th><th>Recommended</th><th>Matched</th><th>Differed</th><th>No action</th><th>Agreement</th><th>Agent ready earlier by</th><th>Reviews (agent / same / person)</th><th>Ready to go live</th></tr></thead>
              <tbody>{summary.steps.map((s) => (
                <tr key={s.step}>
                  <td className="font-medium">{sentence(s.step)}</td><td className="tnum">{s.recommended}</td><td className="tnum">{s.matched}</td>
                  <td className="tnum">{s.differed}</td><td className="tnum">{s.no_action}</td>
                  <td className="tnum font-semibold">{s.agreement_pct === null ? "—" : `${s.agreement_pct}%`}</td>
                  <td className="tnum">{s.median_agent_ahead_minutes === null ? "—" : `${s.median_agent_ahead_minutes} min (median)`}</td>
                  <td className="tnum">{s.agent_better} / {s.same} / {s.human_better}</td>
                  <td>{s.ready_to_go_live ? <Tag color="green">Ready</Tag> : <Tag>Not yet</Tag>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">"Ready" needs at least 5 compared incidents with 80% or more agreement, and reviewers not preferring the person's choice more often than the agent's. Then move that step from Shadow to Needs approval on the policy screen.</p>
      </Section>

      <div className="flex items-center gap-2">
        <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter">
          <option value="">All recommendations</option><option value="open">Waiting for people to act</option>
          <option value="matched">Matched</option><option value="differed">Differed</option><option value="no_action">No action taken</option>
        </select>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.length === 0 ? <div className="panel"><Empty title="Nothing here yet" /></div> : (
        <div className="panel overflow-x-auto">
          <table className="table">
            <thead><tr><th>When</th><th>Incident</th><th>Step</th><th>Agent would have</th><th>What people did</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>{data.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer align-top hover:bg-paper/60" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="whitespace-nowrap text-xs">{ago(r.recommended_at)}</td>
                  <td><div className="flex items-center gap-1.5"><VehicleId label={r.vehicle_label} /><SeverityTag severity={r.severity ?? null} /></div>
                    <Link to={`/workflows/${r.workflow_id}`} onClick={(e) => e.stopPropagation()} className="text-2xs text-route hover:underline">{r.workflow_title}</Link></td>
                  <td className="text-sm">{sentence(r.step)}</td>
                  <td className="max-w-sm text-xs">{describe(r)}</td>
                  <td className="max-w-xs text-xs text-ink-soft">
                    {r.comparison.length > 0 ? r.comparison.map((c, i) => (
                      <div key={i} className="mb-1">
                        {r.comparison.length > 1 && <div className="text-2xs font-semibold text-ink">{c.item}</div>}
                        <div>Agent: <span className="text-ink">{c.agent}</span></div>
                        <div>Person: <span className="text-ink">{c.person}</span>{c.score !== null && <span className={`ml-1 tnum font-semibold ${c.score >= 75 ? "text-go" : "text-signal"}`}>{c.score}%</span>}</div>
                      </div>
                    )) : r.status === "open" ? (
                      <><div>Waiting for a person to act</div><div className="text-2xs text-ink-faint">{timeLeft(r.no_action_at)}</div></>
                    ) : r.status === "no_action" ? (
                      <div>{r.review_note ?? "Nobody did this step within a day"}{r.reviewed_by && r.review_note ? ` (${r.reviewed_by})` : ""}</div>
                    ) : "—"}
                    {r.human_actions.length > 0 && <div className="mt-0.5 text-2xs">{r.human_actions.map((h) => `${h.detail}${h.by ? ` (${h.by})` : ""}`).join("; ")}</div>}
                    {r.agent_ahead_minutes !== null && <div className="mt-0.5 text-2xs text-go">Agent was ready {r.agent_ahead_minutes} min earlier</div>}
                  </td>
                  <td><StatusBadge status={r.status} />{r.agreement_pct !== null && <div className="text-2xs tnum text-ink-soft">{r.agreement_pct}% agreement</div>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.status === "open" && canReview && (
                      <div className="mb-1.5 flex flex-col gap-1">
                        {BY_HAND.includes(r.step) && <button className="btn-primary px-2 py-0.5 text-2xs" onClick={() => setActing(acting === r.id ? null : r.id)}>{acting === r.id ? "Close form" : "Do it by hand"}</button>}
                        <button className="btn-quiet px-2 py-0.5 text-2xs" onClick={() => noAction(r.id)}>No action needed</button>
                      </div>
                    )}
                    {r.status !== "open" && (r.verdict ? <Tag color={r.verdict === "human_better" ? "amber" : "green"}>{r.verdict === "agent_better" ? "Agent better" : r.verdict === "human_better" ? "Person better" : "Same"}</Tag> : canReview && (
                      <div className="flex flex-col gap-1">
                        {[["agent_better", "Agent better"], ["same", "Same"], ["human_better", "Person better"]].map(([v, l]) => (
                          <button key={v} className="btn-quiet px-2 py-0.5 text-2xs" onClick={() => review(r.id, v)}>{l}</button>
                        ))}
                      </div>
                    ))}
                  </td>
                </tr>
                {acting === r.id && <tr><td colSpan={7} className="bg-route-tint/30"><ByHandForm r={r} onDone={() => { setActing(null); reload(); }} /></td></tr>}
                {open === r.id && <tr><td colSpan={7} className="bg-paper/50"><Json value={{ recommendation: r.recommendation, human_actions: r.human_actions, review: { by: r.reviewed_by, note: r.review_note } }} /></td></tr>}
              </Fragment>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
