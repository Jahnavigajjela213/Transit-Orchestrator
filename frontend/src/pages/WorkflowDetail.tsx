import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Check, Download, Eye, Inbox, Radio, Sparkles, Wrench, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, kindLabel, roleName, seconds, sentence, time, words } from "../lib/format";
import type { AuditRecord, Delegation, WorkflowDetail as WD } from "../lib/types";
import AgentFlow from "../components/AgentFlow";
import { Drawer, DrawerLink } from "../components/focus";
import { useToast } from "../components/Toast";
import { ErrorNote, Json, KeyVal, LevelTag, Loading, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

/* One orchestration: where the vehicle is on the seven pilot steps, the one thing to do now, and the decision trail.
   Everything else (assessment, connected systems, domain agents, affected runs, rider messages, the full record) opens in a drawer. */

type DrawerKey = "assessment" | "systems" | "agents" | "runs" | "riders" | "trail" | "shadow" | "record";

export default function WorkflowDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [drawer, setDrawer] = useState<{ k: DrawerKey; rec?: AuditRecord } | null>(null);
  const { data: wf, error, reload } = useData<WD>(`/api/workflows/${id}`, [id]);

  if (error) return <div className="p-8"><ErrorNote message={error} /></div>;
  if (!wf) return <Loading />;

  const wo = wf.checkpoint.work_order;
  const pending = wf.approvals.filter((x) => x.status === "pending");
  const woStatus = wf.work_order_status;  // live from maintenance: the shop must start work before closing
  const isShop = user?.role === "shop_manager" || user?.role === "admin";
  const title = wf.title.replace(`${wf.vehicle_label}: `, "");
  const delegations: Delegation[] = wf.context?.delegations || [];
  const story = [...wf.audit].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const open = !["completed", "completed_with_issues", "rejected", "compensated", "failed"].includes(wf.status);

  async function shopAction(action: "start" | "close") {
    try {
      await api.post(`/products/asset-mgmt/work-orders/${wo!.work_order_id}/${action}`, action === "close" ? { resolution: "Repaired and road tested" } : {});
      toast(action === "start" ? `Work started on ${wo!.work_order_id}.` : `Closed ${wo!.work_order_id}. The agent returns ${wf!.vehicle_label} to service.`);
      reload();
    } catch (err: any) { toast(err.message, "error"); }
  }

  // the one thing that happens next
  let now: ReactNode;
  if (pending.length) {
    const p = pending[0], esc = p.kind === "escalation";
    now = <Now tone={esc ? "red" : "amber"} icon={esc ? AlertTriangle : Inbox} title={esc ? "Now: a person needs to finish a step" : "Now: waiting for a decision"} text={p.title}
      action={<Link to={`/?decision=${p.id}`} className="btn-primary h-11 px-6">Decide now</Link>} />;
  } else if (wf.checkpoint.failure) {
    now = <Now tone="red" icon={AlertTriangle} title={`${sentence(wf.checkpoint.failure.step)} failed`}
      text={<>{wf.checkpoint.failure.message}{(wf.checkpoint.compensation?.length ?? 0) > 0 && <> Rolled back: {wf.checkpoint.compensation!.map((c: any) => words(c.action)).join(", ")}.</>}</>} />;
  } else if (wo && wf.status === "awaiting_event") {
    now = <Now tone="blue" icon={Wrench} title={woStatus === "in_progress" ? "Now: the shop is working on it" : woStatus === "open" ? "Now: waiting for the shop to start" : "Now: checking maintenance…"}
      text={<>{wo.work_order_id} is {woStatus === "in_progress" ? "in progress" : "open"} at {wo.depot}. {woStatus === "in_progress" ? `Closing it puts ${wf.vehicle_label} back on the schedule automatically.` : "The shop starts work first, then closes it."}{!isShop && " The shop manager does this."}</>}
      action={isShop && woStatus === "open" ? <button className="btn-primary h-11 px-6" onClick={() => shopAction("start")}>Start work</button>
        : isShop && woStatus === "in_progress" ? <button className="btn-primary h-11 px-6" onClick={() => shopAction("close")}>Close work order</button> : null} />;
  } else if (wf.status === "completed" || wf.status === "completed_with_issues") {
    now = <Now tone="green" icon={Check} title={wf.status === "completed" ? "Back in service" : "Finished, with issues"} text={wf.returned_at ? `${wf.vehicle_label} returned to the schedule ${dayTime(wf.returned_at)}.` : "Nothing left to do."} />;
  } else if (wf.status === "rejected") {
    now = <Now tone="grey" icon={X} title="Stopped" text="A person rejected a step, so the agent stopped. Earlier steps stay as they are." />;
  } else if (wf.status === "shadow") {
    now = <Now tone="teal" icon={Eye} title="Shadow run" text="The agent recorded what it would do at each step and took no action. Compare it with what people did." action={<Link to="/shadow" className="btn-quiet h-11">Compare in shadow mode</Link>} />;
  } else {
    now = <Now tone="teal" icon={Sparkles} title="The agent is working" text="Nothing needs you right now." />;
  }

  return (
    <div className="flex w-full max-w-[1240px] flex-col gap-7 px-4 py-6 sm:px-10 sm:py-8">
      <div className="flex flex-col gap-3.5">
        <nav aria-label="Breadcrumb" className="text-[13px] text-ink-faint"><Link to="/workflows" className="hover:text-ink">Orchestrations</Link> / <span className="text-ink">{wf.vehicle_label}</span></nav>
        <div className="flex flex-wrap items-center gap-4">
          <VehicleId label={wf.vehicle_label} size="lg" />
          <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
          <SeverityTag severity={wf.severity} /><StatusBadge status={wf.status} />
          <span className="flex-1" />
          <button className="btn-quiet" onClick={() => api.download(`/api/audit/export?format=jsonl&workflow_id=${wf.id}`, `record_${wf.vehicle_label}.jsonl`)}>
            <Download className="h-4 w-4" aria-hidden /> Export record
          </button>
        </div>
      </div>

      <div className="pt-2"><AgentFlow steps={wf.steps} delegations={delegations} workflowType={wf.workflow_type} /></div>

      {now}

      <div className="flex flex-wrap gap-12">
        <section aria-labelledby="story" className="min-w-0 flex-[999_1_520px]">
          <h2 id="story" className="mb-[18px] text-[15px] font-semibold">Decision trail</h2>
          <ol>
            {story.map((r, i) => <StoryItem key={r.id} r={r} last={i === story.length - 1 && !open} onOpen={() => setDrawer({ k: "record", rec: r })} />)}
            {open && (
              <li className="grid grid-cols-[64px_28px_1fr] gap-3">
                <span className="pt-[3px] font-mono text-[13px] text-[#22578F]">now</span>
                <span className="h-7 w-7 rounded-full border-2 border-dashed border-shop bg-shop-tint" aria-hidden />
                <p className="text-[15px] text-[#22578F]">{pending.length ? "Waiting for a person to decide." : wf.status === "awaiting_event" ? "Waiting for the shop to close the work order." : "The agent is on the next step…"}</p>
              </li>
            )}
          </ol>
        </section>

        <aside aria-label="At a glance" className="flex min-w-0 flex-[1_1_280px] flex-col gap-6">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
            <dt className="text-ink-faint">Detected</dt><dd>{dayTime(wf.detected_at)}</dd>
            <dt className="text-ink-faint">Work order</dt><dd className="font-mono text-[13px]">{wo ? wo.work_order_id : "—"}</dd>
            <dt className="text-ink-faint">Runs covered</dt><dd className="font-mono">{wf.runs_covered} of {wf.runs_at_risk}</dd>
            <dt className="text-ink-faint">Approvals</dt><dd className="font-mono">{wf.human_touches}</dd>
            <dt className="text-ink-faint">Riders notified</dt><dd className="font-mono">{wf.notification_count}</dd>
          </dl>
          <div className="border-t border-rule">
            <DrawerLink label="Assessment" onClick={() => setDrawer({ k: "assessment" })} />
            <DrawerLink label="Connected systems" count={6} onClick={() => setDrawer({ k: "systems" })} />
            <DrawerLink label="Domain agents" count={`${delegations.length} tasks`} onClick={() => setDrawer({ k: "agents" })} />
            <DrawerLink label="Affected runs" count={wf.runs_at_risk} onClick={() => setDrawer({ k: "runs" })} />
            <DrawerLink label="Rider messages" count={wf.notification_count} onClick={() => setDrawer({ k: "riders" })} />
            {wf.shadow?.length > 0 && <DrawerLink label="Shadow run" count={wf.shadow.length} onClick={() => setDrawer({ k: "shadow" })} />}
            <DrawerLink label="Full decision record" count={wf.audit.length} onClick={() => setDrawer({ k: "trail" })} />
          </div>
          <Link to={`/assistant?q=${encodeURIComponent(`Why did the orchestrator act on ${wf.vehicle_label ?? "this vehicle"} the way it did?`)}`}
            className="inline-flex items-center gap-2 self-start rounded-full bg-route-tint px-4 py-2 text-sm font-medium text-route-dark hover:bg-route-tint/70">
            <Sparkles className="h-4 w-4" aria-hidden /> Ask the TransitTech Assistant
          </Link>
          <p className="text-xs text-ink-faint">Click any station on the line to see which domain agents work on that step.</p>
        </aside>
      </div>

      {drawer && <IncidentDrawer wf={wf} k={drawer.k} rec={drawer.rec} delegations={delegations} onClose={() => setDrawer(null)} openRecord={(rec) => setDrawer({ k: "record", rec })} />}
    </div>
  );
}

const nowTone: Record<string, string> = {
  amber: "bg-signal-tint text-[#8A5A00]", red: "bg-stop-tint text-stop", blue: "bg-shop-tint text-shop", green: "bg-go-tint text-go", teal: "bg-route-tint text-route", grey: "bg-[#F3F5F6] text-ink-faint",
};
function Now({ tone, icon: Icon, title, text, action }: { tone: string; icon: any; title: string; text: ReactNode; action?: ReactNode }) {
  const [bg] = nowTone[tone].split(" ");
  return (
    <section aria-label="What happens now" className={`flex flex-wrap items-center gap-5 rounded-2xl px-6 py-5 ${bg}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white ${nowTone[tone].split(" ")[1]}`}><Icon className="h-[22px] w-[22px]" aria-hidden /></span>
      <div className="min-w-0 flex-[1_1_300px]">
        <div className="text-base font-semibold">{title}</div>
        <div className="mt-1 text-sm text-ink-soft">{text}</div>
      </div>
      {action}
    </section>
  );
}

/** A record as one readable sentence; people's actions are recorded without an explanation. */
export function storyText(r: AuditRecord) {
  if (r.explanation) return r.explanation;
  if (r.human_action) return `${r.actor} ${r.human_action}${r.step ? `: ${words(r.step)}` : ""}${r.outcome && r.outcome !== r.human_action ? ` (${words(r.outcome)})` : ""}.`;
  return sentence(r.record_type);
}

function StoryItem({ r, last, onOpen }: { r: AuditRecord; last: boolean; onOpen: () => void }) {
  const bad = r.record_type.includes("fail") || r.record_type === "compensation" || r.outcome === "escalated";
  const av = bad ? "bg-stop-tint text-stop" : r.actor_type === "human" ? "bg-signal-tint text-[#8A5A00]" : r.actor_type === "agent" ? "bg-route-tint text-route" : "bg-[#F3F5F6] text-ink-faint";
  const initials = r.actor.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <li className="relative grid grid-cols-[64px_28px_1fr] gap-3 pb-5">
      {!last && <span className="absolute bottom-0.5 left-[89px] top-[30px] w-px bg-rule" aria-hidden />}
      <span className="pt-[3px] font-mono text-[13px] text-ink-faint">{time(r.created_at)}</span>
      <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${av}`}>
        {bad ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : r.actor_type === "human" ? initials : r.actor_type === "agent" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : <Radio className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <div className="min-w-0">
        <p className="line-clamp-3 text-[15px]">{storyText(r)}</p>
        <p className="mt-1 text-xs text-ink-faint">
          {r.actor}{r.step ? ` · ${words(r.step)}` : ""} · <button className="text-route hover:underline" onClick={onOpen}>details</button>
        </p>
      </div>
    </li>
  );
}

function IncidentDrawer({ wf, k, rec, delegations, onClose, openRecord }: {
  wf: WD; k: DrawerKey; rec?: AuditRecord; delegations: Delegation[]; onClose: () => void; openRecord: (r: AuditRecord) => void;
}) {
  const a = wf.context?.assessment;
  const sub = `${wf.vehicle_label} · ${wf.title.replace(`${wf.vehicle_label}: `, "")}`;
  if (k === "assessment") return (
    <Drawer title="Assessment" subtitle={sub} onClose={onClose}>
      <p className="text-[15px] leading-relaxed">{wf.summary || "Assessment in progress."}</p>
      {a && (
        <div className="border-y border-rule py-5">
          <KeyVal items={[
            ["Fault", `${a.fault.description} (${a.fault.code}, ${a.fault.system})`],
            ["Vehicle", `${a.vehicle.vehicle_type}, ${a.vehicle.capacity} seats, ${a.vehicle.wheelchair_positions} wheelchair positions, ${a.vehicle.depot}`],
            ["Asset", `${a.health.year} ${a.health.make} ${a.health.model}, ${a.health.odometer?.toLocaleString()} mi, PM ${a.health.pm_miles_over >= 0 ? `${a.health.pm_miles_over} mi overdue` : "current"}`],
            ["Timing", a.timing_reason],
            ["Out of service", `${dayTime(a.oos_from)} to ${dayTime(a.oos_until)}`],
            ["Runs at risk", `${a.runs_at_risk.length}${a.later_runs?.length ? `, plus ${a.later_runs.length} beyond the planning horizon` : ""}`],
            ["Safety", a.safety ? [a.safety.open_defects?.length ? `${a.safety.open_defects.length} open defect(s) already` : "No open defects",
              a.safety.will_log_defect ? "defect recorded with the work order" : null,
              a.safety.noncompliant_drivers?.length ? `${a.safety.noncompliant_drivers.length} driver(s) excluded as out of compliance` : null].filter(Boolean).join("; ") : "—"],
            ["Model", <code className="font-mono text-xs">{a.model}</code>],
          ]} />
        </div>
      )}
      <h3 className="text-sm font-semibold">Timeline</h3>
      <KeyVal dense items={[
        ["Triggered by", wf.trigger_event ? `${wf.trigger_event.type} from ${wf.trigger_event.source}` : wf.trigger_type],
        ["Work order opened", wf.checkpoint.work_order ? `${dayTime(wf.work_order_opened_at)} · ${wf.checkpoint.work_order.depot}` : "—"],
        ["Vehicle pulled", dayTime(wf.pulled_at)],
        ["Returned to service", dayTime(wf.returned_at)],
        ["Safety defect", wf.checkpoint.defect ? wf.checkpoint.defect.defect_id : wf.checkpoint.safety_alert ? `Not recorded: ${wf.checkpoint.safety_alert}` : "—"],
        ["Trace", <code className="font-mono text-xs">{wf.trace_id}</code>],
      ]} />
      {wf.trigger_event && <details className="text-sm"><summary className="cursor-pointer font-medium text-route">Triggering event</summary><div className="mt-2"><Json value={wf.trigger_event} /></div></details>}
    </Drawer>
  );
  if (k === "agents") {
    const plan: { step: string; agents: { agent: string; key: string; task: string; product: string }[] }[] | undefined = wf.context?.agent_plan;
    return (
      <Drawer title="Domain agents" subtitle="The orchestrator agent (LangGraph supervisor) hands each product task to its domain agent, acting with a persona's permissions." onClose={onClose} wide>
        {plan && (
          <ul className="divide-y divide-rule rounded-xl border border-rule">
            {plan.map((p) => (
              <li key={p.step} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="w-40 shrink-0 font-medium">{sentence(p.step)}</span>
                {p.agents.map((x) => <Tag key={x.key + x.task} color="teal" title={`${x.product}: ${x.task}`}>{x.agent}</Tag>)}
              </li>
            ))}
          </ul>
        )}
        {delegations.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-rule">
            <table className="table">
              <thead><tr><th>Time</th><th>Agent</th><th>Task</th><th>Persona</th><th className="text-right">Took</th></tr></thead>
              <tbody>{delegations.map((d, i) => (
                <tr key={i} className={d.status === "failed" ? "bg-stop-tint/40" : ""}>
                  <td className="whitespace-nowrap font-mono text-xs">{seconds(d.at)}</td><td className="whitespace-nowrap">{d.agent}</td>
                  <td>{sentence(d.task)}<div className="text-2xs text-ink-faint">{sentence(d.step)}</div>{d.error && <div className="text-2xs text-stop">{d.error}</div>}</td>
                  <td className="whitespace-nowrap text-ink-faint">{roleName[d.persona] ?? d.persona}</td><td className="text-right font-mono text-xs">{d.duration_ms} ms</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {!plan && delegations.length === 0 && <p className="text-ink-faint">No agent activity yet.</p>}
      </Drawer>
    );
  }
  if (k === "runs") {
    const rows: any[] = wf.checkpoint.assignments || [];
    const atRisk: any[] = a?.runs_at_risk || [];
    return (
      <Drawer title="Affected runs" subtitle={`${wf.runs_covered} of ${wf.runs_at_risk} run(s) reassigned to a spare vehicle and qualified driver`} onClose={onClose} wide>
        {rows.length ? (
          <div className="overflow-x-auto rounded-xl border border-rule"><table className="table">
            <thead><tr><th>Run</th><th>Starts</th><th className="text-right">Riders</th><th>Now on</th><th>Driver</th><th className="text-right">Delay</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.run_id}><td><div className="font-medium">{x.route_name}</div><div className="text-2xs text-ink-faint">{x.block_name}</div></td>
                <td className="whitespace-nowrap font-mono text-xs">{dayTime(x.start)}</td><td className="text-right font-mono">{x.riders}</td>
                <td><VehicleId label={x.vehicle_label} /></td><td>{x.driver_name}</td><td className="text-right font-mono text-xs">{x.delay_minutes ? `+${x.delay_minutes} min` : "None"}</td></tr>
            ))}</tbody></table></div>
        ) : atRisk.length ? (
          <div className="overflow-x-auto rounded-xl border border-rule"><table className="table">
            <thead><tr><th>Run at risk</th><th>Starts</th><th className="text-right">Riders</th></tr></thead>
            <tbody>{atRisk.map((x: any) => <tr key={x.run_id}><td><div className="font-medium">{x.route_name}</div><div className="text-2xs text-ink-faint">{x.block_name}</div></td><td className="font-mono text-xs">{dayTime(x.start)}</td><td className="text-right font-mono">{x.riders}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="text-ink-faint">No runs at risk in the service window.</p>}
      </Drawer>
    );
  }
  if (k === "riders") return (
    <Drawer title="Rider messages" subtitle="Updated ETAs pushed through Rider Comms, in each rider's language and channel" onClose={onClose}>
      {wf.notifications.length === 0 ? <p className="text-ink-faint">No riders notified yet. Riders are notified once their runs are reassigned.</p> : wf.notifications.map((n) => (
        <div key={n.id} className="rounded-xl border border-rule px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]"><b>{n.rider_name}</b><Tag>{n.channel}</Tag><Tag>{n.language}</Tag><span className="text-ink-faint">{kindLabel(n.kind)}</span><span className="ml-auto font-mono text-xs text-ink-faint">{time(n.created_at)}</span></div>
          <p className="mt-1.5 text-sm">{n.message}</p>
        </div>
      ))}
      <Link to={`/simulate?tab=riders&workflow=${wf.id}`} className="text-sm font-medium text-route hover:underline">All rider messages in Simulate</Link>
    </Drawer>
  );
  if (k === "shadow") return (
    <Drawer title="Shadow run" subtitle="What the agent would have done, compared with what people did" onClose={onClose}>
      {wf.shadow.map((r) => (
        <div key={r.id} className="border-b border-rule pb-3">
          <div className="flex flex-wrap items-center gap-2"><b className="font-medium">{sentence(r.step)}</b><StatusBadge status={r.status} />
            {r.agreement_pct !== null && <span className="font-mono text-xs text-ink-faint">{r.agreement_pct}% agreement</span>}
            {r.agent_ahead_minutes !== null && <span className="text-xs text-go">agent ready {r.agent_ahead_minutes} min earlier</span>}</div>
          <p className="mt-1 text-[13px] text-ink-faint">People: {r.human_actions.length ? r.human_actions.map((h) => `${h.detail}${h.by ? ` (${h.by})` : ""}`).join("; ") : "nothing yet"}</p>
        </div>
      ))}
      <Link to="/shadow" className="text-sm font-medium text-route hover:underline">Open shadow mode</Link>
    </Drawer>
  );
  if (k === "systems") return <Drawer title="Connected systems" subtitle="What the agent read from and wrote to each product, through its action adapter. No one re-keyed the data." onClose={onClose} wide><ConnectedSystems wf={wf} /></Drawer>;
  if (k === "record" && rec) return (
    <Drawer title={sentence(rec.record_type)} subtitle={`${rec.actor} · ${dayTime(rec.created_at)}`} onClose={onClose}>
      <p className="text-[15px] leading-relaxed">{storyText(rec)}</p>
      <div className="flex flex-wrap gap-2">{rec.step && <Tag>{words(rec.step)}</Tag>}<LevelTag level={rec.autonomy_level} />{rec.model_used && <Tag>{rec.model_used}</Tag>}</div>
      <Json value={{ data_considered: rec.data_considered, recommendation: rec.recommendation, human_action: rec.human_action, outcome: rec.outcome, trace_id: rec.trace_id }} />
    </Drawer>
  );
  return (
    <Drawer title="Full decision record" subtitle={`${wf.audit.length} records · oldest first`} onClose={onClose}>
      {wf.audit.length === 0 ? <p className="text-ink-faint">No decisions recorded yet.</p> : wf.audit.map((r) => (
        <button key={r.id} onClick={() => openRecord(r)} className="border-b border-rule pb-3 text-left hover:text-route">
          <div className="flex gap-2 text-[13px]"><b>{sentence(r.record_type)}</b><span className="text-ink-faint">{r.actor}</span><span className="ml-auto font-mono text-ink-faint">{seconds(r.created_at)}</span></div>
          <p className="mt-1 text-sm">{storyText(r)}</p>
        </button>
      ))}
    </Drawer>
  );
}

type SysState = "done" | "waiting" | "not_yet" | "attention";

/** The orchestration seen from the products it connects (proposal §4.1, action adapters). */
function ConnectedSystems({ wf }: { wf: WD }) {
  const wo = wf.checkpoint.work_order;
  const ev = wf.trigger_event;
  const stepStatus = (k: string) => wf.steps.find((s) => s.key === k)?.status;
  const state = (k: string): SysState => (stepStatus(k) === "done" ? "done" : ["awaiting_approval", "active", "waiting"].includes(stepStatus(k) ?? "") ? "waiting" : "not_yet");
  const systems: { name: string; product: string; dir: string; what: ReactNode; state: SysState }[] = [
    { name: "Telematics", product: "Vehicle IoT", dir: "Fault event in", state: "done", what: ev ? <>{ev.data?.fault_code ?? ev.type} from {ev.source}</> : "Fault detected" },
    { name: "Asset Mgmt", product: "FASTER", dir: "Work order", state: wf.returned_at ? "done" : wo ? (wf.status === "awaiting_event" ? "waiting" : "done") : state("open_work_order"),
      what: wo ? <>{wo.work_order_id} at {wo.depot}{wf.work_order_status ? `, ${words(wf.work_order_status)}` : ""}</> : "No work order yet" },
    { name: "Trip Mgmt", product: "Ecolane / TripMaster", dir: "Vehicle and runs",
      state: stepStatus("reassign_runs") === "escalated" || wf.checkpoint.coverage_gap ? "attention" : state("reassign_runs") === "done" ? "done" : state("pull_vehicle") === "not_yet" ? "not_yet" : "waiting",
      what: wf.pulled_at ? <>Vehicle pulled; {wf.runs_covered} of {wf.runs_at_risk} affected runs reassigned</> : `${wf.runs_at_risk} run(s) at risk` },
    { name: "Workforce", product: "Bytecurve", dir: "Qualified drivers", state: state("reassign_runs") === "done" ? "done" : state("reassign_runs"), what: "Driver hours and licence class checked for each reassigned run" },
    { name: "Safety", product: "Vestige", dir: "Defect record", state: wf.checkpoint.defect ? "done" : "not_yet",
      what: wf.checkpoint.defect ? <>Defect {wf.checkpoint.defect.defect_id} logged</> : wf.checkpoint.safety_alert ? `Not recorded: ${wf.checkpoint.safety_alert}` : "Drivers checked for compliance" },
    { name: "Rider Comms", product: "TripShot / Passio", dir: "Updated ETAs out", state: state("notify_riders"), what: wf.notification_count ? `${wf.notification_count} rider(s) notified` : "No riders notified yet" },
  ];
  const ui: Record<SysState, { cls: string; label: string }> = {
    done: { cls: "text-go", label: "Synced" }, waiting: { cls: "text-[#8A5A00]", label: "In progress" }, not_yet: { cls: "text-ink-faint", label: "Not yet" }, attention: { cls: "text-stop", label: "Needs a person" },
  };
  return (
    <ol className="divide-y divide-rule rounded-xl border border-rule">
      {systems.map((x) => (
        <li key={x.name} className="flex items-start gap-4 px-4 py-3.5">
          <div className="w-40 shrink-0"><div className="text-sm font-semibold">{x.name}</div><div className="text-xs text-ink-faint">{x.product} · {x.dir}</div></div>
          <p className="min-w-0 flex-1 text-sm text-ink-soft">{x.what}</p>
          <span className={`shrink-0 text-xs font-semibold ${ui[x.state].cls}`}>{ui[x.state].label}</span>
        </li>
      ))}
    </ol>
  );
}
