import { useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility, AlertTriangle, ArrowUpRight, Check, Clock, Info, MessageSquareText, Pencil, Sparkles, UserCheck, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { dayTime, modeName, roleName, sentence, time, toLocalInput, ago } from "../lib/format";
import type { Approval, Assignment, Step } from "../lib/types";
import AgentFlow from "./AgentFlow";
import { Json, KeyVal, SeverityTag, StatusBadge, Tag, VehicleId } from "./ui";
import { useToast } from "./Toast";

const verb: Record<string, string> = { approve: "Approved", reject: "Rejected", override: "Changed and approved", acknowledge: "Acknowledged" };

/** `inWorkflow`: shown on the orchestration's own page, so the vehicle badge and the link back to it are left out.
 *  `fill`: on desktop the card grows to its container's height, with the decision bar pinned to the bottom. */
export default function DecisionCard({ item, steps, onDone, inWorkflow = false, fill = false }: {
  item: Approval; steps?: Step[]; onDone?: () => void; inWorkflow?: boolean; fill?: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<Record<string, any>>(() => initialOverride(item));
  const pending = item.status === "pending";
  // runs the agent could not cover: the table says it all, full width
  const gapRuns: any[] | null = item.kind === "escalation" && item.recommendation?.uncovered_runs?.length ? item.recommendation.uncovered_runs : null;

  async function send(action: string) {
    setBusy(true);
    try {
      await api.post(`/api/approvals/${item.id}/decision`, {
        action, note: note || undefined, override: action === "override" ? override : undefined,
      });
      toast(`${verb[action]}: ${item.title}`);
      onDone?.();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const escalation = item.kind === "escalation";
  const stepIndex = steps ? steps.findIndex((x) => x.key === item.step) : -1;
  const stepLabel = steps?.[stepIndex]?.label ?? sentence(item.step);
  const tone = !pending ? "border-rule" : escalation ? "border-stop/40" : item.kind === "informational" ? "border-rule" : "border-signal/40";
  const iconTone = escalation ? "bg-stop-tint text-stop ring-stop/20" : item.kind === "informational" ? "bg-paper text-ink-soft ring-rule" : "bg-signal-tint text-[#8A5900] ring-signal/25";
  const KindIcon = escalation ? AlertTriangle : item.kind === "informational" ? Info : UserCheck;

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05),0_8px_24px_-12px_rgba(16,24,40,0.12)] ${tone} ${fill ? "lg:flex lg:flex-1 lg:flex-col" : ""}`}>
      {/* header */}
      <header className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${iconTone}`}><KindIcon className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-2xs font-semibold uppercase tracking-wider">
            <span className={escalation ? "text-stop" : item.kind === "informational" ? "text-ink-faint" : "text-[#8A5900]"}>
              {escalation ? "Manual action needed" : item.kind === "informational" ? "For your information" : "Approval needed"}
            </span>
            {stepIndex >= 0 && <span className="text-ink-faint">· Step {stepIndex + 1} of {steps!.length} · {stepLabel}</span>}
            <span className="flex items-center gap-x-3 font-normal normal-case tracking-normal text-ink-soft">
              <span className="text-ink-faint">·</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-ink-faint" aria-hidden />{ago(item.requested_at)}</span>
              {item.kind === "approval" && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3 text-ink-faint" aria-hidden />{item.approver_roles.map((r) => roleName[r] ?? r).join(" or ")}</span>}
            </span>
          </div>
          <h3 className="mt-0.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold leading-snug">
            {!inWorkflow && <VehicleId label={item.vehicle_label} />}
            <span>{item.title}</span>
            <SeverityTag severity={item.severity} />
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!pending && <StatusBadge status={item.status} />}
          {!inWorkflow && (
            <Link to={`/workflows/${item.workflow_id}`} className="btn-quiet px-2.5 py-1 text-xs" aria-label="Open orchestration"><span className="hidden sm:inline">Open orchestration</span> <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
          )}
        </div>
      </header>

      {/* where this sits in the seven steps */}
      {steps && pending && (
        <div className="border-y border-rule bg-gradient-to-b from-paper/80 to-paper/30 px-5 pb-2.5 pt-3">
          <AgentFlow steps={steps} medium />
        </div>
      )}

      {/* what the agent proposes, and why */}
      {pending && (gapRuns ? <div className={`px-5 py-3 ${fill ? "lg:flex-1" : ""}`}><UncoveredRuns runs={gapRuns} /></div> : (
        <div className={`grid gap-4 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(250px,30%)] ${fill ? "lg:flex-1 lg:content-stretch" : ""}`}>
          <div className="min-w-0">
            <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{item.kind === "approval" ? "Proposed action" : "Summary"}</h4>
            {item.kind === "approval" ? <StepBody item={item} editing={editing && pending} override={override} setOverride={setOverride} />
              : <p className="text-sm leading-relaxed">{item.summary}</p>}
          </div>
          <aside className="rounded-xl border border-route/15 bg-route-tint/40 px-3.5 py-3 text-[13px]">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-route-dark">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {escalation ? "What happened" : "Agent reasoning"}
            </h4>
            <p className="leading-relaxed text-ink">{item.explanation || item.summary}</p>
            {item.kind === "approval" && item.summary && item.summary !== item.explanation && (
              <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-route">Full assessment</summary>
                <p className="mt-1.5 leading-relaxed text-ink-soft">{item.summary}</p></details>
            )}
            {Object.keys(item.data_considered || {}).length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium text-route">Data considered</summary>
                <div className="mt-2"><Json value={item.data_considered} /></div>
              </details>
            )}
          </aside>
        </div>
      ))}

      {/* decide */}
      {pending && item.can_decide && (
        <footer className="flex flex-wrap items-center gap-3 border-t border-rule bg-paper/50 px-5 py-2.5">
          <label className="relative min-w-[220px] max-w-md flex-1">
            <MessageSquareText className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input className="input pl-8" placeholder="Add a note for the audit log (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            {item.kind === "approval" ? (
              <>
                <button className="btn-danger" disabled={busy} onClick={() => send("reject")}><X className="h-4 w-4" aria-hidden /> Reject</button>
                {["open_work_order", "pull_vehicle", "reassign_runs", "adjust_schedule"].includes(item.step) && (item.step !== "adjust_schedule" || (item.options?.modes || []).length > 1) && (
                  editing ? (
                    <>
                      <button className="btn-quiet" disabled={busy} onClick={() => { setEditing(false); setOverride(initialOverride(item)); }}>Cancel changes</button>
                      <button className="btn-primary" disabled={busy} onClick={() => send("override")}><Check className="h-4 w-4" aria-hidden /> Approve with changes</button>
                    </>
                  ) : (
                    <button className="btn-quiet" disabled={busy} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden /> Change</button>
                  )
                )}
                {!editing && <button className="btn-primary px-4" disabled={busy} onClick={() => send("approve")}><Check className="h-4 w-4" aria-hidden /> Approve</button>}
              </>
            ) : (
              <button className="btn-primary px-4" disabled={busy} onClick={() => send("acknowledge")}><Check className="h-4 w-4" aria-hidden /> Acknowledge</button>
            )}
          </div>
        </footer>
      )}
      {pending && !item.can_decide && (
        <footer className="border-t border-rule bg-paper/50 px-6 py-3.5 text-xs text-ink-soft">
          Only {item.approver_roles.map((r) => roleName[r] ?? r).join(" or ")} can decide this step. Sign in with that role to act on it.
        </footer>
      )}
      {!pending && item.decided_at && (
        <footer className={`border-t border-rule px-6 py-3 text-xs text-ink-soft ${fill ? "lg:mt-auto" : ""}`}>
          {sentence(item.status)} by <span className="font-medium text-ink">{item.decided_by_name}</span> on {dayTime(item.decided_at)}{item.decision_note ? `: “${item.decision_note}”` : ""}
        </footer>
      )}
    </article>
  );
}

export function initialOverride(item: Approval): Record<string, any> {
  const r = item.recommendation || {};
  if (item.step === "open_work_order") return { priority: r.priority, shop_start: toLocalInput(r.shop_start), shop_end: toLocalInput(r.shop_end) };
  if (item.step === "pull_vehicle") return { from: toLocalInput(r.from), until: toLocalInput(r.until) };
  if (item.step === "adjust_schedule") return { mode: r.mode, request_id: r.candidate?.request_id };
  if (item.step === "reassign_runs")
    return { assignments: (r.assignments || []).map((a: Assignment) => ({ run_id: a.run_id, vehicle_id: a.vehicle_id, driver_id: a.driver_id })) };
  return {};
}

export function StepBody({ item, editing, override, setOverride }: {
  item: Approval; editing: boolean; override: Record<string, any>; setOverride: (o: Record<string, any>) => void;
}) {
  const r = item.recommendation || {};
  if (item.step === "open_work_order") {
    if (editing) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="label">Priority</span>
            <select className="input" value={override.priority} onChange={(e) => setOverride({ ...override, priority: e.target.value })}>
              {["critical", "high", "medium", "low"].map((p) => <option key={p} value={p}>{sentence(p)}</option>)}
            </select>
          </label>
          <label><span className="label">Shop start</span>
            <input type="datetime-local" className="input" value={override.shop_start} onChange={(e) => setOverride({ ...override, shop_start: e.target.value })} />
          </label>
          <label><span className="label">Shop end</span>
            <input type="datetime-local" className="input" value={override.shop_end} onChange={(e) => setOverride({ ...override, shop_end: e.target.value })} />
          </label>
          <p className="text-xs text-ink-soft sm:col-span-3">Changing the shop window also changes when the vehicle is out of service, so the agent recalculates which runs need cover.</p>
        </div>
      );
    }
    return (
      <KeyVal dense items={[
        ["Work order", <span>{r.title} <span className="text-ink-soft">({r.fault_code})</span></span>],
        ["Priority", <SeverityTag severity={r.priority} />],
        ["Shop window", `${dayTime(r.shop_start)} to ${dayTime(r.shop_end)}`],
        ["Depot", r.depot],
        ["Timing", r.timing],
      ]} />
    );
  }
  if (item.step === "pull_vehicle") {
    return (
      <div className="space-y-2">
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">Unavailable from</span>
              <input type="datetime-local" className="input" value={override.from} onChange={(e) => setOverride({ ...override, from: e.target.value })} /></label>
            <label><span className="label">Until</span>
              <input type="datetime-local" className="input" value={override.until} onChange={(e) => setOverride({ ...override, until: e.target.value })} /></label>
          </div>
        ) : (
          <KeyVal dense items={[["Unavailable", `${dayTime(r.from)} to ${dayTime(r.until)}`],
            ["Runs affected", `${(r.runs_affected || []).length}${r.later_runs ? `, plus ${r.later_runs} later run(s) for the planner` : ""}`]]} />
        )}
        {(r.runs_affected || []).length > 0 && (
          <ul className="divide-y divide-rule rounded-lg border border-rule text-xs">
            {r.runs_affected.map((x: any) => (
              <li key={x.run_id} className="flex justify-between gap-2 px-3 py-1.5">
                <span>{x.route_name} <span className="text-ink-soft">{x.block_name}</span></span>
                <span className="tnum text-ink-soft">{dayTime(x.start)}, {x.riders} riders</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (item.step === "reassign_runs") {
    const per = item.options?.per_run || {};
    const rows: Assignment[] = r.assignments || [];
    return (
      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="table text-xs [&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle [&_th]:px-3 [&_th]:py-2">
          <thead><tr><th>Run</th><th>Starts</th><th>Riders</th><th>Spare vehicle</th><th>Driver</th><th className="text-right">Delay</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const o = (override.assignments || []).find((x: any) => x.run_id === a.run_id) || {};
              const opts = per[a.run_id] || { vehicles: [], drivers: [] };
              return (
                <tr key={a.run_id}>
                  <td><span className="font-medium">{a.route_name}</span> <span className="text-2xs text-ink-soft">{a.block_name}</span></td>
                  <td className="tnum whitespace-nowrap">{a.start_h}</td>
                  <td className="tnum">{a.riders}{a.needs_wheelchair && <Accessibility className="ml-1 inline h-3.5 w-3.5 text-route" aria-label="wheelchair rider" />}</td>
                  <td>
                    {editing ? (
                      <select className="input min-w-[13rem]" value={o.vehicle_id ?? ""} aria-label={`Vehicle for ${a.route_name} ${a.block_name}`}
                        onChange={(e) => setOverride({ assignments: override.assignments.map((x: any) => x.run_id === a.run_id ? { ...x, vehicle_id: e.target.value || null } : x) })}>
                        {opts.vehicles.map((v: any) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.label}, {v.vehicle_type} ({v.depot})</option>)}
                        <option value="">Leave for the dispatcher</option>
                      </select>
                    ) : a.vehicle_label ? (
                      <span className="inline-flex items-center gap-1.5" title={a.reason}><VehicleId label={a.vehicle_label} /><span className="max-w-[9.5rem] truncate text-2xs text-ink-soft">{a.reason.replace(/^[^(]*\(|\)$/g, "")}</span></span>
                    ) : <Tag color="red">No spare found</Tag>}
                  </td>
                  <td>
                    {editing ? (
                      <select className="input min-w-36" value={o.driver_id ?? ""} aria-label={`Driver for ${a.route_name} ${a.block_name}`} disabled={!o.vehicle_id}
                        onChange={(e) => setOverride({ assignments: override.assignments.map((x: any) => x.run_id === a.run_id ? { ...x, driver_id: e.target.value } : x) })}>
                        {opts.drivers.map((d: any) => <option key={d.driver_id} value={d.driver_id}>{d.name}</option>)}
                      </select>
                    ) : (
                      <span>{a.driver_name ?? "—"}{a.keep_driver && <span className="ml-1 text-2xs text-ink-faint">· scheduled</span>}</span>
                    )}
                  </td>
                  <td className="text-right tnum">{a.delay_minutes ? `+${a.delay_minutes} min` : "None"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  if (item.step === "adjust_schedule") return <AdjustBody item={item} editing={editing} override={override} setOverride={setOverride} />;
  return <Json value={r} />;
}

function AdjustBody({ item, editing, override, setOverride }: {
  item: Approval; editing: boolean; override: Record<string, any>; setOverride: (o: Record<string, any>) => void;
}) {
  const r = item.recommendation || {};
  const modes: string[] = item.options?.modes || [];
  const cands: any[] = item.options?.candidates || [];
  const cand = r.candidate;
  const changes: any[] = (r.changes || []).filter((c: any) => c.change_min !== 0);
  return (
    <div className="space-y-3">
      <KeyVal items={[
        ["Missed pickup", <span>{r.missed?.rider_name} at {time(r.missed?.pickup_time)}, {r.missed?.pickup_stop}</span>],
        ["Run", <span>{r.run?.route_name} {r.run?.block_name} on <VehicleId label={r.run?.vehicle_label} /> with {r.run?.driver_name}{r.run?.delay_minutes ? `, running ${r.run.delay_minutes} min late` : ", on time"}</span>],
        ["Time freed", `${r.minutes_saved} min`],
        ["Recommendation", <span className="font-medium">{modeName[r.mode]}</span>],
      ]} />
      {editing ? (
        <fieldset className="space-y-2 rounded-sm border border-rule p-3">
          <legend className="px-1 text-xs font-semibold text-ink-soft">Choose what to do instead</legend>
          {modes.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`mode-${item.id}`} className="accent-route" checked={override.mode === m} onChange={() => setOverride({ ...override, mode: m })} />
              {modeName[m]}
            </label>
          ))}
          {override.mode === "insert" && cands.length > 0 && (
            <select className="input mt-1" value={override.request_id ?? ""} onChange={(e) => setOverride({ ...override, request_id: e.target.value })} aria-label="Standby rider">
              {cands.map((c) => <option key={c.request_id} value={c.request_id}>{c.rider_name} ({c.purpose}), pickup about {time(c.proposed_pickup)}, {c.net_change_min >= 0 ? "+" : ""}{c.net_change_min} min to later pickups</option>)}
            </select>
          )}
        </fieldset>
      ) : cand && r.mode === "insert" ? (
        <div className="rounded-sm border border-route/30 bg-route-tint/50 p-3 text-sm">
          <div className="font-medium">{cand.rider_name} <Tag color={cand.purpose === "medical" ? "amber" : "grey"}>{sentence(cand.purpose)}</Tag>{cand.needs_wheelchair && <Tag color="teal">Wheelchair</Tag>}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Pickup about {time(cand.proposed_pickup)} from {cand.pickup_stop} to {cand.dropoff_stop}; asked for {time(cand.window_start)} to {time(cand.window_end)}; about {cand.detour_min} min of extra driving.</div>
        </div>
      ) : null}
      {changes.length > 0 && !editing && (
        <div className="overflow-x-auto rounded-sm border border-rule">
          <table className="table">
            <thead><tr><th>Later pickup</th><th>Scheduled</th><th>Expected now</th><th>After change</th></tr></thead>
            <tbody>{changes.slice(0, 6).map((c) => (
              <tr key={c.trip_id}><td>{c.rider_name}<div className="text-2xs text-ink-soft">{c.pickup_stop}</div></td>
                <td className="tnum">{time(c.pickup_time)}</td>
                <td className="tnum">{time(c.eta_before)}{c.late_before && <Tag color="red">Late</Tag>}</td>
                <td className="tnum font-semibold">{time(c.eta_after)} <span className="text-2xs font-normal text-ink-soft">({c.change_min > 0 ? "+" : ""}{c.change_min} min)</span>{c.late_after && <Tag color="red">Late</Tag>}</td></tr>
            ))}</tbody>
          </table>
          {changes.length > 6 && <p className="px-3 py-1.5 text-2xs text-ink-soft">and {changes.length - 6} more</p>}
        </div>
      )}
      {r.flag_rider && <p className="text-xs text-[#8A5900]">{r.missed?.rider_name} has {r.rider_no_shows_30d} no-shows in the last 30 days and will be flagged for no-show policy review.</p>}
    </div>
  );
}

/** Runs the agent could not cover, raised with the dispatcher instead of being skipped. */
export function UncoveredRuns({ runs }: { runs: any[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium leading-relaxed text-stop">No qualified spare vehicle and driver for {runs.length} run(s), {runs.reduce((n, r) => n + r.riders, 0)} booked riders. Please arrange cover by hand: call in an off-duty driver, borrow a vehicle from the other depot, or rebook the riders.</p>
      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="table text-xs [&_td]:py-2 [&_th]:py-2">
          <thead><tr><th>Run</th><th>Starts</th><th>Riders</th><th>Why it could not be covered</th></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.run_id}>
              <td><span className="font-medium">{r.route_name}</span> <span className="text-2xs text-ink-soft">{r.block_name}</span></td>
              <td className="tnum whitespace-nowrap">{r.start_h}</td>
              <td className="tnum">{r.riders}{r.needs_wheelchair && <Accessibility className="ml-1 inline h-3.5 w-3.5 text-route" aria-label="wheelchair rider" />}</td>
              <td className="text-xs">{sentence(r.reason)}{r.spares_checked ? <span className="text-ink-faint"> · {r.spares_checked} spare(s) checked</span> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
