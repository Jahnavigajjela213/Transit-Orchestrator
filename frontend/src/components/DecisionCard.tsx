import { useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility, Check, Pencil, X } from "lucide-react";
import { api } from "../lib/api";
import { dayTime, modeName, roleName, sentence, time, toLocalInput, ago } from "../lib/format";
import type { Approval, Assignment, Step } from "../lib/types";
import LineMap from "./LineMap";
import { Json, KeyVal, SeverityTag, StatusBadge, Tag, VehicleId } from "./ui";
import { useToast } from "./Toast";

const verb: Record<string, string> = { approve: "Approved", reject: "Rejected", override: "Changed and approved", acknowledge: "Acknowledged" };

export default function DecisionCard({ item, steps, onDone }: { item: Approval; steps?: Step[]; onDone?: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<Record<string, any>>(() => initialOverride(item));
  const pending = item.status === "pending";

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

  const accent = item.kind === "escalation" ? "border-l-stop" : item.kind === "informational" ? "border-l-ink-faint" : "border-l-signal";

  return (
    <article className={`panel border-l-4 ${pending ? accent : "border-l-rule"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-start gap-3">
          <VehicleId label={item.vehicle_label} size="lg" />
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug">{item.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
              <SeverityTag severity={item.severity} />
              {item.kind !== "approval" && <Tag color={item.kind === "escalation" ? "red" : "grey"}>{item.kind === "escalation" ? "Manual action needed" : "For your information"}</Tag>}
              <span>Requested {ago(item.requested_at)}</span>
              {item.kind === "approval" && <span>for {item.approver_roles.map((r) => roleName[r] ?? r).join(" or ")}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!pending && <StatusBadge status={item.status} />}
          <Link to={`/workflows/${item.workflow_id}`} className="text-xs font-medium text-route hover:underline">Open orchestration</Link>
        </div>
      </div>

      {steps && <div className="px-4 pt-4"><LineMap steps={steps} compact /></div>}

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_minmax(260px,38%)]">
        <div className="min-w-0">
          {item.kind === "approval" ? <StepBody item={item} editing={editing && pending} override={override} setOverride={setOverride} /> : (
            <p className="text-sm leading-relaxed">{item.summary}</p>
          )}
        </div>
        <aside className="rounded-sm bg-paper/70 p-3 text-sm">
          <h4 className="mb-1 font-sign text-xs font-bold text-ink-soft">Why the agent proposes this</h4>
          <p className="leading-relaxed">{item.explanation || item.summary}</p>
          {item.kind === "approval" && item.summary && item.summary !== item.explanation && (
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">{item.summary}</p>
          )}
          {Object.keys(item.data_considered || {}).length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-route">Data considered</summary>
              <div className="mt-2"><Json value={item.data_considered} /></div>
            </details>
          )}
        </aside>
      </div>

      {pending && item.can_decide && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
          <input className="input max-w-sm flex-1" placeholder="Note for the audit log (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
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
                {!editing && <button className="btn-primary" disabled={busy} onClick={() => send("approve")}><Check className="h-4 w-4" aria-hidden /> Approve</button>}
              </>
            ) : (
              <button className="btn-primary" disabled={busy} onClick={() => send("acknowledge")}><Check className="h-4 w-4" aria-hidden /> Acknowledge</button>
            )}
          </div>
        </footer>
      )}
      {pending && !item.can_decide && (
        <footer className="border-t border-rule px-4 py-3 text-xs text-ink-soft">
          Only {item.approver_roles.map((r) => roleName[r] ?? r).join(" or ")} can decide this step. Sign in with that role to act on it.
        </footer>
      )}
      {!pending && item.decided_at && (
        <footer className="border-t border-rule px-4 py-3 text-xs text-ink-soft">
          {sentence(item.status)} by {item.decided_by_name} on {dayTime(item.decided_at)}{item.decision_note ? `: “${item.decision_note}”` : ""}
        </footer>
      )}
    </article>
  );
}

function initialOverride(item: Approval): Record<string, any> {
  const r = item.recommendation || {};
  if (item.step === "open_work_order") return { priority: r.priority, shop_start: toLocalInput(r.shop_start), shop_end: toLocalInput(r.shop_end) };
  if (item.step === "pull_vehicle") return { from: toLocalInput(r.from), until: toLocalInput(r.until) };
  if (item.step === "adjust_schedule") return { mode: r.mode, request_id: r.candidate?.request_id };
  if (item.step === "reassign_runs")
    return { assignments: (r.assignments || []).map((a: Assignment) => ({ run_id: a.run_id, vehicle_id: a.vehicle_id, driver_id: a.driver_id })) };
  return {};
}

function StepBody({ item, editing, override, setOverride }: {
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
      <KeyVal items={[
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
      <div className="space-y-3">
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">Unavailable from</span>
              <input type="datetime-local" className="input" value={override.from} onChange={(e) => setOverride({ ...override, from: e.target.value })} /></label>
            <label><span className="label">Until</span>
              <input type="datetime-local" className="input" value={override.until} onChange={(e) => setOverride({ ...override, until: e.target.value })} /></label>
          </div>
        ) : (
          <KeyVal items={[["Unavailable", `${dayTime(r.from)} to ${dayTime(r.until)}`],
            ["Runs affected", `${(r.runs_affected || []).length}${r.later_runs ? `, plus ${r.later_runs} later run(s) for the planner` : ""}`]]} />
        )}
        {(r.runs_affected || []).length > 0 && (
          <ul className="divide-y divide-rule rounded-sm border border-rule text-sm">
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
      <div className="overflow-x-auto rounded-sm border border-rule">
        <table className="table">
          <thead><tr><th>Run</th><th>Starts</th><th>Riders</th><th>Spare vehicle</th><th>Driver</th><th>Delay</th></tr></thead>
          <tbody>
            {rows.map((a) => {
              const o = (override.assignments || []).find((x: any) => x.run_id === a.run_id) || {};
              const opts = per[a.run_id] || { vehicles: [], drivers: [] };
              return (
                <tr key={a.run_id}>
                  <td><div className="font-medium">{a.route_name}</div><div className="text-2xs text-ink-soft">{a.block_name}</div></td>
                  <td className="tnum whitespace-nowrap">{a.start_h}</td>
                  <td className="tnum">{a.riders}{a.needs_wheelchair && <Accessibility className="ml-1 inline h-3.5 w-3.5 text-route" aria-label="wheelchair rider" />}</td>
                  <td>
                    {editing ? (
                      <select className="input min-w-[13rem]" value={o.vehicle_id ?? ""} aria-label={`Vehicle for ${a.run_id}`}
                        onChange={(e) => setOverride({ assignments: override.assignments.map((x: any) => x.run_id === a.run_id ? { ...x, vehicle_id: e.target.value || null } : x) })}>
                        {opts.vehicles.map((v: any) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.label}, {v.vehicle_type} ({v.depot})</option>)}
                        <option value="">Leave for the dispatcher</option>
                      </select>
                    ) : a.vehicle_label ? (
                      <div><VehicleId label={a.vehicle_label} /><div className="mt-0.5 text-2xs text-ink-soft">{a.reason}</div></div>
                    ) : <Tag color="red">No spare found</Tag>}
                  </td>
                  <td>
                    {editing ? (
                      <select className="input min-w-36" value={o.driver_id ?? ""} aria-label={`Driver for ${a.run_id}`} disabled={!o.vehicle_id}
                        onChange={(e) => setOverride({ assignments: override.assignments.map((x: any) => x.run_id === a.run_id ? { ...x, driver_id: e.target.value } : x) })}>
                        {opts.drivers.map((d: any) => <option key={d.driver_id} value={d.driver_id}>{d.name}</option>)}
                      </select>
                    ) : (
                      <div>{a.driver_name ?? "—"}{a.keep_driver && <div className="text-2xs text-ink-soft">Scheduled driver</div>}</div>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap">{a.delay_minutes ? `+${a.delay_minutes} min` : "None"}</td>
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
