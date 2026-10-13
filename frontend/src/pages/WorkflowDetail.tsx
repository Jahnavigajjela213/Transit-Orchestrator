import { useState, type FormEvent } from "react";
import { Sources, type Source } from "../components/Sources";
import { Thinking, TypeOut } from "../components/Typing";
import { Link, useParams } from "react-router-dom";
import { Bot, Send, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, kindLabel, modeName, roleName, seconds, sentence, time, words, workflowName } from "../lib/format";
import type { Delegation, WorkflowDetail as WD } from "../lib/types";
import LineMap from "../components/LineMap";
import DecisionCard from "../components/DecisionCard";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Json, KeyVal, LevelTag, Loading, Section, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

const actorColor: Record<string, "teal" | "amber" | "grey" | "green"> = { agent: "teal", human: "amber", product: "grey", system: "grey" };

export default function WorkflowDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data: wf, error, reload } = useData<WD>(`/api/workflows/${id}`, [id]);
  const [q, setQ] = useState("");
  const [answers, setAnswers] = useState<{ id: number; q: string; a: string; model: string; sources: Source[] }[]>([]);
  const [asking, setAsking] = useState(""); // the question being answered

  if (error) return <ErrorNote message={error} />;
  if (!wf) return <Loading />;

  const a = wf.context?.assessment;
  const isNoShow = wf.workflow_type === "no_show_recovery";
  const wo = wf.checkpoint.work_order;
  const pending = wf.approvals.filter((x) => x.status === "pending");
  const canCloseWo = wo && wf.status === "awaiting_event" && (user?.role === "shop_manager" || user?.role === "admin");

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setAsking(q);
    try {
      const r = await api.post<{ answer: string; model: string; sources: Source[] }>("/api/assistant/ask", {
        question: q, workflow_id: wf!.id,
        // the last 5 questions on this page (newest are first in the list), so follow-ups keep their context
        history: answers.slice(0, 5).reverse().map((x) => ({ question: x.q, answer: x.a, workflow_id: wf!.id })),
      });
      setAnswers((x) => [{ id: Date.now(), q, a: r.answer, model: r.model, sources: r.sources }, ...x]);
      setQ("");
    } catch (err: any) { toast(err.message, "error"); } finally { setAsking(""); }
  }

  async function closeWo() {
    try {
      await api.post(`/products/asset-mgmt/work-orders/${wo!.work_order_id}/close`, { resolution: "Repaired and road tested" });
      toast(`Closed ${wo!.work_order_id}. The agent will return ${wf!.vehicle_label} to service.`);
      reload();
    } catch (err: any) { toast(err.message, "error"); }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link to="/workflows" className="text-xs text-route hover:underline">Orchestrations</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <VehicleId label={wf.vehicle_label} size="lg" />
          <h1 className="min-w-0 flex-1 text-2xl font-bold leading-tight">{wf.title.replace(`${wf.vehicle_label}: `, "")}</h1>
          <SeverityTag severity={wf.severity} /><StatusBadge status={wf.status} />
        </div>
      </div>

      <section className="panel px-4 pb-5 pt-6"><LineMap steps={wf.steps} /></section>

      {pending.map((p) => <DecisionCard key={p.id} item={p} onDone={reload} />)}

      {canCloseWo && (
        <div className="panel flex flex-wrap items-center gap-3 border-l-4 border-l-route px-4 py-3 text-sm">
          <Wrench className="h-4 w-4 text-route" aria-hidden />
          <span className="flex-1">{wf.vehicle_label} is in the shop on {wo!.work_order_id}. Closing the work order lets the agent return it to service.</span>
          <button className="btn-primary" onClick={closeWo}>Close work order</button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="Assessment" aside={<Tag>{workflowName[wf.workflow_type]}</Tag>}>
            <div className="space-y-4 p-4">
              <p className="text-sm leading-relaxed">{wf.summary || "Assessment in progress."}</p>
              {a && isNoShow && (
                <KeyVal items={[
                  ["Missed pickup", `${a.missed.rider_name}, ${time(a.missed.pickup_time)} at ${a.missed.pickup_stop} (${a.kind === "no_show" ? "no-show" : "late cancellation"})`],
                  ["Run", `${a.run.route_name} ${a.run.block_name}, ${a.run.vehicle_label} with ${a.run.driver_name}`],
                  ["Running late", a.run.delay_minutes ? `${a.run.delay_minutes} min` : "No"],
                  ["Time freed", `${a.minutes_saved} min`],
                  ["Seats free", `${a.seats_free} seat(s), ${a.wheelchair_free} wheelchair position(s)`],
                  ["Standby riders that fit", `${a.candidates.length}${a.rejected_candidates?.length ? `, ${a.rejected_candidates.length} ruled out` : ""}`],
                  ["Recommendation", `${modeName[a.mode]}: ${a.reason}`],
                  ["Rider's no-shows, 30 days", `${a.rider_no_shows_30d}${a.flag_rider ? " (meets review threshold)" : ""}`],
                  ["Model", a.model],
                ]} />
              )}
              {a && !isNoShow && (
                <KeyVal items={[
                  ["Fault", `${a.fault.description} (${a.fault.code}, ${a.fault.system})`],
                  ["Vehicle", `${a.vehicle.vehicle_type}, ${a.vehicle.capacity} seats, ${a.vehicle.wheelchair_positions} wheelchair positions, ${a.vehicle.depot}`],
                  ["Asset", `${a.health.year} ${a.health.make} ${a.health.model}, ${a.health.odometer?.toLocaleString()} mi, PM ${a.health.pm_miles_over >= 0 ? `${a.health.pm_miles_over} mi overdue` : "current"}`],
                  ["Timing", a.timing_reason],
                  ["Out of service", `${dayTime(a.oos_from)} to ${dayTime(a.oos_until)}`],
                  ["Runs at risk", `${a.runs_at_risk.length}${a.later_runs?.length ? `, plus ${a.later_runs.length} beyond the planning horizon` : ""}`],
                  ["Safety (Vestige)", a.safety ? [
                    a.safety.open_defects?.length ? `${a.safety.open_defects.length} open defect(s) already` : "No open defects",
                    a.safety.will_log_defect ? "defect will be recorded with the work order" : null,
                    a.safety.noncompliant_drivers?.length ? `${a.safety.noncompliant_drivers.length} driver(s) excluded as out of compliance` : null,
                  ].filter(Boolean).join("; ") : "—"],
                  ["Model", a.model],
                ]} />
              )}
              {a?.safety?.noncompliant_drivers?.length > 0 && (
                <details className="text-xs"><summary className="cursor-pointer text-route">Drivers the safety agent ruled out</summary>
                  <ul className="mt-1 space-y-0.5">{a.safety.noncompliant_drivers.map((d: any) => <li key={d.driver_id}><span className="font-medium">{d.name}</span>: {d.reasons.join("; ")}</li>)}</ul>
                </details>
              )}
            </div>
          </Section>

          {isNoShow && wf.context?.recovery && (
            <Section title="Recovery">
              <div className="grid gap-4 p-4 sm:grid-cols-4">
                {[["Outcome", sentence(modeName[wf.context.recovery.mode] ?? wf.context.recovery.mode)],
                  ["Standby rider booked", wf.context.recovery.standby_booked ? wf.context.recovery.standby_rider : "No"],
                  ["Pickups re-timed", String(wf.context.recovery.pickups_moved)],
                  ["Late pickups", `${wf.context.recovery.late_before} to ${wf.context.recovery.late_after}`]].map(([k, v]) => (
                  <div key={k}><div className="text-2xs text-ink-soft">{k}</div><div className="font-sign font-bold">{v}</div></div>
                ))}
              </div>
            </Section>
          )}

          {isNoShow && (wf.checkpoint.adjustment?.changes?.filter((x: any) => x.change_min !== 0).length ?? 0) > 0 && (
            <Section title="Pickup times changed">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Rider</th><th>Scheduled</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>{wf.checkpoint.adjustment!.changes.filter((x: any) => x.change_min !== 0).map((x: any) => (
                    <tr key={x.trip_id}><td>{x.rider_name}<div className="text-2xs text-ink-soft">{x.pickup_stop}</div></td>
                      <td className="tnum">{time(x.pickup_time)}</td><td className="tnum">{time(x.eta_before)}</td>
                      <td className="tnum font-semibold">{time(x.eta_after)} <span className="text-2xs font-normal text-ink-soft">({x.change_min > 0 ? "+" : ""}{x.change_min} min)</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>
          )}

          {(wf.checkpoint.assignments?.length ?? 0) > 0 && (
            <Section title="Runs covered">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Run</th><th>Starts</th><th>Riders</th><th>Now on</th><th>Driver</th><th>Delay</th></tr></thead>
                  <tbody>{wf.checkpoint.assignments!.map((x: any) => (
                    <tr key={x.run_id}><td>{x.route_name} <span className="text-2xs text-ink-soft">{x.block_name}</span></td>
                      <td className="tnum">{dayTime(x.start)}</td><td className="tnum">{x.riders}</td>
                      <td><VehicleId label={x.vehicle_label} /></td><td>{x.driver_name}</td>
                      <td className="tnum">{x.delay_minutes ? `+${x.delay_minutes} min` : "None"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Section>
          )}

          {wf.shadow?.length > 0 && (
            <Section title="Shadow run: what the agent would have done" aside={<Link to="/shadow" className="text-xs text-route hover:underline">Shadow mode</Link>}>
              <ul className="divide-y divide-rule text-sm">
                {wf.shadow.map((r) => (
                  <li key={r.id} className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{sentence(r.step)}</span><StatusBadge status={r.status} />
                      {r.agreement_pct !== null && <span className="text-2xs text-ink-soft tnum">{r.agreement_pct}% agreement</span>}
                      {r.agent_ahead_minutes !== null && <span className="text-2xs text-go">agent ready {r.agent_ahead_minutes} min earlier</span>}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">People: {r.human_actions.length ? r.human_actions.map((h) => `${h.detail}${h.by ? ` (${h.by})` : ""}`).join("; ") : "nothing yet"}</div>
                    <details className="mt-0.5 text-xs"><summary className="cursor-pointer text-route">Agent's recommendation</summary><div className="mt-1"><Json value={r.recommendation} /></div></details>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(wf.context?.manual_entries?.length ?? 0) > 0 && (
            <Section title={`Done by hand in the products (${wf.context.manual_entries.length})`}>
              <ul className="divide-y divide-rule text-sm">
                {wf.context.manual_entries.map((m: any) => (
                  <li key={m.event_id} className="flex flex-wrap gap-2 px-4 py-2"><span className="tnum text-xs text-ink-faint">{seconds(m.at)}</span>
                    <span>{m.detail}</span>{m.by && <Tag color="amber">{m.by}</Tag>}</li>
                ))}
              </ul>
              <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Each of these is a manual entry in a product system; the Overview counts them as manual re-entry per incident.</p>
            </Section>
          )}

          {wf.checkpoint.failure && (
            <Section title="What went wrong">
              <div className="space-y-2 p-4 text-sm">
                <p><Tag color="red">{sentence(wf.checkpoint.failure.step)} failed</Tag> {wf.checkpoint.failure.message}</p>
                {(wf.checkpoint.compensation?.length ?? 0) > 0 && (
                  <p className="text-ink-soft">Rolled back: {wf.checkpoint.compensation!.map((c: any) => words(c.action)).join(", ")}.</p>
                )}
              </div>
            </Section>
          )}

          <Section title={`Rider messages (${wf.notification_count})`} aside={<Link to={`/riders?workflow=${wf.id}`} className="text-xs text-route hover:underline">See all</Link>}>
            {wf.notifications.length === 0 ? <Empty title="No rider messages for this orchestration" /> : (
              <ul className="divide-y divide-rule text-sm">
                {wf.notifications.slice(0, 6).map((n) => (
                  <li key={n.id} className="px-4 py-2">
                    <div className="flex items-center gap-2 text-xs text-ink-soft"><span className="font-medium text-ink">{n.rider_name}</span>
                      <Tag>{n.channel}</Tag><Tag>{n.language}</Tag><span>{kindLabel(n.kind)}</span></div>
                    <p className="mt-0.5">{n.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Ask about this orchestration">
            <form onSubmit={ask} className="flex gap-2 p-4">
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={isNoShow ? "What did the agent change and why?" : `Why was ${wf.vehicle_label} pulled?`} aria-label="Question" />
              <button className="btn-primary" disabled={!!asking} aria-label="Ask"><Send className="h-4 w-4" aria-hidden /></button>
            </form>
            {asking && (
              <div className="border-t border-rule px-4 py-3 text-sm">
                <p className="font-medium">{asking}</p>
                <p className="mt-1 flex gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-route" aria-hidden /><Thinking /></p>
              </div>
            )}
            {answers.map((x) => (
              <div key={x.id} className="border-t border-rule px-4 py-3 text-sm">
                <p className="font-medium">{x.q}</p>
                <div className="mt-1 flex gap-2 leading-relaxed text-ink-soft"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-route" aria-hidden />
                  <div className="whitespace-pre-wrap"><TypeOut text={x.a} after={<Sources sources={x.sources} />} /></div>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Facts">
            <div className="p-4">
              <KeyVal items={[
                ["Triggered by", wf.trigger_event ? `${wf.trigger_event.type} from ${wf.trigger_event.source}` : wf.trigger_type],
                ["Detected", dayTime(wf.detected_at)],
                ...(isNoShow ? [["Trip", wf.trigger_event?.data?.trip_id], ["Run", wf.trigger_event?.data?.run_id]] as [string, any][] : [
                  ["Work order", wo ? `${wo.work_order_id} (${wo.depot})` : "—"],
                  ["Vestige defect", wf.checkpoint.defect ? wf.checkpoint.defect.defect_id : wf.checkpoint.safety_alert ? `Not recorded: ${wf.checkpoint.safety_alert}` : "—"],
                  ["Work order opened", dayTime(wf.work_order_opened_at)],
                  ["Pulled", dayTime(wf.pulled_at)],
                  ["Returned", dayTime(wf.returned_at)],
                ] as [string, any][]),
                ["Approvals given", wf.human_touches],
                ["Trace ID", <code className="text-xs">{wf.trace_id}</code>],
                ["Paused at", wf.checkpoint.next.join(", ") || "—"],
              ]} />
              {wf.trigger_event && (
                <details className="mt-3 text-xs"><summary className="cursor-pointer text-route">Triggering event</summary><div className="mt-2"><Json value={wf.trigger_event} /></div></details>
              )}
            </div>
          </Section>

          <AgentsPanel plan={wf.context?.agent_plan} delegations={wf.context?.delegations} />

          <Section title="Decision trail" aside={<button className="text-xs text-route hover:underline" onClick={() => api.download(`/api/audit/export?format=jsonl&workflow_id=${wf.id}`, `audit_${wf.id}.jsonl`)}>Export</button>}>
            <ol className="relative max-h-[640px] overflow-y-auto px-4 py-3">
              {wf.audit.map((r) => (
                <li key={r.id} className="relative border-l-2 border-rule pb-4 pl-4 last:pb-0">
                  <span className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ${r.actor_type === "human" ? "bg-signal" : r.record_type.includes("fail") || r.record_type === "compensation" ? "bg-stop" : "bg-route"}`} aria-hidden />
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-soft">
                    <span className="tnum">{seconds(r.created_at)}</span>
                    <Tag color={actorColor[r.actor_type] ?? "grey"}>{r.actor}</Tag>
                    <span className="font-semibold text-ink">{sentence(r.record_type)}</span>
                    {r.step && <span>{words(r.step)}</span>}
                    <LevelTag level={r.autonomy_level} />
                  </div>
                  {r.explanation && <p className="mt-1 text-sm leading-snug">{r.explanation}</p>}
                  {(Object.keys(r.data_considered).length > 0 || Object.keys(r.recommendation).length > 0) && (
                    <details className="mt-1 text-xs"><summary className="cursor-pointer text-route">Record</summary>
                      <div className="mt-1"><Json value={{ data_considered: r.data_considered, recommendation: r.recommendation, model: r.model_used, outcome: r.outcome }} /></div></details>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}


function AgentsPanel({ plan, delegations }: { plan?: { step: string; agents: { agent: string; key: string; task: string; product: string }[] }[]; delegations?: Delegation[] }) {
  if (!plan && !delegations?.length) return null;
  return (
    <Section title="Agents" aside={<span className="text-2xs text-ink-soft">Supervisor delegates each product task to its domain agent</span>}>
      {plan && (
        <ul className="space-y-1 border-b border-rule px-4 py-3 text-xs">
          {plan.map((p) => (
            <li key={p.step} className="flex flex-wrap gap-1.5"><span className="w-32 shrink-0 font-semibold">{sentence(p.step)}</span>
              {p.agents.map((a) => <Tag key={a.key + a.task} color="teal" title={`${a.product}: ${a.task}`}>{a.agent}</Tag>)}</li>
          ))}
        </ul>
      )}
      {delegations && delegations.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="table text-xs">
            <thead><tr><th>Time</th><th>Agent</th><th>Task</th><th>For persona</th><th>Took</th></tr></thead>
            <tbody>{delegations.map((d, i) => (
              <tr key={i} className={d.status === "failed" ? "bg-stop-tint/40" : ""}>
                <td className="tnum">{seconds(d.at)}</td><td>{d.agent}</td>
                <td>{sentence(d.task)}<div className="text-2xs text-ink-faint">{sentence(d.step)}{d.requires.length ? ` · needs ${d.requires.join(", ")}` : ""}</div>
                  {d.error && <div className="text-2xs text-stop">{d.error}</div>}</td>
                <td>{roleName[d.persona] ?? d.persona}</td><td className="tnum">{d.duration_ms} ms</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
