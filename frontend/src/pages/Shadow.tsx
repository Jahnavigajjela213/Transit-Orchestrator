import { useState } from "react";
import { Link } from "react-router-dom";
import { Handshake, Keyboard, Timer } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, easternNow, sentence, toLocalInput } from "../lib/format";
import type { ShadowRec } from "../lib/types";
import { DateTimeInput } from "../components/DateTimeInput";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Loading, PageHeader, SeverityTag, VehicleId } from "../components/ui";
import { StatTile } from "../components/dashboard/DashboardShell";

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
  const ms = new Date(iso).getTime() - easternNow().getTime();
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
          <label><span className="label">Shop from</span><DateTimeInput value={shopStart} onChange={(v) => setShopStart(v)} /></label>
          <label><span className="label">Shop until</span><DateTimeInput value={shopEnd} onChange={(v) => setShopEnd(v)} /></label>
        </div>
      )}
      {r.step === "pull_vehicle" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Out of service from</span><DateTimeInput value={from} onChange={(v) => setFrom(v)} /></label>
          <label><span className="label">Until</span><DateTimeInput value={until} onChange={(v) => setUntil(v)} /></label>
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

const VERDICT: Record<string, { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-go-tint text-go" }, differed: { label: "Differed", cls: "bg-signal-tint text-signal-ink" },
  open: { label: "Waiting for people", cls: "bg-[#EEF1F0] text-ink-soft" }, no_action: { label: "No action", cls: "bg-[#EEF1F0] text-ink-soft" },
};
const FILTERS: [string, string][] = [["", "All"], ["open", "Waiting for people"], ["matched", "Matched"], ["differed", "Differed"], ["no_action", "No action"]];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export default function Shadow() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);  // the row whose by-hand form is open
  const { data: summary } = useData<{ steps: StepSummary[]; total: number }>("/api/shadow/summary");
  const { data, error, reload } = useData<ShadowRec[]>(`/api/shadow${status ? `?status=${status}` : ""}`, [status]);
  const { data: all } = useData<ShadowRec[]>("/api/shadow");
  const { data: metrics } = useData<{ baseline: Record<string, number | null>; baseline_source: string }>("/api/metrics/summary");
  const { data: pol } = useData<{ rules: any }>("/api/policies/vehicle_health");
  const canReview = user?.role === "dispatcher" || user?.role === "shop_manager" || user?.role === "admin";
  const inShadow = pol?.rules?.mode === "shadow";

  // headline figures, computed from the shadow records themselves; "—" when there is nothing to compare yet
  const compared = (all || []).filter((r) => r.agreement_pct !== null);
  const agreement = compared.length ? Math.round(compared.reduce((n, r) => n + (r.agreement_pct ?? 0), 0) / compared.length) : null;
  const ahead = median((all || []).map((r) => r.agent_ahead_minutes).filter((x): x is number => x !== null));
  const manual = metrics?.baseline?.manual_reentries_per_incident ?? null;
  const dates = (all || []).map((r) => r.recommended_at).sort();

  async function review(id: string, verdict: string) {
    try { await api.post(`/api/shadow/${id}/review`, { verdict }); toast("Review saved"); reload(); } catch (e: any) { toast(e.message, "error"); }
  }
  async function noAction(id: string) {
    try { await api.post(`/api/shadow/${id}/no-action`); toast("Closed as no action needed"); reload(); } catch (e: any) { toast(e.message, "error"); }
  }
  async function measure() {
    try {
      const r = await api.post<{ sample: number }>("/api/metrics/baseline/measure");
      toast(`Baseline measured from ${r.sample} shadow incident(s).`);
    } catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <>
      <PageHeader title="Shadow mode" eyebrow={`Governance · ${dates.length ? `${dayTime(dates[0])} – ${dayTime(dates[dates.length - 1])}` : "no shadow runs yet"}`}
        intro="The agent decides silently while people work as usual; here the two are compared before any step goes live."
        actions={<>
          <Link to="/policies" className={`pill self-end px-3 py-1.5 ${inShadow ? "bg-route-tint text-route-dark" : "bg-go-tint text-go"}`}>
            {inShadow ? "Policy is in Shadow" : "Policy is Live · turn on Shadow"}
          </Link>
          {user?.role === "admin" && <button className="btn-lg h-9 bg-go px-3.5 text-[13px] font-semibold text-white hover:bg-go/90" onClick={measure}>Measure baseline</button>}
        </>} />

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <StatTile label="Agreement with people" icon={Handshake} value={agreement === null ? "—" : `${agreement}%`}
          sub={compared.length ? `across ${compared.length} compared recommendation${compared.length === 1 ? "" : "s"}` : "no data yet"} />
        <StatTile label="Agent ready earlier by" icon={Timer} value={ahead === null ? "—" : `${Math.round(ahead)} min`}
          sub={ahead === null ? "no data yet" : "median, agent vs first human action"} />
        <StatTile label="Manual entries avoided" icon={Keyboard} value={manual === null ? "—" : String(manual)}
          sub={manual === null ? "no data yet" : `per incident, ${metrics?.baseline_source === "measured_shadow" ? "measured in shadow mode" : "baseline"}`} />
      </div>

      {/* left: agreement per step; right: how many comparisons are in each state (click one to filter the list) */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <section className="card px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold">Agreement by step</h2>
          {!summary ? <Loading /> : summary.steps.length === 0 ? (
            <p className="text-[13px] text-ink-soft">No shadow runs yet. Set the run mode to Shadow on the <Link to="/policies" className="underline">Autonomy policy</Link>, then raise a fault and handle it by hand in the connected systems.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {summary.steps.map((s) => (
                <div key={s.step} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[120px_minmax(0,1fr)_44px_118px]">
                  <span className="text-[13px] font-medium">{sentence(s.step)}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-[#EEF1F0] max-sm:order-last max-sm:col-span-2">
                    <span className={`block h-full rounded-full ${s.ready_to_go_live ? "bg-route" : "bg-signal"}`} style={{ width: `${s.agreement_pct ?? 0}%` }} />
                  </span>
                  <span className="text-right text-[13px] font-semibold tnum">{s.agreement_pct === null ? "—" : `${s.agreement_pct}%`}</span>
                  <span className={`pill justify-self-start text-[11px] max-sm:hidden ${s.ready_to_go_live ? "bg-go-tint text-go" : "bg-signal-tint text-signal-ink"}`}>{s.ready_to_go_live ? "Ready to go live" : "Keep watching"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="grid grid-cols-2 gap-3.5">
          {(["open", "matched", "differed", "no_action"] as const).map((k) => {
            const n = (all || []).filter((r) => r.status === k).length;
            const on = status === k;
            return (
              <button key={k} type="button" onClick={() => setStatus(on ? "" : k)} aria-pressed={on}
                className={`card flex flex-col justify-center px-5 py-4 text-left transition-colors hover:border-ink-faint ${on ? "ring-2 ring-route" : ""}`}>
                <span className={`pill self-start text-[11px] ${VERDICT[k].cls}`}>{VERDICT[k].label}</span>
                <span className="mt-2 text-[28px] font-semibold leading-none tnum">{all ? n : "—"}</span>
                <span className="mt-1 text-xs text-ink-faint">comparison{n === 1 ? "" : "s"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="card flex flex-col overflow-hidden md:min-h-0 md:flex-1">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-5 py-4">
          <h2 className="flex-1 text-sm font-semibold">Comparisons</h2>
          {FILTERS.map(([v, l]) => (
            <button key={l} onClick={() => setStatus(v)} className={`h-[30px] rounded-[10px] px-3 text-xs ${status === v ? "bg-ink text-white" : "border border-rule bg-white text-ink-soft"}`}>{l}</button>
          ))}
        </div>
        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {error && <div className="p-4"><ErrorNote message={error} /></div>}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="Nothing here yet">Shadow recommendations appear here as the agent runs in shadow mode.</Empty> : data.map((r) => {
          const isOpen = open === r.id;
          const v = VERDICT[r.status] ?? VERDICT.open;
          return (
            <div key={r.id} className="border-b border-rule-soft last:border-b-0">
              <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-left md:grid-cols-[80px_minmax(0,1fr)_170px_90px_150px_20px] md:gap-3.5">
                <span><VehicleId label={r.vehicle_label} /></span>
                <span className="min-w-0 truncate font-medium">{r.workflow_title?.replace(`${r.vehicle_label}: `, "") ?? sentence(r.step)}</span>
                <span className="text-[12.5px] text-ink-soft">{sentence(r.step)}</span>
                <span className="font-semibold tnum">{r.agreement_pct === null ? "—" : `${r.agreement_pct}%`}</span>
                <span className={`pill justify-self-start ${v.cls}`}>{v.label}</span>
                <span className="text-ink-faint">{isOpen ? "▴" : "▾"}</span>
              </button>
              {isOpen && (
                <div className="space-y-3 px-5 pb-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-reason-line bg-reason p-3.5">
                      <div className="eyebrow text-route-dark">Agent would have</div>
                      <div className="mt-2 text-[13px]">{describe(r)}</div>
                      {r.comparison.map((c, i) => <div key={i} className="mt-2 text-[13px]">{r.comparison.length > 1 && <b className="font-medium">{c.item}: </b>}{c.agent}</div>)}
                      <div className="mt-2 text-xs text-ink-faint">Ready {dayTime(r.recommended_at)} · <SeverityTag severity={r.severity ?? null} /></div>
                    </div>
                    <div className="rounded-xl border border-rule bg-[#F6F8F7] p-3.5">
                      <div className="eyebrow text-ink-soft">People did</div>
                      {r.comparison.length > 0 ? r.comparison.map((c, i) => (
                        <div key={i} className="mt-2 text-[13px]">{r.comparison.length > 1 && <b className="font-medium">{c.item}: </b>}{c.person}
                          {c.score !== null && <span className={`ml-1.5 font-semibold tnum ${c.score >= 75 ? "text-go" : "text-signal-ink"}`}>{c.score}%</span>}</div>
                      )) : r.human_actions.length > 0 ? r.human_actions.map((h, i) => <div key={i} className="mt-2 text-[13px]">{h.detail}{h.by ? ` (${h.by})` : ""}</div>)
                        : <div className="mt-2 text-[13px] text-ink-soft">{r.status === "open" ? `Nothing yet · ${timeLeft(r.no_action_at)}` : r.review_note ?? "Nobody did this step within a day"}</div>}
                      {r.first_human_at && <div className="mt-2 text-xs text-ink-faint">First action {dayTime(r.first_human_at)}{r.agent_ahead_minutes !== null ? ` · agent ready ${r.agent_ahead_minutes} min earlier` : ""}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Link to={`/workflows/${r.workflow_id}`} className="font-medium">Open the orchestration →</Link>
                    <span className="flex-1" />
                    {r.status === "open" && canReview && (<>
                      {BY_HAND.includes(r.step) && <button className="btn-lg h-9 bg-route px-3.5 text-[13px] text-white" onClick={() => setActing(acting === r.id ? null : r.id)}>{acting === r.id ? "Close form" : "Do it by hand"}</button>}
                      <button className="btn-lg h-9 border border-rule bg-white px-3.5 text-[13px]" onClick={() => noAction(r.id)}>No action needed</button>
                    </>)}
                    {r.status !== "open" && (r.verdict
                      ? <span className={`pill ${r.verdict === "human_better" ? "bg-signal-tint text-signal-ink" : "bg-go-tint text-go"}`}>Reviewed: {r.verdict === "agent_better" ? "agent better" : r.verdict === "human_better" ? "person better" : "same"}</span>
                      : canReview && (<>
                        <span className="text-ink-soft">Which was better?</span>
                        {[["agent_better", "Agent"], ["same", "Same"], ["human_better", "Person"]].map(([vv, l]) => (
                          <button key={vv} className="btn-lg h-9 border border-rule bg-white px-3.5 text-[13px]" onClick={() => review(r.id, vv)}>{l}</button>
                        ))}
                      </>))}
                  </div>
                  {acting === r.id && <div className="rounded-xl border border-rule"><ByHandForm r={r} onDone={() => { setActing(null); reload(); }} /></div>}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </section>
    </>
  );
}
