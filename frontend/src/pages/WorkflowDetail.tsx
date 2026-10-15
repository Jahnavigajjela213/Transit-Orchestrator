import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Bot, CalendarClock, Check, ChevronRight, Circle, Download, HardHat, MessageSquare, Radio, User, Wrench,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { ago, dayTime, kindLabel, roleName, seconds, sentence, words } from "../lib/format";
import type { AuditRecord, Delegation, WorkflowDetail as WD } from "../lib/types";
import AgentFlow from "../components/AgentFlow";
import DecisionCard from "../components/DecisionCard";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Json, KeyVal, LevelTag, Loading, Section, SeverityTag, StatusBadge, Tag, VehicleId } from "../components/ui";

type TabKey = "overview" | "trail" | "agents" | "riders";

export default function WorkflowDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("overview");
  const { data: wf, error, reload } = useData<WD>(`/api/workflows/${id}`, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!wf) return <Loading />;

  const wo = wf.checkpoint.work_order;
  const pending = wf.approvals.filter((x) => x.status === "pending");
  const inShop = !!wo && wf.status === "awaiting_event";
  const isShop = user?.role === "shop_manager" || user?.role === "admin";
  const woStatus = wf.work_order_status;  // live from maintenance: the shop must start work before the work order can be closed
  const title = wf.title.replace(`${wf.vehicle_label}: `, "");
  const delegations: Delegation[] = wf.context?.delegations || [];

  async function shopAction(action: "start" | "close") {
    try {
      await api.post(`/products/asset-mgmt/work-orders/${wo!.work_order_id}/${action}`, action === "close" ? { resolution: "Repaired and road tested" } : {});
      toast(action === "start" ? `Work started on ${wo!.work_order_id}.` : `Closed ${wo!.work_order_id}. The agent will return ${wf!.vehicle_label} to service.`);
      reload();
    } catch (err: any) { toast(err.message, "error"); }
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "trail", label: "Decision trail", count: wf.audit.length },
    { key: "agents", label: "Agents", count: delegations.length },
    { key: "riders", label: "Rider messages", count: wf.notification_count },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-ink-soft" aria-label="Breadcrumb">
        <Link to="/workflows" className="hover:text-ink">Orchestrations</Link>
        <ChevronRight className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
        <span className="font-medium text-ink">{wf.vehicle_label}</span>
      </nav>

      {/* summary */}
      <section className="panel">
        <div className="flex flex-wrap items-start gap-4 px-6 pb-5 pt-6">
          <VehicleId label={wf.vehicle_label} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-snug">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
              <SeverityTag severity={wf.severity} /><StatusBadge status={wf.status} />
              <span>Detected {ago(wf.detected_at)}</span>
            </div>
          </div>
          <button className="btn-quiet" onClick={() => api.download(`/api/audit/export?format=jsonl&workflow_id=${wf.id}`, `audit_${wf.id}.jsonl`)}>
            <Download className="h-4 w-4" aria-hidden /> Export audit
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-rule bg-rule sm:grid-cols-3 lg:grid-cols-5">
          <Meta label="Detected" value={dayTime(wf.detected_at)} />
          <Meta label="Work order" value={wo ? <>{wo.work_order_id}{woStatus && <span className="ml-1.5 text-ink-faint">· {words(woStatus)}</span>}</> : "Not opened"} />
          <Meta label="Runs covered" value={<span className="tnum">{wf.runs_covered} <span className="text-ink-faint">of {wf.runs_at_risk}</span></span>} />
          <Meta label="Approvals given" value={<span className="tnum">{wf.human_touches}</span>} />
          <Meta label="Trace" value={<code className="block truncate font-mono text-xs" title={wf.trace_id}>{wf.trace_id.slice(0, 16)}…</code>} />
        </dl>
      </section>

      {/* progress */}
      <section className="panel px-6 pb-6 pt-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Progress</h2>
          <span className="flex items-center gap-3 text-2xs text-ink-faint">
            <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" aria-hidden /> Agent acts</span>
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" aria-hidden /> Person approves</span>
            <span className="hidden sm:inline">· Click a step to see its agents</span>
          </span>
        </div>
        <AgentFlow steps={wf.steps} delegations={delegations} workflowType={wf.workflow_type} />
      </section>

      {/* what needs doing now */}
      {(pending.length > 0 || inShop) && (
        <section className="space-y-4" aria-labelledby="action">
          <h2 id="action" className="flex items-center gap-2 text-sm font-semibold">
            <span className="h-2 w-2 rounded-full bg-signal" aria-hidden /> Action required
          </h2>
          {pending.map((p) => <DecisionCard key={p.id} item={p} onDone={reload} inWorkflow />)}
          {inShop && (
            <div className="panel flex flex-wrap items-center gap-4 border-l-4 border-l-route px-5 py-4 text-sm">
              <span className="rounded-lg bg-route-tint p-2 text-route"><Wrench className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{wo!.work_order_id} · {woStatus === "in_progress" ? "work under way" : woStatus === "open" ? "waiting for the shop" : "checking maintenance…"}</div>
                <p className="mt-0.5 text-ink-soft">
                  {woStatus === "in_progress"
                    ? `Closing the work order lets the agent return ${wf.vehicle_label} to service.`
                    : "The shop starts work first; once it is under way the work order can be closed."}
                  {!isShop && " The shop manager does this."}
                </p>
              </div>
              {isShop && woStatus === "open" && <button className="btn-primary" onClick={() => shopAction("start")}>Start work</button>}
              {isShop && woStatus === "in_progress" && <button className="btn-primary" onClick={() => shopAction("close")}>Close work order</button>}
            </div>
          )}
        </section>
      )}

      {/* details */}
      <div>
        <div className="tabs mb-5" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
            </button>
          ))}
        </div>
        {tab === "overview" && <Overview wf={wf} />}
        {tab === "trail" && <Trail audit={wf.audit} />}
        {tab === "agents" && <Agents plan={wf.context?.agent_plan} delegations={delegations} />}
        {tab === "riders" && <RiderMessages wf={wf} />}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 bg-white px-6 py-3.5">
      <dt className="text-2xs font-medium uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function Overview({ wf }: { wf: WD }) {
  const a = wf.context?.assessment;
  const wo = wf.checkpoint.work_order;
  return (
    <div className="space-y-5">
      <ConnectedSystems wf={wf} />

      {wf.checkpoint.failure && (
        <div className="panel flex gap-3 border-l-4 border-l-stop px-5 py-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-stop" aria-hidden />
          <div>
            <div className="font-semibold">{sentence(wf.checkpoint.failure.step)} failed</div>
            <p className="mt-0.5 text-ink-soft">{wf.checkpoint.failure.message}
              {(wf.checkpoint.compensation?.length ?? 0) > 0 && <> Rolled back: {wf.checkpoint.compensation!.map((c: any) => words(c.action)).join(", ")}.</>}</p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section title="Assessment" subtitle="What the agent concluded from the fault, the vehicle and the schedule.">
          <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed">{wf.summary || "Assessment in progress."}</p>
            {a && (
              <KeyVal items={[
                ["Fault", `${a.fault.description} (${a.fault.code}, ${a.fault.system})`],
                ["Vehicle", `${a.vehicle.vehicle_type}, ${a.vehicle.capacity} seats, ${a.vehicle.wheelchair_positions} wheelchair positions, ${a.vehicle.depot}`],
                ["Asset", `${a.health.year} ${a.health.make} ${a.health.model}, ${a.health.odometer?.toLocaleString()} mi, PM ${a.health.pm_miles_over >= 0 ? `${a.health.pm_miles_over} mi overdue` : "current"}`],
                ["Timing", a.timing_reason],
                ["Out of service", `${dayTime(a.oos_from)} to ${dayTime(a.oos_until)}`],
                ["Runs at risk", `${a.runs_at_risk.length}${a.later_runs?.length ? `, plus ${a.later_runs.length} beyond the planning horizon` : ""}`],
                ["Safety", a.safety ? [
                  a.safety.open_defects?.length ? `${a.safety.open_defects.length} open defect(s) already` : "No open defects",
                  a.safety.will_log_defect ? "defect recorded with the work order" : null,
                  a.safety.noncompliant_drivers?.length ? `${a.safety.noncompliant_drivers.length} driver(s) excluded as out of compliance` : null,
                ].filter(Boolean).join("; ") : "—"],
                ["Model", <code className="font-mono text-xs">{a.model}</code>],
              ]} />
            )}
          </div>
        </Section>

        <Section title="Timeline">
          <div className="p-5">
            <KeyVal items={[
              ["Triggered by", wf.trigger_event ? `${wf.trigger_event.type} from ${wf.trigger_event.source}` : wf.trigger_type],
              ["Detected", dayTime(wf.detected_at)],
              ["Work order opened", wo ? `${dayTime(wf.work_order_opened_at)} · ${wo.depot}` : "—"],
              ["Vehicle pulled", dayTime(wf.pulled_at)],
              ["Returned to service", dayTime(wf.returned_at)],
              ["Safety defect", wf.checkpoint.defect ? wf.checkpoint.defect.defect_id : wf.checkpoint.safety_alert ? `Not recorded: ${wf.checkpoint.safety_alert}` : "—"],
            ]} />
            {wf.trigger_event && (
              <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium text-route">Triggering event</summary><div className="mt-2"><Json value={wf.trigger_event} /></div></details>
            )}
          </div>
        </Section>
      </div>

      {(wf.checkpoint.assignments?.length ?? 0) > 0 && (
        <Section title="Runs covered" subtitle="Each affected run, now on a spare vehicle with a qualified driver.">
          <table className="table">
            <thead><tr><th>Run</th><th>Starts</th><th className="text-right">Riders</th><th>Now on</th><th>Driver</th><th className="text-right">Delay</th></tr></thead>
            <tbody>{wf.checkpoint.assignments!.map((x: any) => (
              <tr key={x.run_id}><td><div className="font-medium">{x.route_name}</div><div className="text-2xs text-ink-soft">{x.block_name}</div></td>
                <td className="whitespace-nowrap tnum">{dayTime(x.start)}</td><td className="text-right tnum">{x.riders}</td>
                <td><VehicleId label={x.vehicle_label} /></td><td>{x.driver_name}</td>
                <td className="text-right tnum">{x.delay_minutes ? `+${x.delay_minutes} min` : "None"}</td></tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {wf.shadow?.length > 0 && (
        <Section title="Shadow run" subtitle="What the agent would have done, compared with what people did." aside={<Link to="/shadow" className="text-xs font-medium text-route hover:underline">Shadow mode</Link>}>
          <ul className="divide-y divide-rule text-sm">
            {wf.shadow.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{sentence(r.step)}</span><StatusBadge status={r.status} />
                  {r.agreement_pct !== null && <span className="text-2xs text-ink-soft tnum">{r.agreement_pct}% agreement</span>}
                  {r.agent_ahead_minutes !== null && <span className="text-2xs text-go">agent ready {r.agent_ahead_minutes} min earlier</span>}</div>
                <div className="mt-1 text-xs text-ink-soft">People: {r.human_actions.length ? r.human_actions.map((h) => `${h.detail}${h.by ? ` (${h.by})` : ""}`).join("; ") : "nothing yet"}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const actorIcon: Record<string, any> = { human: User, agent: Bot };

function Trail({ audit }: { audit: AuditRecord[] }) {
  if (audit.length === 0) return <div className="panel"><Empty title="No decisions recorded yet" /></div>;
  return (
    <section className="panel">
      <ol className="px-6 py-5">
        {audit.map((r, i) => {
          const bad = r.record_type.includes("fail") || r.record_type === "compensation" || r.outcome === "escalated";
          const Icon = actorIcon[r.actor_type] ?? Radio;
          return (
            <li key={r.id} className="relative flex gap-4 pb-6 last:pb-0">
              {i < audit.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-rule" aria-hidden />}
              <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${bad ? "border-stop/30 bg-stop-tint text-stop" : r.actor_type === "human" ? "border-signal/30 bg-signal-tint text-[#8A5900]" : "border-route/20 bg-route-tint text-route"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-semibold text-ink">{sentence(r.record_type)}</span>
                  {r.step && <span className="text-ink-soft">· {words(r.step)}</span>}
                  <LevelTag level={r.autonomy_level} />
                  <span className="ml-auto whitespace-nowrap text-ink-faint tnum">{seconds(r.created_at)}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-soft">{r.actor}</div>
                {r.explanation && <p className="mt-2 text-sm leading-relaxed">{r.explanation}</p>}
                {(Object.keys(r.data_considered).length > 0 || Object.keys(r.recommendation).length > 0) && (
                  <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-route">Full record</summary>
                    <div className="mt-2"><Json value={{ data_considered: r.data_considered, recommendation: r.recommendation, model: r.model_used, outcome: r.outcome }} /></div></details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Agents({ plan, delegations }: { plan?: { step: string; agents: { agent: string; key: string; task: string; product: string }[] }[]; delegations: Delegation[] }) {
  if (!plan && delegations.length === 0) return <div className="panel"><Empty title="No agent activity yet" /></div>;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      {plan && (
        <Section title="Plan" subtitle="The supervisor hands each product task to its domain agent.">
          <ul className="divide-y divide-rule">
            {plan.map((p) => (
              <li key={p.step} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <span className="w-36 shrink-0 font-medium">{sentence(p.step)}</span>
                {p.agents.map((a) => <Tag key={a.key + a.task} color="teal" title={`${a.product}: ${a.task}`}>{a.agent}</Tag>)}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {delegations.length > 0 && (
        <Section title="Delegations" subtitle="Every task an agent ran, for which persona, and how long it took.">
          <div className="max-h-[560px] overflow-auto">
            <table className="table">
              <thead><tr><th>Time</th><th>Agent</th><th>Task</th><th>Persona</th><th className="text-right">Took</th></tr></thead>
              <tbody>{delegations.map((d, i) => (
                <tr key={i} className={d.status === "failed" ? "bg-stop-tint/40" : ""}>
                  <td className="whitespace-nowrap text-xs tnum">{seconds(d.at)}</td><td className="whitespace-nowrap">{d.agent}</td>
                  <td>{sentence(d.task)}<div className="text-2xs text-ink-faint">{sentence(d.step)}</div>
                    {d.error && <div className="text-2xs text-stop">{d.error}</div>}</td>
                  <td className="whitespace-nowrap text-ink-soft">{roleName[d.persona] ?? d.persona}</td><td className="text-right text-xs tnum">{d.duration_ms} ms</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function RiderMessages({ wf }: { wf: WD }) {
  return (
    <Section title="Rider messages" subtitle="Sent through rider communications in each rider's language and preferred channel."
      aside={<Link to={`/simulate?tab=riders&workflow=${wf.id}`} className="text-xs font-medium text-route hover:underline">Open in Simulate</Link>}>
      {wf.notifications.length === 0 ? <Empty title="No rider messages for this orchestration">Riders are told when their run moves to another vehicle.</Empty> : (
        <ul className="divide-y divide-rule text-sm">
          {wf.notifications.map((n) => (
            <li key={n.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="font-medium text-ink">{n.rider_name}</span><Tag>{n.channel}</Tag><Tag>{n.language}</Tag><span>{kindLabel(n.kind)}</span>
                <span className="ml-auto text-ink-faint tnum">{seconds(n.created_at)}</span>
              </div>
              <p className="mt-1">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

type SysState = "done" | "waiting" | "not_yet" | "attention";

/** The orchestration seen from the systems it connects: what the agent read from or wrote to each one. */
function ConnectedSystems({ wf }: { wf: WD }) {
  const wo = wf.checkpoint.work_order;
  const ev = wf.trigger_event;
  const stepStatus = (k: string) => wf.steps.find((s) => s.key === k)?.status;
  const state = (k: string): SysState => (stepStatus(k) === "done" ? "done" : ["awaiting_approval", "active", "waiting"].includes(stepStatus(k) ?? "") ? "waiting" : "not_yet");
  const systems: { name: string; icon: any; dir: string; what: ReactNode; state: SysState }[] = [
    { name: "Telematics", icon: Radio, dir: "Fault event in", state: "done",
      what: ev ? <>{ev.data?.fault_code ?? ev.type} from {ev.source}</> : "Fault detected" },
    { name: "Maintenance", icon: Wrench, dir: "Work order", state: wf.returned_at ? "done" : wo ? (wf.status === "awaiting_event" ? "waiting" : "done") : state("open_work_order"),
      what: wo ? <>{wo.work_order_id} at {wo.depot}{wf.work_order_status ? `, ${words(wf.work_order_status)}` : ""}</> : "No work order yet" },
    { name: "Scheduling", icon: CalendarClock, dir: "Vehicle and runs",
      state: stepStatus("reassign_runs") === "escalated" || wf.checkpoint.coverage_gap ? "attention" : state("reassign_runs") === "done" ? "done" : state("pull_vehicle") === "not_yet" ? "not_yet" : "waiting",
      what: wf.pulled_at ? <>Pulled; {wf.runs_covered} of {wf.runs_at_risk} runs moved to spares</> : `${wf.runs_at_risk} run(s) at risk` },
    { name: "Safety", icon: HardHat, dir: "Defect record", state: wf.checkpoint.defect ? "done" : "not_yet",
      what: wf.checkpoint.defect ? <>Defect {wf.checkpoint.defect.defect_id} logged</> : wf.checkpoint.safety_alert ? `Not recorded: ${wf.checkpoint.safety_alert}` : "Drivers checked for compliance" },
    { name: "Rider comms", icon: MessageSquare, dir: "Messages out", state: state("notify_riders"),
      what: wf.notification_count ? `${wf.notification_count} rider(s) notified` : "No riders notified yet" },
  ];
  const stateUi: Record<SysState, { cls: string; label: string }> = {
    done: { cls: "text-go", label: "Synced" }, waiting: { cls: "text-signal", label: "In progress" }, not_yet: { cls: "text-ink-faint", label: "Not yet" },
    attention: { cls: "text-stop", label: "Needs a person" },
  };
  return (
    <Section title="Connected systems" subtitle="What the agent read from and wrote to each system. No one re-keyed the data.">
      <ol className="grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-5">
        {systems.map((x, i) => (
          <li key={x.name} className="bg-white px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-paper p-2 text-ink-soft"><x.icon className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-tight">{x.name}</div>
                <div className="text-2xs text-ink-faint">{x.dir}</div>
              </div>
              {i < systems.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 text-ink-faint lg:block" aria-hidden />}
            </div>
            <p className="mt-3 text-xs leading-snug text-ink-soft">{x.what}</p>
            <div className={`mt-2.5 inline-flex items-center gap-1 text-2xs font-semibold ${stateUi[x.state].cls}`}>
              {x.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : <Circle className="h-2.5 w-2.5" fill={x.state === "waiting" || x.state === "attention" ? "currentColor" : "none"} aria-hidden />}
              {stateUi[x.state].label}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
