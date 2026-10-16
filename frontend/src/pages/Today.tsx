import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Check, Database, Eye, FlaskConical, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { ago, dayTime, roleName, sentence } from "../lib/format";
import type { Approval, Workflow } from "../lib/types";
import LineMap from "../components/LineMap";
import { initialOverride, StepBody, UncoveredRuns } from "../components/DecisionCard";
import { Drawer, kbdCls, useSandbox } from "../components/focus";
import { useToast } from "../components/Toast";
import { ErrorNote, Json, Loading } from "../components/ui";

/* Needs your attention: the approval surface for agent actions (proposal §4.1). A queue of decisions on the left,
   one decision in focus on the right. Operators approve, reject or override. */

const verb: Record<string, string> = { approve: "Approved", reject: "Rejected", override: "Overridden and approved", acknowledge: "Acknowledged" };
const shortAction: Record<string, string> = {
  open_work_order: "Open work order", pull_vehicle: "Pull vehicle", reassign_runs: "Reassign runs",
  adjust_schedule: "Adjust schedule", notify_riders: "Notify riders", return_to_service: "Return to service",
};
const SEV: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RANK: Record<string, number> = { escalation: 0, approval: 1, informational: 2 };
const CHANGEABLE = ["open_work_order", "pull_vehicle", "reassign_runs", "adjust_schedule"];

function question(a: Approval) {
  const v = a.vehicle_label ?? "this vehicle";
  if (a.kind !== "approval") return a.title;
  if (a.step === "open_work_order") return `Open a work order for ${v}?`;
  if (a.step === "pull_vehicle") return `Pull vehicle ${v} from the schedule?`;
  if (a.step === "reassign_runs") return `Reassign the affected runs for ${v}?`;
  return `${a.title}?`;
}
// the proposal in one sentence; the full text is behind "Agent reasoning"
const lead = (t: string) => (t.length > 180 ? t.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? t : t);
const kindUi = (a: Approval) => a.kind === "escalation"
  ? { label: "Manual action", dot: "bg-stop", ink: "text-[#A12A1A]" }
  : a.kind === "informational" ? { label: "For your information", dot: "bg-route", ink: "text-route-dark" }
  : { label: "Approval", dot: "bg-signal", ink: "text-[#8A5A00]" };

export default function Today() {
  const toast = useToast();
  const sandbox = useSandbox();
  const [showDecided, setShowDecided] = useState(false);
  const status = showDecided ? "approved,rejected,overridden,acknowledged" : "pending";
  const { data, error, reload } = useData<Approval[]>(`/api/approvals?status=${status}&limit=60`, [showDecided]);
  const { data: wfs } = useData<Workflow[]>("/api/workflows?limit=200");
  const { data: pol } = useData<{ rules: { mode?: string } }>("/api/policies/vehicle_health");
  const byId = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w])), [wfs]);

  // items from both use cases (vehicle health and no-show recovery), and only this list's state (right after switching, `data` may still hold the other list)
  const list = useMemo(() => {
    const items = (data || []).filter((a) => (a.status === "pending") === !showDecided && (!wfs || byId[a.workflow_id]));
    return items.sort((a, b) => showDecided
      ? (b.decided_at ?? "").localeCompare(a.decided_at ?? "")
      : (RANK[a.kind] - RANK[b.kind]) || ((SEV[a.severity ?? "low"] ?? 4) - (SEV[b.severity ?? "low"] ?? 4)) || a.requested_at.localeCompare(b.requested_at));
  }, [data, showDecided, wfs, byId]);

  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get("decision"));
  const current = list.find((a) => a.id === selected) ?? list[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<"why" | "data" | null>(null);
  useEffect(() => { setEditing(false); if (current) setOverride(initialOverride(current)); }, [current?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function send(a: Approval, action: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/approvals/${a.id}/decision`, { action, note: notes[a.id] || undefined, override: action === "override" ? override : undefined });
      toast(`${verb[action]}: ${a.title}`);
      setSelected(null);  // focus moves to the most urgent item, often this bus's next step
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  // keyboard: A approve, R reject, O override, J/K move through the queue
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (drawer || e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, select, [role=dialog]")) return;
      const k = e.key.toLowerCase(), i = list.findIndex((a) => a.id === current?.id);
      if (k === "j" || k === "arrowdown") { if (list[i + 1]) { e.preventDefault(); setSelected(list[i + 1].id); } return; }
      if (k === "k" || k === "arrowup") { if (list[i - 1]) { e.preventDefault(); setSelected(list[i - 1].id); } return; }
      if (!current || current.status !== "pending" || !current.can_decide || editing) return;
      if (k === "a") send(current, current.kind === "approval" ? "approve" : "acknowledge");
      if (k === "r" && current.kind === "approval") send(current, "reject");
      if (k === "o" && current.kind === "approval" && changeable(current)) setEditing(true);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  const changeable = (a: Approval) => CHANGEABLE.includes(a.step) && (a.step !== "adjust_schedule" || (a.options?.modes || []).length > 1);

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col lg:flex-row">
      <section aria-label={showDecided ? "Decided" : "Waiting for you"} className="flex shrink-0 flex-col gap-1 border-b border-rule bg-[#FAFBFB] px-3.5 py-5 lg:w-[340px] lg:border-b-0 lg:border-r">
        <div className="flex items-baseline justify-between px-2.5 pb-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{showDecided ? "Decided" : "Waiting for you"}</h2>
          <span className="text-xs text-ink-faint">{showDecided ? "Newest first" : "Most urgent first"}</span>
        </div>
        {error && <ErrorNote message={error} />}
        {!data ? <Loading /> : list.length === 0 ? (
          <p className="px-2.5 py-3 text-sm text-ink-faint">{showDecided ? "Nothing decided yet." : "Nothing waiting."}</p>
        ) : list.map((a) => {
          const k = kindUi(a), w = byId[a.workflow_id], idx = w?.steps.findIndex((s) => s.key === a.step) ?? -1, on = a.id === current?.id;
          return (
            <button key={a.id} type="button" onClick={() => setSelected(a.id)} aria-current={on}
              className={`flex w-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors ${on ? "border-[1.5px] border-ink bg-white shadow-[0_6px_16px_-8px_rgba(15,23,32,0.25)]" : "border-transparent hover:border-[#E1E4E8] hover:bg-white"}`}>
              <span className="flex w-full items-center gap-2 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${k.dot}`} aria-hidden />
                <span className={`font-semibold ${k.ink}`}>{k.label}{a.kind === "approval" && idx >= 0 ? ` · step ${idx + 1} of ${w!.steps.length}` : ""}</span>
                <span className="ml-auto text-ink-faint">{a.status === "pending" ? ago(a.requested_at).replace(" ago", "") : sentence(a.status)}</span>
              </span>
              <span className="flex items-baseline gap-1.5 text-[15px] font-semibold leading-snug">
                {a.vehicle_label && <span className="rounded-[5px] bg-ink px-1.5 py-0.5 font-mono text-xs text-white">{a.vehicle_label}</span>}
                <span>{a.kind === "approval" ? shortAction[a.step] ?? a.title : a.title.replace(` for ${a.vehicle_label}`, "")}</span>
              </span>
              <span className="text-[13px] text-ink-faint">{w?.workflow_type === "no_show_recovery" ? "No-Show Recovery · " : ""}{(w?.title ?? "").replace(`${a.vehicle_label}: `, "")}{a.severity ? ` · ${sentence(a.severity)}` : ""}</span>
            </button>
          );
        })}
        <div className="mt-3.5 border-t border-rule px-2.5 pt-3">
          <button className="text-sm font-medium text-route hover:underline" onClick={() => { setShowDecided(!showDecided); setSelected(null); }}>
            {showDecided ? "← Back to waiting" : "Show decided"}
          </button>
        </div>
      </section>

      <div className="flex min-w-0 flex-1 flex-col">
        {pol?.rules.mode === "shadow" && (
          <div className="flex items-center gap-2 border-b border-route/20 bg-route-tint px-6 py-2.5 text-sm text-route-dark sm:px-14">
            <Eye className="h-4 w-4" aria-hidden /><span className="flex-1"><b>Shadow mode is on.</b> The agent records what it would do at each step but takes no action.</span>
            <Link to="/shadow" className="font-semibold underline">Compare</Link>
          </div>
        )}
        {!current ? (
          <div className="m-auto max-w-md px-6 py-16 text-center">
            <span className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-go-tint text-go"><Check className="h-6 w-6" strokeWidth={2.2} aria-hidden /></span>
            <h2 className="text-lg font-semibold">{showDecided ? "No decisions yet" : "You're all caught up"}</h2>
            <p className="mt-1.5 text-ink-faint">New decisions appear here the moment the agent needs a person, as your autonomy policy sets.</p>
            {!showDecided && <Link to="/simulate" onClick={() => sandbox.set(true)} className="btn-quiet mt-5"><FlaskConical className="h-4 w-4" aria-hidden /> Simulate a vehicle fault</Link>}
          </div>
        ) : <Focus a={current} w={byId[current.workflow_id]} editing={editing} setEditing={setEditing} override={override} setOverride={setOverride}
            note={notes[current.id] ?? ""} setNote={(v) => setNotes({ ...notes, [current.id]: v })} busy={busy} send={send} changeable={changeable(current)} openDrawer={setDrawer} />}
      </div>

      {drawer && current && (
        <Drawer title={drawer === "why" ? "Agent reasoning" : "Data considered"} subtitle={`${current.vehicle_label ?? ""} · ${current.title}`} onClose={() => setDrawer(null)}>
          {drawer === "why" ? (
            <>
              <p className="text-[15px] leading-relaxed">{current.summary || current.explanation}</p>
              {current.summary && current.explanation && current.summary !== current.explanation && (
                <div className="rounded-xl bg-route-tint/60 px-4 py-3 text-sm leading-relaxed"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-route-dark"><Sparkles className="h-3.5 w-3.5" aria-hidden />Recommendation</div>{current.explanation}</div>
              )}
            </>
          ) : Object.keys(current.data_considered || {}).length ? <Json value={current.data_considered} /> : <p className="text-ink-faint">No data recorded for this step.</p>}
        </Drawer>
      )}
    </div>
  );
}

function Focus({ a, w, editing, setEditing, override, setOverride, note, setNote, busy, send, changeable, openDrawer }: {
  a: Approval; w?: Workflow; editing: boolean; setEditing: (v: boolean) => void; override: Record<string, any>; setOverride: (o: Record<string, any>) => void;
  note: string; setNote: (v: string) => void; busy: boolean; send: (a: Approval, action: string) => void; changeable: boolean; openDrawer: (d: "why" | "data") => void;
}) {
  const k = kindUi(a), pending = a.status === "pending";
  const gapRuns: any[] | null = a.kind === "escalation" && a.recommendation?.uncovered_runs?.length ? a.recommendation.uncovered_runs : null;
  return (
    <>
      <div className="flex w-full max-w-[880px] flex-1 flex-col gap-7 px-4 py-8 sm:px-14 sm:py-10">
        <div className="flex flex-col gap-2.5">
          <div className={`text-[13px] font-semibold ${k.ink}`}>
            {a.kind === "escalation" ? "Manual action needed" : a.kind === "informational" ? "For your information · informational step" : "Approval needed · semi-autonomous step"}
            {a.approver_roles.length > 0 && ` · ${a.approver_roles.map((r) => roleName[r] ?? r).join(" or ")}`} · asked {ago(a.requested_at)}
          </div>
          <h2 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[34px]">{question(a)}</h2>
          {a.explanation && <p className="max-w-[640px] text-[17px] leading-relaxed text-ink-soft">{lead(a.explanation)}</p>}
        </div>

        {w && <LineMap steps={w.steps} medium />}

        {pending && (gapRuns ? <UncoveredRuns runs={gapRuns} /> : a.kind === "approval" ? (
          <div className="border-y border-rule py-6 [&_dl]:gap-y-3.5 [&_dl]:text-[15px]">
            <StepBody item={a} editing={editing} override={override} setOverride={setOverride} />
          </div>
        ) : null)}

        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => openDrawer("why")} className="inline-flex items-center gap-2 rounded-full bg-[#F3F5F6] px-4 py-2 text-sm hover:bg-rule"><Sparkles className="h-4 w-4" aria-hidden />Agent reasoning</button>
          {Object.keys(a.data_considered || {}).length > 0 && (
            <button type="button" onClick={() => openDrawer("data")} className="inline-flex items-center gap-2 rounded-full bg-[#F3F5F6] px-4 py-2 text-sm hover:bg-rule"><Database className="h-4 w-4" aria-hidden />Data considered</button>
          )}
          <Link to={`/workflows/${a.workflow_id}`} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm">Open orchestration <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>

        {pending && a.can_decide && (
          <div className="hidden flex-wrap gap-3.5 text-xs text-ink-faint lg:flex">
            <span><kbd className={kbdCls}>A</kbd> {a.kind === "approval" ? "approve" : "acknowledge"}</span>
            {a.kind === "approval" && <span><kbd className={kbdCls}>R</kbd> reject</span>}
            {a.kind === "approval" && changeable && <span><kbd className={kbdCls}>O</kbd> override</span>}
            <span><kbd className={kbdCls}>J</kbd>/<kbd className={kbdCls}>K</kbd> next / previous</span>
          </div>
        )}
      </div>

      {!pending ? (
        <div className="border-t border-rule px-4 py-4 text-sm text-ink-faint sm:px-14">
          {sentence(a.status)} by <b className="text-ink">{a.decided_by_name}</b> on {dayTime(a.decided_at)}{a.decision_note ? ` — “${a.decision_note}”` : ""}.
        </div>
      ) : !a.can_decide ? (
        <div className="border-t border-rule px-4 py-4 text-sm text-ink-faint sm:px-14">
          Only {a.approver_roles.map((r) => roleName[r] ?? r).join(" or ")} can decide this step under the autonomy policy. Sign in with that role to act on it.
        </div>
      ) : (
        <footer className="sticky bottom-16 flex flex-wrap items-center gap-3 border-t border-rule bg-white/95 px-4 py-4 backdrop-blur sm:px-14 lg:bottom-0">
          <label className="min-w-[220px] max-w-[420px] flex-1">
            <span className="sr-only">Note for the record</span>
            <input className="input h-11" placeholder="Add a note for the record (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <span className="flex-1" />
          {a.kind !== "approval" ? (
            <button className="btn-primary h-11 px-6" disabled={busy} onClick={() => send(a, "acknowledge")}><Check className="h-4 w-4" aria-hidden />{a.kind === "escalation" ? "Done, I've handled it" : "Acknowledge"}</button>
          ) : editing ? (
            <>
              <button className="btn-quiet h-11" disabled={busy} onClick={() => { setEditing(false); setOverride(initialOverride(a)); }}>Cancel override</button>
              <button className="btn-primary h-11 px-6" disabled={busy} onClick={() => send(a, "override")}>Approve with override</button>
            </>
          ) : (
            <>
              <button className="btn-danger h-11" disabled={busy} onClick={() => send(a, "reject")}>Reject</button>
              {changeable && <button className="btn-quiet h-11" disabled={busy} onClick={() => setEditing(true)}>Override</button>}
              <button className="btn-primary h-11 px-6" disabled={busy} onClick={() => send(a, "approve")}>Approve</button>
            </>
          )}
        </footer>
      )}
    </>
  );
}
