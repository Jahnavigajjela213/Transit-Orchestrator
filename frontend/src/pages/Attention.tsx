import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData, useLive } from "../lib/live";
import { ago, clockET, roleName, sentence, words } from "../lib/format";
import type { Approval, Step, Workflow, WorkflowDetail } from "../lib/types";
import { initialOverride, StepBody, UncoveredRuns } from "../components/DecisionCard";
import { loadCatalogue, type AgentsResponse } from "../components/AgentFlow";
import { useToast } from "../components/Toast";
import AskPanel from "../components/AskPanel";
import { ErrorNote, Loading } from "../components/ui";

/**
 * Needs your attention, as the Focus Queue: the queue of decisions on the left (collapsible), one decision in focus,
 * its context (agents, trail, systems, riders) in a drawer that opens only on request, and the decision bar.
 * Keyboard: J / K move through the queue, A approves (or acknowledges), R rejects, C changes.
 */

type Kind = "all" | "escalation" | "approval";
type DrawerKey = "ask" | "agents" | "trail" | "systems" | "riders";

const SEV_DOT: Record<string, string> = { critical: "#B42318", high: "#D98A00", medium: "#0B6E69", low: "#7D8891" };
const verb: Record<string, string> = { approve: "Approved", reject: "Rejected", override: "Changed and approved", acknowledge: "Acknowledged" };
const EDITABLE = ["open_work_order", "pull_vehicle", "reassign_runs"];

export default function Attention() {
  const { user } = useAuth();
  const { connected } = useLive();
  const toast = useToast();
  const { data, error, reload } = useData<Approval[]>("/api/approvals?status=pending&limit=60");
  const { data: wfs } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=200");
  const [cat, setCat] = useState<AgentsResponse | null>(null);
  useEffect(() => { loadCatalogue().then(setCat).catch(() => {}); }, []);

  const [queueOpen, setQueueOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);
  const narrow = () => typeof window !== "undefined" && window.innerWidth < 768;
  const [kind, setKind] = useState<Kind>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [drawerStep, setDrawerStep] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(clockET());
  useEffect(() => { const id = window.setInterval(() => setClock(clockET()), 15000); return () => window.clearInterval(id); }, []);

  const byId = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w])), [wfs]);
  // Only vehicle-health orchestrations; manual actions first, then by severity, then oldest.
  const all = useMemo(() => {
    const rank: Record<string, number> = { escalation: 0, approval: 1, informational: 2 };
    const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (data || []).filter((a) => a.status === "pending" && (!wfs || byId[a.workflow_id]))
      .sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((sev[a.severity ?? "low"] ?? 4) - (sev[b.severity ?? "low"] ?? 4)) || a.requested_at.localeCompare(b.requested_at));
  }, [data, wfs, byId]);
  const queue = all.filter((a) => kind === "all" || a.kind === kind || (kind === "approval" && a.kind === "informational"));
  const escalations = all.filter((a) => a.kind === "escalation").length;
  const current = queue.find((a) => a.id === picked) ?? queue[0] ?? null;
  const wf = current ? byId[current.workflow_id] : null;
  const steps: Step[] = wf?.steps ?? [];
  const stepIndex = current ? steps.findIndex((s) => s.key === current.step) : -1;
  const esc = current?.kind === "escalation";

  // The selected decision's orchestration, for the context drawer.
  const { data: detail } = useData<WorkflowDetail>(current ? `/api/workflows/${current.workflow_id}` : null, [current?.workflow_id]);

  // A new decision in focus starts clean.
  useEffect(() => { setEditing(false); setNote(""); setOverride(current ? initialOverride(current) : {}); setDrawerStep(null); }, [current?.id]);

  async function send(action: string) {
    if (!current || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/approvals/${current.id}/decision`, { action, note: note || undefined, override: action === "override" ? override : undefined });
      toast(`${verb[action]}: ${current.title}`);
      const i = queue.findIndex((a) => a.id === current.id);
      setPicked(queue[i + 1]?.id ?? queue[i - 1]?.id ?? null);
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  const canDecide = !!current?.can_decide;
  const canChange = !!current && current.kind === "approval" && EDITABLE.includes(current.step);
  const primary = () => (esc || current?.kind === "informational" ? send("acknowledge") : editing ? send("override") : send("approve"));

  // Keyboard: J/K move, A approve, R reject, C change (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const i = current ? queue.findIndex((a) => a.id === current.id) : -1;
      const k = e.key.toLowerCase();
      if (k === "j" && queue[i + 1]) setPicked(queue[i + 1].id);
      else if (k === "k" && i > 0) setPicked(queue[i - 1].id);
      else if (k === "a" && canDecide) primary();
      else if (k === "r" && canDecide && current?.kind === "approval") send("reject");
      else if (k === "c" && canDecide && canChange) setEditing((x) => !x);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const plan = cat?.plans.vehicle_health ?? [];
  const agentNames = (key: string) => (plan.find((p) => p.step === key)?.agents ?? [])
    .map((a) => (cat?.agents.find((x) => x.key === a.key)?.name ?? a.key).replace(" agent", "")).join(" · ");

  return (
    <>
      {/* ---------------------------------------------------------------- queue */}
      {queueOpen && (
        <section aria-label="Decision queue" className="flex w-[320px] shrink-0 flex-col border-r border-rule bg-white max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-14 max-md:z-30 max-md:w-full">
          <div className="flex items-center gap-2 px-[18px] pb-3 pt-[18px]">
            <h2 className="flex-1 text-[15px] font-semibold">Queue <span className="font-medium text-ink-faint">{all.length}</span></h2>
            <button type="button" onClick={() => setQueueOpen(false)} aria-label="Collapse the queue"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rule bg-white text-ink-soft hover:text-ink">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 px-[18px] pb-3" role="radiogroup" aria-label="Kind">
            {([["all", "All", all.length], ["escalation", "Manual action", escalations], ["approval", "Approvals", all.length - escalations]] as [Kind, string, number][]).map(([k, l, n]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={`rounded-full px-2.5 py-[5px] text-xs ${kind === k ? "bg-ink font-medium text-white" : "border border-rule text-ink-soft hover:text-ink"}`}>
                {l} {n}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 pb-3">
            {error && <ErrorNote message={error} />}
            {!data ? <Loading /> : queue.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-ink-soft">Nothing waiting here.</p>
            ) : queue.map((a) => {
              const on = current?.id === a.id;
              const sIdx = (byId[a.workflow_id]?.steps ?? []).findIndex((s) => s.key === a.step);
              const sLabel = byId[a.workflow_id]?.steps?.[sIdx]?.label ?? sentence(a.step);
              return (
                <button key={a.id} type="button" onClick={() => { setPicked(a.id); if (narrow()) setQueueOpen(false); }} aria-current={on}
                  className={`mt-1.5 block w-full rounded-xl px-3 py-3 text-left ${on ? "border border-[#9FCFC8] bg-[#F1F7F6]" : "border border-transparent hover:bg-panel"}`}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_DOT[a.severity ?? "low"] }} aria-hidden />
                    <span className="chip-v">{a.vehicle_label}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{shortTitle(a)}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">{ago(a.requested_at).replace(" ago", "")}</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                    <span className={`font-semibold ${a.kind === "escalation" ? "text-stop" : "text-signal-ink"}`}>{a.kind === "escalation" ? "Manual action" : a.kind === "informational" ? "For your information" : "Approval"}</span>
                    {sIdx >= 0 && <span>Step {sIdx + 1}/7 · {sLabel}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="border-t border-rule px-[18px] py-3 text-[11px] text-ink-faint">J / K to move · A approve · R reject · C change</p>
        </section>
      )}
      {/* collapsed: a slim strip of the queue's vehicles, still one click from each decision */}
      {!queueOpen && (
        <section aria-label="Decision queue, collapsed" className="hidden w-[76px] shrink-0 flex-col items-center border-r border-rule bg-white md:flex">
          <button type="button" onClick={() => setQueueOpen(true)} aria-label="Expand the queue" title="Expand the queue"
            className="mt-[18px] flex h-8 w-8 items-center justify-center rounded-lg border border-signal-line bg-signal-tint text-signal-ink hover:border-signal">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </button>
          <div className="mt-3 flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 pb-3">
            {queue.map((a) => {
              const on = current?.id === a.id;
              const sIdx = (byId[a.workflow_id]?.steps ?? []).findIndex((s) => s.key === a.step);
              return (
                <button key={a.id} type="button" onClick={() => setPicked(a.id)} aria-current={on}
                  title={`${a.vehicle_label} · ${shortTitle(a)}${sIdx >= 0 ? ` · step ${sIdx + 1}/7` : ""}`}
                  className={`flex w-full justify-center rounded-[10px] py-2 ${on ? "border border-[#9FCFC8] bg-[#F1F7F6]" : "border border-transparent hover:bg-panel"}`}>
                  <span className="chip-v">{a.vehicle_label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- focus */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-white px-4 sm:px-6">
          <span className="hidden text-ink-faint sm:inline">Needs your attention</span>
          {current && <><ChevronRight className="hidden h-3.5 w-3.5 text-ink-faint sm:block" aria-hidden /><span className="font-semibold">{current.vehicle_label}</span></>}
          <span className="flex-1" />
          <span className="hidden text-xs text-ink-soft tnum sm:inline" title="All times are US Eastern">{clock} ET</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-soft"><span className={`h-2 w-2 rounded-full ${connected ? "bg-go" : "bg-stop"}`} aria-hidden />{connected ? "Live" : "Reconnecting"}</span>
          <span className="hidden rounded-full bg-[#EEF1F0] px-2.5 py-1 text-xs text-ink-soft lg:inline">{user?.tenant_name}</span>
        </header>
        {!queueOpen && queue.length > 0 && (
          <nav aria-label="Decision queue" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-rule bg-white px-4 py-2.5 md:hidden">
            <button type="button" onClick={() => setQueueOpen(true)} aria-label="Show the queue"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-signal-line bg-signal-tint text-signal-ink"><AlertTriangle className="h-4 w-4" aria-hidden /></button>
            {queue.map((a) => (
              <button key={a.id} type="button" onClick={() => setPicked(a.id)} aria-current={current?.id === a.id}
                className={`shrink-0 rounded-[10px] px-1.5 py-1.5 ${current?.id === a.id ? "border border-[#9FCFC8] bg-[#F1F7F6]" : "border border-transparent"}`}>
                <span className="chip-v">{a.vehicle_label}</span>
              </button>
            ))}
          </nav>
        )}

        {!data ? <div className="p-8"><Loading /></div> : !current ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <p className="text-lg font-semibold">You're all caught up</p>
              <p className="mt-1 text-sm text-ink-soft">New decisions appear here as soon as the agent needs a person. <Link to="/simulate" className="font-medium">Simulate a vehicle fault</Link> to start one.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="relative flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${esc ? "text-stop" : "text-signal-ink"}`}>
                    {esc ? "Manual action needed" : current.kind === "informational" ? "For your information" : "Approval needed"}
                    {stepIndex >= 0 && <> · Step {stepIndex + 1} of 7 · {steps[stepIndex].label}</>}
                  </div>
                  <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[21px] font-semibold tracking-[-0.01em] sm:text-[26px]">
                    <span className="rounded-[7px] bg-ink px-[9px] py-1 font-mono text-[15px] font-medium text-white">{current.vehicle_label}</span>
                    {shortTitle(current)}
                  </h1>
                  <p className="mt-2 text-[13px] text-ink-soft">
                    {sentence(current.severity)} · requested {ago(current.requested_at)} · for {current.approver_roles.map((r) => roleName[r] ?? r).join(" or ")}
                  </p>
                </div>

                {steps.length > 0 && (
                  <section aria-label="Seven-step flow" className="card overflow-x-auto px-5 pb-4 pt-5">
                    <ol className="grid min-w-[600px] grid-cols-7">
                      {steps.map((s, i) => (
                        <StepNode key={s.key} step={s} n={i + 1} last={i === steps.length - 1} travelled={i < stepIndex} agents={agentNames(s.key)}
                          onAgents={agentNames(s.key) ? () => { setDrawer("agents"); setDrawerStep(s.key); } : undefined} />
                      ))}
                    </ol>
                  </section>
                )}

                {esc && current.recommendation?.uncovered_runs?.length ? (
                  <section className="card p-5"><UncoveredRuns runs={current.recommendation.uncovered_runs} /></section>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    <section className="card p-5 lg:col-span-3">
                      <h2 className="eyebrow mb-3.5">{current.kind === "approval" ? "Proposed action" : "Summary"}</h2>
                      {current.kind === "approval"
                        ? <StepBody item={current} editing={editing} override={override} setOverride={setOverride} />
                        : <p className="text-sm leading-relaxed">{current.summary}</p>}
                    </section>
                    <section className="rounded-[14px] border border-reason-line bg-reason p-5 lg:col-span-2">
                      <h2 className="mb-2.5 text-[11px] uppercase tracking-[0.08em] text-route-dark">{esc ? "What happened" : "Agent reasoning"}</h2>
                      <p className="text-sm leading-[1.6]">{current.explanation || current.summary}</p>
                      {current.kind === "approval" && current.summary && current.summary !== current.explanation && (
                        <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-route">Full assessment</summary>
                          <p className="mt-1.5 leading-relaxed text-ink-soft">{current.summary}</p></details>
                      )}
                    </section>
                  </div>
                )}
              </div>

              <ContextDrawer open={drawer} setOpen={(k) => { setDrawer(k); if (k !== "agents") setDrawerStep(null); }} detail={detail ?? null}
                stepKey={drawerStep ?? current.step} cat={cat}
                ask={<AskPanel key={current.workflow_id} workflowId={current.workflow_id} vehicle={current.vehicle_label} agency={user?.tenant_name} />} />
            </div>

            {/* ------------------------------------------------------------ decision bar */}
            <footer className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-rule bg-white px-4 py-3 sm:gap-3 sm:px-6 lg:px-8 lg:py-3.5">
              {canDecide ? (
                <>
                  <label className="min-w-[200px] max-w-[460px] flex-1 basis-full sm:basis-auto">
                    <span className="sr-only">Note for the audit log</span>
                    <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)"
                      className="h-11 w-full rounded-[10px] border border-rule px-3.5 text-sm focus:border-route focus:outline-hidden" />
                  </label>
                  <span className="flex-1" />
                  <Link to={`/workflows/${current.workflow_id}`} className="mr-1 hidden text-[13px] font-medium md:inline">Open orchestration</Link>
                  {current.kind === "approval" && (
                    <button type="button" disabled={busy} onClick={() => send("reject")} className="btn-lg border border-stop-line bg-white text-stop hover:bg-stop-tint">
                      Reject <span className="text-[11px] opacity-60">R</span>
                    </button>
                  )}
                  {canChange && (
                    <button type="button" disabled={busy} onClick={() => { if (editing) setOverride(initialOverride(current)); setEditing(!editing); }} className="btn-lg border border-rule bg-white text-ink hover:bg-panel">
                      {editing ? "Cancel changes" : "Change"} <span className="text-[11px] opacity-60">C</span>
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={primary} className="btn-lg bg-route px-[22px] font-semibold text-white hover:bg-route-dark">
                    {esc || current.kind === "informational" ? "Acknowledge" : editing ? "Approve with changes" : "Approve"} <span className="text-[11px] opacity-70">A</span>
                  </button>
                </>
              ) : (
                <p className="text-sm text-ink-soft">Only {current.approver_roles.map((r) => roleName[r] ?? r).join(" or ")} can decide this step. Sign in with that role to act on it.</p>
              )}
            </footer>
          </>
        )}
      </div>
    </>
  );
}

/** The decision's own words, without the vehicle repeated ("Open work order for V-101" → "Open work order"). */
function shortTitle(a: Approval): string {
  return a.title.replace(new RegExp(`\\s*(for|on)\\s+${a.vehicle_label}\\b`), "").replace(`${a.vehicle_label} `, "").trim();
}

function StepNode({ step, n, last, travelled, agents, onAgents }: {
  step: Step; n: number; last: boolean; travelled: boolean; agents: string; onAgents?: () => void;
}) {
  const s = step.status;
  const red = s === "escalated" || s === "failed";
  const done = s === "done";
  const dot = done ? "bg-route text-white"
    : s === "awaiting_approval" ? "bg-signal text-white shadow-[0_0_0_6px_#FDF1DC]"
    : red ? "bg-stop text-white shadow-[0_0_0_6px_#FDECEA]"
    : s === "skipped" || s === "not_run" ? "border-2 border-dashed border-[#C9D1CE] bg-white text-ink-faint"
    : s === "active" || s === "waiting" ? "border-2 border-route bg-white text-route"
    : "border-2 border-[#C9D1CE] bg-white text-ink-faint";
  const state = s === "awaiting_approval" ? "Your decision" : s === "escalated" ? "Raised with you" : s === "waiting" ? "Waiting on the shop"
    : s === "pending" ? "Not yet" : s === "not_run" ? "Not reached" : sentence(s);
  return (
    <li className="relative flex flex-col items-center text-center" title={step.detail || step.label}>
      {!last && <span className={`absolute left-1/2 top-[14px] h-[3px] w-full ${travelled ? "bg-route" : "bg-rule"}`} aria-hidden />}
      <span className={`relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full text-xs font-semibold ${dot}`}>{n}</span>
      <span className={`mt-2.5 text-[12.5px] font-semibold ${s === "awaiting_approval" ? "text-signal-ink" : red ? "text-stop" : done ? "text-ink" : "text-ink-faint"}`}>{step.label}</span>
      <span className="mt-0.5 text-[11px] text-ink-faint">{state}</span>
      {agents && (
        <button type="button" onClick={onAgents} className="mt-1.5 rounded-full bg-[#F1F4F3] px-2 py-0.5 text-[10.5px] text-ink-soft hover:bg-route-tint hover:text-route-dark"
          aria-label={`${step.label}: show its agents`}>
          {agents}
        </button>
      )}
    </li>
  );
}

const SYSTEM_STATE: Record<string, string> = { done: "Synced", waiting: "In progress", not_yet: "Not yet", attention: "Needs a person" };

function ContextDrawer({ open, setOpen, detail, stepKey, cat, ask }: {
  open: DrawerKey | null; setOpen: (k: DrawerKey | null) => void; detail: WorkflowDetail | null; stepKey: string; cat: AgentsResponse | null; ask: ReactNode;
}) {
  const delegations: any[] = detail?.context?.delegations || [];
  const stepLabel = detail?.steps.find((s) => s.key === stepKey)?.label ?? sentence(stepKey);
  const plan = cat?.plans.vehicle_health.find((p) => p.step === stepKey);
  const agents = (plan?.agents ?? []).map((pa) => {
    const a = cat!.agents.find((x) => x.key === pa.key);
    const ran = delegations.filter((d) => d.step === stepKey && d.key === pa.key);
    return { title: `${a?.name ?? pa.key} · ${(a?.product ?? "").split(" (")[0]}`, body: pa.task, meta: ran.length ? `Ran ${ran.length} task${ran.length === 1 ? "" : "s"} · ${a?.data?.[0] ?? ""}` : `Not run yet · ${a?.data?.[0] ?? ""}`, link: a?.links?.[0] };
  });
  const trail = (detail?.audit ?? []).map((r) => ({ title: `${sentence(r.record_type)} · ${r.actor}`, body: r.explanation || words(r.outcome ?? ""), meta: new Date(r.created_at.replace(/(\.\d+)?$/, "")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }));
  const st = (k: string) => detail?.steps.find((s) => s.key === k)?.status;
  const wo = detail?.checkpoint.work_order;
  const systems = detail ? [
    { title: "Telematics → event in", body: detail.trigger_event ? `${detail.trigger_event.data?.fault_code ?? detail.trigger_event.type} from ${detail.trigger_event.source}` : "Fault detected", meta: SYSTEM_STATE.done },
    { title: "Maintenance · FASTER", body: wo ? `${wo.work_order_id} at ${wo.depot}${detail.work_order_status ? `, ${words(detail.work_order_status)}` : ""}` : "Work order not opened yet", meta: wo ? SYSTEM_STATE.done : SYSTEM_STATE.not_yet },
    { title: "Scheduling · TripMaster", body: detail.pulled_at ? `Pulled; ${detail.runs_covered} of ${detail.runs_at_risk} runs on spares` : `${detail.runs_at_risk} run(s) at risk`, meta: st("reassign_runs") === "escalated" ? SYSTEM_STATE.attention : st("reassign_runs") === "done" ? SYSTEM_STATE.done : SYSTEM_STATE.not_yet },
    { title: "Safety · Vestige", body: detail.checkpoint.defect ? `Defect ${detail.checkpoint.defect.defect_id} logged` : "Drivers and spares checked for compliance", meta: detail.checkpoint.defect ? SYSTEM_STATE.done : SYSTEM_STATE.not_yet },
    { title: "Rider comms · TripShot", body: detail.notification_count ? `${detail.notification_count} rider(s) notified` : "No riders notified yet", meta: st("notify_riders") === "done" ? SYSTEM_STATE.done : SYSTEM_STATE.not_yet },
  ] : [];
  const riders = (detail?.notifications ?? []).map((n) => ({ title: `${n.rider_name} · ${n.channel} · ${n.language}`, body: n.message, meta: words(n.kind) }));

  const tabs: [DrawerKey, string, number | null][] = [["ask", "Ask", null], ["agents", "Agents", plan?.agents.length ?? 0], ["trail", "Trail", trail.length], ["systems", "Systems", 5], ["riders", "Riders", detail?.notification_count ?? 0]];
  const rows = open === "agents" ? agents : open === "trail" ? trail : open === "systems" ? systems : open === "riders" ? riders : [];
  const title = open === "agents" ? `Agents · ${stepLabel}` : open === "trail" ? "Decision trail" : open === "systems" ? "Connected systems" : "Rider messages";

  return (
    <aside aria-label="Context" className="flex shrink-0 border-l border-rule bg-white">
      {open && (
        <div className="flex border-rule bg-white max-lg:absolute max-lg:inset-y-0 max-lg:right-16 max-lg:z-20 max-lg:w-[min(400px,calc(100vw-80px))] max-lg:border-l max-lg:shadow-[-16px_0_40px_-24px_rgba(16,24,40,0.35)] max-md:right-14 max-md:w-[calc(100vw-56px)]">
      {open === "ask" && ask}
      {open !== "ask" && (
        <div className="flex w-full flex-col gap-3.5 overflow-y-auto p-5 lg:w-[320px]">
          <div className="flex items-center">
            <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-[#F1F4F3] text-ink-soft"><X className="h-4 w-4" /></button>
          </div>
          {!detail ? <Loading /> : rows.length === 0 ? <p className="text-sm text-ink-soft">{open === "riders" ? "Riders are told once their runs move to a spare vehicle (step 6)." : "Nothing here yet."}</p>
            : rows.map((d: any, i) => (
              <div key={i} className="rounded-xl border border-rule px-3.5 py-3">
                <div className="text-[13px] font-semibold">{d.title}</div>
                <div className="mt-1 text-xs leading-normal text-ink-soft">{d.body}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-route">
                  <span className="flex-1">{d.meta}</span>
                  {d.link && <a href={d.link.url} target="_blank" rel="noreferrer" className="font-medium">{d.link.name} ↗</a>}
                </div>
              </div>
            ))}
        </div>
      )}
        </div>
      )}
      <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-l border-[#F1F4F3] py-4 md:w-16">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setOpen(open === k ? null : k)} title={label} aria-pressed={open === k}
            className={`flex h-14 w-11 flex-col items-center justify-center gap-0.5 rounded-xl md:w-[52px] ${open === k ? "bg-route text-white" : "border border-rule bg-white text-ink-soft hover:text-ink"}`}>
            {n === null ? <Sparkles className="h-4 w-4" aria-hidden /> : <span className="text-[15px] font-semibold tnum">{n}</span>}
            <span className="text-[10px]">{label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
