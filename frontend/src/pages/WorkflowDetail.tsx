import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Bell, Check, CheckCircle2, Radar, SearchCheck, Shuffle, Truck, UserCheck, Wrench, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { STEP_ICON } from "../lib/stepIcons";
import { useCrumbs } from "../lib/topbar";
import { ago, dayTime, kindLabel, roleName, seconds, sentence, time, words } from "../lib/format";
import type { Approval, Delegation, Step, WorkflowDetail as WD } from "../lib/types";
import { StepBody, UncoveredRuns, initialOverride } from "../components/DecisionCard";
import { useToast } from "../components/Toast";
import { ErrorNote, Loading, StatusBadge } from "../components/ui";

interface AgentInfo { key: string; name: string; product: string; role: string; summary: string; data: string[] }
interface AgentsResponse { agents: AgentInfo[]; plans: Record<string, { step: string; agents: { key: string; task: string }[] }[]> }
// The agent catalogue does not change while the app runs: fetch it once and share it.
let catalogue: Promise<AgentsResponse> | null = null;
const loadCatalogue = () => (catalogue ??= api.get<AgentsResponse>("/api/agents").catch((e) => { catalogue = null; throw e; }));

type TabKey = "overview" | "trail" | "agents" | "riders";
const SEV: Record<string, string> = { critical: "bg-stop-tint text-stop", high: "bg-signal-tint text-signal-ink", medium: "bg-route-tint text-route-dark", low: "bg-[#EEF1F0] text-ink-soft" };
const STATE_WORD: Record<string, string> = {
  done: "Done", active: "In progress", awaiting_approval: "Your decision", waiting: "Waiting on the shop", escalated: "Raised with you",
  failed: "Failed", compensated: "Rolled back", skipped: "Skipped", not_run: "Not reached", pending: "Not yet", recommended: "Recommended", shadowed: "Shadow",
};
const EDITABLE = ["open_work_order", "pull_vehicle", "reassign_runs"];

export default function WorkflowDetail() {
  const { id } = useParams();
  const { data: wf, error, reload } = useData<WD>(`/api/workflows/${id}`, [id]);
  useCrumbs([{ label: "Orchestrations", to: "/workflows" }, { label: wf?.vehicle_label ?? "…" }]);
  const [cat, setCat] = useState<AgentsResponse | null>(null);
  useEffect(() => { loadCatalogue().then(setCat).catch(() => {}); }, []);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);  // undefined: open on the current step
  const [tab, setTab] = useState<TabKey>("overview");

  if (error) return <ErrorNote message={error} />;
  if (!wf) return <div className="card"><Loading /></div>;

  const a = wf.context?.assessment;
  const wo = wf.checkpoint.work_order;
  const delegations: Delegation[] = wf.context?.delegations || [];
  const pending = wf.approvals.filter((x) => x.status === "pending");
  const currentIdx = wf.steps.findIndex((s) => ["awaiting_approval", "escalated", "waiting", "active", "failed"].includes(s.status));
  const stepKey = picked === undefined ? (wf.steps[currentIdx]?.key ?? null) : picked;
  const title = wf.title.replace(`${wf.vehicle_label}: `, "");
  const trigger = wf.trigger_event;
  const tabs: [TabKey, string, number][] = [
    ["overview", "Overview", a ? 7 : 1], ["trail", "Decision trail", wf.audit.length], ["agents", "Agents", delegations.length], ["riders", "Rider messages", wf.notification_count],
  ];

  return (
    <>
      {/* summary */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3.5 px-[22px] py-5">
          <span className="rounded-[7px] bg-ink px-2.5 py-[5px] font-mono text-[15px] font-medium text-white">{wf.vehicle_label}</span>
          <div className="min-w-[240px] flex-1">
            <h1 className="text-[21px] font-semibold">{title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {wf.severity && <span className={`rounded-full px-[9px] py-0.5 font-semibold ${SEV[wf.severity] ?? SEV.low}`}>{sentence(wf.severity)}</span>}
              <StatusBadge status={wf.status} />
              <span className="text-ink-soft">Detected {ago(wf.detected_at)}{trigger ? ` from ${trigger.source}` : ""}{a?.fault?.code ? ` (${a.fault.code})` : ""}</span>
            </div>
          </div>
          <button type="button" className="h-10 rounded-[10px] bg-route px-3.5 text-[13px] font-semibold text-white hover:bg-route-dark"
            onClick={() => api.download(`/api/audit/export?format=jsonl&workflow_id=${wf.id}`, `audit_${wf.id}.jsonl`)}>Export audit</button>
        </div>
        <dl className="grid grid-cols-2 border-t border-rule sm:grid-cols-5">
          <Fact label="Detected" value={dayTime(wf.detected_at)} />
          <Fact label="Work order" value={wo ? `${wo.work_order_id}${wf.work_order_status ? ` · ${words(wf.work_order_status)}` : ""}` : "Not opened"} />
          <Fact label="Runs covered" value={`${wf.runs_covered} of ${wf.runs_at_risk}`} />
          <Fact label="Approvals given" value={String(wf.human_touches)} />
          <Fact label="Out of service" value={a ? `${time(a.oos_from)} → ${time(a.oos_until)}` : "—"} last />
        </dl>
      </section>

      {/* progress: each step opens its agents */}
      <section aria-label="Progress" className="card px-[22px] pb-4 pt-[18px]">
        <div className="mb-4 flex items-center">
          <h2 className="flex-1 text-sm font-semibold">Progress</h2>
          <span className="text-xs text-ink-faint">Select a step to see its agents</span>
        </div>
        <div className="-mx-1 overflow-x-auto px-1 pt-1.5"><ol className="grid min-w-[600px] grid-cols-7">
          {wf.steps.map((s, i) => (
            <Station key={s.key} s={s} i={i} steps={wf.steps} selected={stepKey === s.key} onPick={() => setPicked(stepKey === s.key ? null : s.key)} />
          ))}
        </ol></div>
        {stepKey && cat && (
          <AgentPanel step={wf.steps.find((s) => s.key === stepKey)!} index={wf.steps.findIndex((s) => s.key === stepKey)} cat={cat}
            workflowType={wf.workflow_type} delegations={delegations} onClose={() => setPicked(null)} />
        )}
      </section>

      {/* what needs a person now */}
      {pending.map((p) => <ActionCard key={p.id} item={p} steps={wf.steps} onDone={reload} />)}
      {wo && wf.status === "awaiting_event" && <ShopCard wf={wf} onDone={reload} />}

      {/* details: one tab at a time */}
      <div role="tablist" aria-label="Details" className="flex gap-6 border-b border-rule">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px flex items-center gap-2 border-b-2 pb-3 pt-2 text-sm font-medium ${tab === k ? "border-route text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {label} <span className="rounded-full bg-[#EEF1F0] px-[7px] py-px text-[11px] text-ink-soft tnum">{n}</span>
          </button>
        ))}
      </div>
      <section className="card px-[22px] py-1.5">
        {tabRows(tab, wf, delegations).map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-1 border-b border-rule-soft py-3.5 last:border-b-0 md:grid-cols-[180px_minmax(0,1fr)_160px] md:gap-4">
            <span className="text-[13px] font-semibold">{r.a}</span>
            <span className="text-[13.5px] leading-normal text-[#24323C]">{r.b}</span>
            <span className="text-right text-xs text-ink-faint">{r.c}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function Fact({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`px-[22px] py-3 ${last ? "" : "border-r border-rule-soft"}`}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words font-medium sm:truncate" title={value}>{value}</dd>
    </div>
  );
}

const STEP_ICON: Record<string, typeof Wrench> = {
  detect: Radar, assess: SearchCheck, open_work_order: Wrench, pull_vehicle: Truck,
  reassign_runs: Shuffle, notify_riders: Bell, return_to_service: CheckCircle2,
};

function Station({ s, i, steps, selected, onPick }: { s: Step; i: number; steps: Step[]; selected: boolean; onPick: () => void }) {
  <!--   const n = i + 1;
  const Icon = STEP_ICON[s.key] ?? Check; -->
  const Icon = STEP_ICON[s.key] ?? CheckCircle2;
  const done = ["done", "recommended", "shadowed", "compensated"].includes(s.status);
  const red = s.status === "escalated" || s.status === "failed";
  const now = ["awaiting_approval", "active", "waiting"].includes(s.status) || red;
  const lineOn = i < steps.length - 1 && !["pending", "not_run"].includes(steps[i + 1].status);
  const dot = done ? "bg-route text-white"
    : red ? "bg-stop text-white" : now ? "bg-signal text-white"
    : s.status === "skipped" ? "border-2 border-dashed border-[#C9D1CE] bg-white text-ink-faint"
    : "border-2 border-[#C9D1CE] bg-white text-ink-faint";
  const labelTone = red ? "text-stop" : now ? "text-signal-ink" : done ? "text-ink" : "text-ink-faint";
  return (
    <li className="relative flex flex-col items-center text-center">
      {i < steps.length - 1 && <span aria-hidden className={`absolute left-1/2 top-[15px] h-[3px] w-full ${lineOn ? "bg-route" : "bg-rule"}`} />}
 <!--       <button type="button" onClick={onPick} aria-label={`Step ${n}, ${s.label}: see its agents`} aria-pressed={selected}
        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${dot} ${selected ? "shadow-[0_0_0_5px_rgba(11,110,105,0.2)]" : ""}`}> -->

      <button type="button" onClick={onPick} aria-label={`${s.label}: see its agents`} aria-pressed={selected}
        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${dot} ${selected ? "shadow-[0_0_0_5px_rgba(11,110,105,0.2)]" : ""}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </button>
      <span className={`mt-2 text-[12.5px] font-semibold ${labelTone}`}>{s.label}</span>
      <span className="mt-0.5 text-[11px] text-ink-faint">
        {STATE_WORD[s.status] ?? sentence(s.status)}{s.at && ["done", "escalated", "awaiting_approval"].includes(s.status) ? ` · ${time(s.at)}` : ""}
      </span>
    </li>
  );
}

function AgentPanel({ step, index, cat, workflowType, delegations, onClose }: {
  step: Step; index: number; cat: AgentsResponse; workflowType: string; delegations: Delegation[]; onClose: () => void;
}) {
  const plan = (cat.plans[workflowType] ?? []).find((p) => p.step === step.key);
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-rule bg-[#F6F8F7] px-4 py-3.5 md:grid-cols-3">
      <div className="flex items-center md:col-span-3">
        <span className="flex-1 font-semibold">Step {index + 1} · {step.label} · agents</span>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#E8ECEA] text-ink-soft"><X className="h-4 w-4" /></button>
      </div>
      {(plan?.agents ?? []).length === 0 && <p className="text-[13px] text-ink-soft md:col-span-3">No agent works on this step.</p>}
      {(plan?.agents ?? []).map((pa) => {
        const ag = cat.agents.find((x) => x.key === pa.key);
        if (!ag) return null;
        const ran = delegations.filter((d) => d.step === step.key && d.key === pa.key);
        const failed = ran.find((d) => d.status === "failed");
        return (
          <div key={pa.key + pa.task} className="rounded-[10px] border border-rule bg-white px-3.5 py-3">
            <div className="font-semibold">{ag.name} <span className="text-xs font-normal text-ink-faint">· {ag.role}</span></div>
            <div className="mt-1 text-[13px]">{pa.task}</div>
            <div className="mt-1.5 text-[11.5px] text-ink-soft">{ag.product.split(" (")[0]} · <span className="font-agent text-ink">{ag.data.join(", ")}</span></div>
            <div className={`mt-1.5 text-[11.5px] ${failed ? "text-stop" : ran.length ? "text-go" : "text-ink-faint"}`}>
              {failed ? `Failed: ${failed.error ?? ""}` : ran.length ? `✓ Ran ${ran.length} task${ran.length === 1 ? "" : "s"} · ${ran.reduce((n, d) => n + d.duration_ms, 0)} ms` : "Not yet"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One pending decision as a compact row; Change opens the editor, Details shows the full proposal. */
function ActionCard({ item, steps, onDone }: { item: Approval; steps: Step[]; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"none" | "details" | "edit">("none");
  const [override, setOverride] = useState<Record<string, any>>(() => initialOverride(item));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const esc = item.kind === "escalation";
  const idx = steps.findIndex((s) => s.key === item.step);
  const gapRuns: any[] | null = esc && item.recommendation?.uncovered_runs?.length ? item.recommendation.uncovered_runs : null;
  const firstSentence = useMemo(() => (item.explanation || item.summary || "").split(/(?<=\.)\s/)[0], [item]);
  const done: Record<string, string> = { approve: "Approved", reject: "Rejected", override: "Changed and approved", acknowledge: "Acknowledged" };

  async function send(action: string) {
    setBusy(true);
    try {
      await api.post(`/api/approvals/${item.id}/decision`, { action, note: note || undefined, override: action === "override" ? override : undefined });
      toast(`${done[action]}: ${item.title}`);
      onDone();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Action required" className={`card overflow-hidden ${esc ? "border-stop-line" : "border-signal-line"}`}>
      <div className="flex flex-wrap items-center gap-4 px-[22px] py-4">
        <span className={`flex h-[38px] w-[38px] items-center justify-center rounded-[10px] ${esc ? "bg-stop-tint text-stop" : "bg-signal-tint text-signal-ink"}`}>
          {esc ? <AlertTriangle className="h-[18px] w-[18px]" aria-hidden /> : <UserCheck className="h-[18px] w-[18px]" aria-hidden />}
        </span>
        <div className="min-w-[300px] flex-1">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${esc ? "text-stop" : "text-signal-ink"}`}>
            {esc ? "Manual action needed" : "Your decision"}{idx >= 0 ? ` · Step ${idx + 1} · ${steps[idx].label}` : ""}
          </div>
          <div className="mt-[3px] text-[15px] font-semibold">{item.title}</div>
          <div className="mt-0.5 text-[13px] text-ink-soft">{firstSentence}</div>
        </div>
        {item.can_decide ? (
          esc ? (
            <button type="button" disabled={busy} onClick={() => send("acknowledge")} className="btn-lg bg-route px-[22px] font-semibold text-white hover:bg-route-dark">Acknowledge</button>
          ) : (
            <>
              <button type="button" onClick={() => setMode(mode === "details" ? "none" : "details")} className="px-1 text-[13px] font-medium text-ink hover:underline">
                {mode === "details" ? "Hide details" : "Details"}
              </button>
              <button type="button" disabled={busy} onClick={() => send("reject")} className="btn-lg border border-stop-line bg-stop-tint px-4 text-stop hover:bg-stop-tint/70">Reject</button>
              {EDITABLE.includes(item.step) && (
                <button type="button" disabled={busy} onClick={() => { if (mode === "edit") setOverride(initialOverride(item)); setMode(mode === "edit" ? "none" : "edit"); }}
                  className="btn-lg border border-rule bg-white px-4 hover:bg-panel">{mode === "edit" ? "Cancel change" : "Change"}</button>
              )}
              {mode === "edit"
                ? <button type="button" disabled={busy} onClick={() => send("override")} className="btn-lg bg-signal px-[22px] font-semibold text-white hover:bg-signal/90"><Check className="h-4 w-4" aria-hidden />Approve with changes</button>
                : <button type="button" disabled={busy} onClick={() => send("approve")} className="btn-lg bg-signal px-[22px] font-semibold text-white hover:bg-signal/90">Approve</button>}
            </>
          )
        ) : (
          <span className="text-xs text-ink-soft">Only {item.approver_roles.map((r) => roleName[r] ?? r).join(" or ")} can decide this step.</span>
        )}
      </div>
      {(gapRuns || mode !== "none") && (
        <div className="space-y-3 border-t border-rule px-[22px] py-4">
          {gapRuns ? <UncoveredRuns runs={gapRuns} /> : <StepBody item={item} editing={mode === "edit"} override={override} setOverride={setOverride} />}
          {item.can_decide && (
            <label className="block max-w-md">
              <span className="sr-only">Note for the audit log</span>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)"
                className="h-10 w-full rounded-[10px] border border-rule px-3 text-[13px] focus:border-route focus:outline-hidden" />
            </label>
          )}
        </div>
      )}
    </section>
  );
}

function ShopCard({ wf, onDone }: { wf: WD; onDone: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const wo = wf.checkpoint.work_order!;
  const status = wf.work_order_status;
  const isShop = user?.role === "shop_manager" || user?.role === "admin";
  async function act(action: "start" | "close") {
    try {
      await api.post(`/products/asset-mgmt/work-orders/${wo.work_order_id}/${action}`, action === "close" ? { resolution: "Repaired and road tested" } : {});
      toast(action === "start" ? `Work started on ${wo.work_order_id}.` : `Closed ${wo.work_order_id}. The agent will return ${wf.vehicle_label} to service.`);
      onDone();
    } catch (e: any) { toast(e.message, "error"); }
  }
  return (
    <section aria-label="Action required" className="card flex flex-wrap items-center gap-4 border-signal-line px-[22px] py-4">
      <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-signal-tint text-signal-ink"><Wrench className="h-[18px] w-[18px]" aria-hidden /></span>
      <div className="min-w-[300px] flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-signal-ink">Waiting on the shop · Step 7 · Return to service</div>
        <div className="mt-[3px] text-[15px] font-semibold">{wo.work_order_id} · {status === "in_progress" ? "work under way" : status === "open" ? "not started yet" : "checking maintenance…"}</div>
        <div className="mt-0.5 text-[13px] text-ink-soft">
          {status === "in_progress" ? `Closing the work order returns ${wf.vehicle_label} to the schedule automatically.` : "The shop starts work first; once it is under way the work order can be closed."}
          {!isShop && " The shop manager does this."}
        </div>
      </div>
      {isShop && status === "open" && <button type="button" onClick={() => act("start")} className="btn-lg bg-route px-[22px] font-semibold text-white hover:bg-route-dark">Start work</button>}
      {isShop && status === "in_progress" && <button type="button" onClick={() => act("close")} className="btn-lg bg-route px-[22px] font-semibold text-white hover:bg-route-dark">Close work order</button>}
    </section>
  );
}

function tabRows(tab: TabKey, wf: WD, delegations: Delegation[]): { a: ReactNode; b: ReactNode; c: ReactNode }[] {
  const a = wf.context?.assessment;
  if (tab === "overview") {
    if (!a) return [{ a: "Assessment", b: wf.summary || "Assessment in progress.", c: "Agent" }];
    const cover: any[] = (wf.checkpoint.assignments?.length ? wf.checkpoint.assignments : a.proposals) || [];
    return [
      { a: "Fault", b: `${a.fault.description} (${a.fault.code}, ${a.fault.system})`, c: "Telematics" },
      { a: "Vehicle", b: `${a.vehicle.vehicle_type}, ${a.vehicle.capacity} seats, ${a.vehicle.wheelchair_positions} wheelchair positions, ${a.vehicle.depot}`, c: "FASTER" },
      { a: "Asset", b: `${a.health.year} ${a.health.make} ${a.health.model}, ${a.health.odometer?.toLocaleString()} mi, PM ${a.health.pm_miles_over >= 0 ? `${a.health.pm_miles_over} mi overdue` : "current"}`, c: "FASTER" },
      { a: "Timing", b: a.timing_reason, c: "Agent" },
      { a: "Out of service", b: `${dayTime(a.oos_from)} to ${dayTime(a.oos_until)}`, c: "Agent" },
      { a: "Runs at risk", b: a.runs_at_risk.length === 0 ? "None" : cover.map((x) => `${x.route_name} ${x.block_name} · ${x.riders} riders · ${x.vehicle_label ? `cover: ${x.vehicle_label} with ${x.driver_name ?? "—"}${x.delay_minutes ? ` (+${x.delay_minutes} min)` : ""}` : "no cover"}`).join("; "), c: "TripMaster" },
      { a: "Safety", b: [
        wf.checkpoint.defect ? `Defect ${wf.checkpoint.defect.defect_id} recorded` : a.safety?.open_defects?.length ? `${a.safety.open_defects.length} open defect(s)` : "No open defects",
        a.safety?.noncompliant_drivers?.length ? `${a.safety.noncompliant_drivers.length} driver(s) excluded as out of compliance` : null,
      ].filter(Boolean).join("; "), c: "Vestige" },
    ];
  }
  if (tab === "trail") {
    if (!wf.audit.length) return [{ a: "No records yet", b: "", c: "" }];
    return wf.audit.map((r) => ({
      a: sentence(r.record_type),
      b: r.explanation || (r.human_action ? `${sentence(r.human_action)}: ${words(r.step)}` : r.step ? words(r.step) : ""),
      c: `${seconds(r.created_at)} · ${r.actor}`,
    }));
  }
  if (tab === "agents") {
    const by = new Map<string, Delegation[]>();
    delegations.forEach((d) => by.set(d.agent, [...(by.get(d.agent) || []), d]));
    if (!by.size) return [{ a: "No agent activity yet", b: "", c: "" }];
    return [...by.entries()].map(([agent, ds]) => ({
      a: agent, b: <AgentTasks tasks={[...new Set(ds.map((d) => d.task))]} failed={new Set(ds.filter((d) => d.status === "failed").map((d) => d.task))} />,
      c: `${ds.length} task${ds.length === 1 ? "" : "s"} · ${ds.reduce((n, d) => n + d.duration_ms, 0)} ms${ds.some((d) => d.status === "failed") ? " · failed" : ""}`,
    }));
  }
  if (!wf.notifications.length) return [{ a: "Nothing sent yet", b: "Riders are told once their run moves to a spare vehicle (step 6), by SMS, app or email in their language.", c: "TripShot / Passio" }];
  return wf.notifications.map((n) => ({ a: n.rider_name, b: n.message, c: `${n.channel} · ${n.language} · ${time(n.created_at)} · ${kindLabel(n.kind)}` }));
}

/** What an agent did, set apart from people's text by the agent font: its own task names, comma separated. */
function AgentTasks({ tasks, failed }: { tasks: string[]; failed: Set<string> }) {
  return (
    <span className="font-agent text-[12.5px] text-ink">
      {tasks.map((t, i) => (
        <span key={t}>
          <span className={failed.has(t) ? "text-stop" : undefined}>{t}</span>{i < tasks.length - 1 && ", "}
        </span>
      ))}
    </span>
  );
}
