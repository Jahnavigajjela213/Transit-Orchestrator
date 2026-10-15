import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/live";
import { ErrorNote, Loading, PageHeader } from "../components/ui";

/** The pilot's success measures from the proposal: value for the period, 8-week trend, Phase 0 baseline and target. */

interface Values {
  detect_to_work_order_minutes: number | null; detect_to_work_order_samples: number; manual_reentries_per_incident: number | null;
  runs_covered_pct: number | null; runs_at_risk: number; runs_covered: number; audit_complete_pct: number | null;
  acceptance_pct: number | null; decisions: number; auto_returned_pct: number | null; incidents: number;
}
interface StepRow {
  step: string; approved: number; overridden: number; rejected: number; decisions: number; acceptance_pct: number | null;
  weekly: { week: string; decisions: number; acceptance_pct: number | null }[]; ready: boolean; rule: string | null; level: string | null;
}
interface Pilot {
  days: number | null; measures: Values; weeks: ({ week: string } & Values)[]; steps: StepRow[];
  baseline: Record<string, number | null>; baseline_source: string; baseline_notes: string | null; baseline_sample: number | null;
}

const PERIODS: [number | null, string][] = [[7, "7 days"], [28, "28 days"], [null, "Pilot to date"]];
const STEP_LABEL: Record<string, string> = { open_work_order: "Open work order", pull_vehicle: "Pull vehicle", reassign_runs: "Reassign runs" };
const SOURCE: Record<string, string> = { none: "No “before” numbers yet", entered: "“Before” from the Phase 0 study", measured_shadow: "“Before” measured in shadow mode", shadow_live: "“Before” measured live in shadow mode" };

type Status = "ok" | "close" | "none";
type Kind = "min" | "count" | "pct";
interface Card {
  label: string; question: string; key: keyof Values; value: string; unit: string; baseline: string; target: string; status: Status;
  now: number | null; before: number | null; kind: Kind; lower: boolean;
}

const fmtMin = (m: number | null | undefined) => (m == null ? "not measured" : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${m} min`);
const pct = (v: number | null | undefined) => (v == null ? "not measured" : `${v}%`);

function cards(m: Values, b: Record<string, number | null>): Card[] {
  const st = (v: number | null, ok: boolean): Status => (v == null ? "none" : ok ? "ok" : "close");
  const v = m;
  return [
    { label: "Fault detection to open work order", question: "When a bus reports a fault, how long until a repair job exists in FASTER?",
      key: "detect_to_work_order_minutes", value: v.detect_to_work_order_minutes == null ? "—" : String(v.detect_to_work_order_minutes),
      unit: v.detect_to_work_order_minutes == null ? "no data yet" : `min median · ${v.detect_to_work_order_samples} work order${v.detect_to_work_order_samples === 1 ? "" : "s"}, incl. approval wait`,
      baseline: fmtMin(b.detect_to_work_order_minutes), target: "Under 5 min", status: st(v.detect_to_work_order_minutes, (v.detect_to_work_order_minutes ?? 99) < 5),
      now: v.detect_to_work_order_minutes, before: b.detect_to_work_order_minutes, kind: "min", lower: true },
    { label: "Manual re-entry across products", question: "How often did someone retype the same thing into another system by hand?",
      key: "manual_reentries_per_incident", value: v.manual_reentries_per_incident == null ? "—" : String(v.manual_reentries_per_incident),
      unit: v.manual_reentries_per_incident == null ? "no data yet" : "per incident",
      baseline: b.manual_reentries_per_incident == null ? "not measured" : `${b.manual_reentries_per_incident} per incident`, target: "None",
      status: st(v.manual_reentries_per_incident, v.manual_reentries_per_incident === 0), now: v.manual_reentries_per_incident, before: b.manual_reentries_per_incident, kind: "count", lower: true },
    { label: "Affected runs covered before pull-out", question: "When a bus comes off the road, how many of its trips got a spare bus and driver?",
      key: "runs_covered_pct", value: v.runs_covered_pct == null ? "—" : `${v.runs_covered_pct}%`,
      unit: v.runs_covered_pct == null ? "no data yet" : `${v.runs_covered} of ${v.runs_at_risk} runs`, baseline: pct(b.runs_covered_pct),
      // Better than before; when before was already 100%, staying at 100% is the target.
      target: b.runs_covered_pct == null ? "Better than before" : b.runs_covered_pct >= 100 ? "Stay at 100%" : `Above ${b.runs_covered_pct}%`,
      status: st(v.runs_covered_pct, b.runs_covered_pct == null ? (v.runs_covered_pct ?? 0) >= 90
        : b.runs_covered_pct >= 100 ? v.runs_covered_pct === 100 : (v.runs_covered_pct ?? 0) > b.runs_covered_pct), now: v.runs_covered_pct, before: b.runs_covered_pct, kind: "pct", lower: false },
    { label: "Decisions with a complete audit record", question: "Can every decision be explained afterwards: who, why, and from which data?",
      key: "audit_complete_pct", value: v.audit_complete_pct == null ? "—" : `${v.audit_complete_pct}%`,
      unit: v.audit_complete_pct == null ? "no data yet" : "of orchestrations", baseline: pct(b.audit_complete_pct), target: "100%",
      status: st(v.audit_complete_pct, v.audit_complete_pct === 100), now: v.audit_complete_pct, before: b.audit_complete_pct, kind: "pct", lower: false },
    { label: "Dispatcher acceptance of recommendations", question: "How often did the dispatcher approve the agent’s suggestion without changing it?",
      key: "acceptance_pct", value: v.acceptance_pct == null ? "—" : `${v.acceptance_pct}%`,
      unit: v.acceptance_pct == null ? "no decisions yet" : `approved unchanged · ${v.decisions} decision${v.decisions === 1 ? "" : "s"}`,
      baseline: "— (new with the agent)", target: "Tracked weekly", status: st(v.acceptance_pct, (v.acceptance_pct ?? 0) >= 90), now: v.acceptance_pct, before: null, kind: "pct", lower: false },
    { label: "Vehicle returned to schedule after close", question: "Once the shop finishes, does the bus go back on the schedule by itself?",
      key: "auto_returned_pct", value: v.auto_returned_pct == null ? "—" : `${v.auto_returned_pct}%`,
      unit: v.auto_returned_pct == null ? "no data yet" : "returned automatically",
      baseline: b.manual_steps_to_return == null ? "done by hand" : `${b.manual_steps_to_return} manual step${b.manual_steps_to_return === 1 ? "" : "s"}`,
      target: "Automatic", status: st(v.auto_returned_pct, v.auto_returned_pct === 100), now: v.auto_returned_pct, before: null, kind: "pct", lower: false },
  ];
}

/** Where the dashed "target" line sits on each card's chart. */
function targetValue(key: keyof Values, b: Record<string, number | null>): number {
  return ({ detect_to_work_order_minutes: 5, manual_reentries_per_incident: 0, runs_covered_pct: b.runs_covered_pct ?? 90,
    audit_complete_pct: 100, acceptance_pct: 90, auto_returned_pct: 100 } as Record<string, number>)[key] ?? 0;
}

/** A small line chart: our application's weekly value (solid teal, dots) against the target (dashed amber). */
function LineChart({ actual, target, label, weeks }: { actual: (number | null)[]; target: number; label: string; weeks: string[] }) {
  const W = 140, H = 48, P = 5;
  const vals = actual.filter((x): x is number => x != null);
  const top = Math.max(target, ...vals, 1) * 1.15;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, actual.length - 1);
  const y = (v: number) => H - P - (v / top) * (H - 2 * P);
  // one path per run of consecutive weeks with data, so empty weeks are gaps
  const runs: string[] = [];
  let cur = "";
  actual.forEach((v, i) => {
    if (v == null) { if (cur) runs.push(cur); cur = ""; return; }
    cur += `${cur ? " L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) runs.push(cur);
  const desc = vals.length ? `${label}: last 8 weeks, latest ${vals[vals.length - 1]}, target ${target}` : `${label}: no data yet`;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={desc} className="overflow-visible">
        <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} stroke="#D98A00" strokeWidth="1.5" strokeDasharray="4 3" />
        {vals.length === 0 ? (
          <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="10" fill="#7D8891">No data yet</text>
        ) : (
          <>
            {runs.map((d, i) => <path key={i} d={d} fill="none" stroke="#0B6E69" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
            {actual.map((v, i) => v == null ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === actual.length - 1 ? 3 : 2} fill="#0B6E69"><title>{`Week of ${weeks[i]}: ${v}`}</title></circle>
            ))}
          </>
        )}
      </svg>
      <span className="flex items-center gap-2.5 text-[10px] text-ink-faint" aria-hidden>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-route" />Actual</span>
        <span className="flex items-center gap-1"><span className="h-0 w-3 border-t-[1.5px] border-dashed border-signal" />Target</span>
      </span>
    </div>
  );
}

const STATUS_UI: Record<Status, [string, string]> = {
  ok: ["On target", "bg-go-tint text-go"], close: ["Not yet", "bg-signal-tint text-signal-ink"],
  none: ["No data", "bg-[#EEF1F0] text-ink-soft"],
};

export default function Measures() {
  const [days, setDays] = useState<number | null>(28);
  const { data, error } = useData<Pilot>(`/api/metrics/pilot${days ? `?days=${days}` : ""}`, [days]);

  return (
    <>
      <PageHeader title="Pilot measures" eyebrow="Governance · Vehicle health pilot"
        intro="The scorecard for what the proposal promised: handling a broken-down bus faster, with less manual work, and fully explained. Each card compares the agent now with how the agency did it by hand before (“Before”) and with the goal set in the proposal (“Target”)."
        badge={data && <span className="pill bg-[#EEF1F0] text-ink-soft" title={data.baseline_notes ?? ""}>{SOURCE[data.baseline_source] ?? data.baseline_source}</span>}
        actions={
          <div role="tablist" aria-label="Period" className="flex rounded-[10px] border border-rule bg-white p-[3px]">
            {PERIODS.map(([d, label]) => (
              <button key={label} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)}
                className={`h-8 rounded-[7px] px-3.5 text-xs ${days === d ? "bg-ink font-semibold text-white" : "text-ink-soft hover:text-ink"}`}>{label}</button>
            ))}
          </div>
        } />
      {error && <ErrorNote message={error} />}
      {!data ? <div className="card"><Loading /></div> : (
        <>
          <section className="card overflow-x-auto">
            <div className="flex min-w-[720px] flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
              <div className="min-w-[260px] flex-1">
                <h2 className="text-sm font-semibold">Dispatcher acceptance by step · weekly</h2>
                <p className="mt-0.5 text-xs text-ink-soft">Steps with steady acceptance are the candidates to move to “Agent acts” in the autonomy policy.</p>
              </div>
              <Link to="/policies" className="text-[13px] font-medium">Open autonomy policy →</Link>
            </div>
            <div className="grid min-w-[720px] grid-cols-[180px_minmax(0,1fr)_90px_90px_90px_170px] gap-3.5 bg-panel px-5 py-2.5 text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              <span>Step</span><span>Last 8 weeks</span><span className="text-right">Approved</span><span className="text-right">Changed</span><span className="text-right">Rejected</span><span />
            </div>
            {data.steps.map((s) => {
              const latest = [...s.weekly].reverse().find((w) => w.acceptance_pct != null)?.acceptance_pct;
              const tag = s.level === "autonomous" ? ["Agent acts already", "bg-route-tint text-route-dark"] : s.ready ? ["Ready for Agent acts", "bg-go-tint text-go"] : ["Keep approving", "bg-signal-tint text-signal-ink"];
              return (
                <div key={s.step} className="grid min-w-[720px] grid-cols-[180px_minmax(0,1fr)_90px_90px_90px_170px] items-center gap-3.5 border-t border-rule-soft px-5 py-3.5">
                  <span className="font-semibold">{STEP_LABEL[s.step] ?? s.step}</span>
                  <span className="flex h-7 items-end gap-1">
                    {s.weekly.map((w) => (
                      <span key={w.week} title={`Week of ${w.week}: ${w.acceptance_pct == null ? "no decisions" : `${w.acceptance_pct}% of ${w.decisions}`}`}
                        className={`w-3.5 rounded-[3px] ${w.acceptance_pct == null ? "bg-[#EEF1F0]" : w.acceptance_pct >= 90 ? "bg-route" : "bg-signal"}`}
                        style={{ height: w.acceptance_pct == null ? "12%" : `${Math.max(12, w.acceptance_pct)}%` }} />
                    ))}
                    <span className="ml-2 text-xs font-semibold tnum">{latest == null ? "—" : `${latest}%`}</span>
                  </span>
                  <span className="text-right tnum">{s.approved}</span>
                  <span className="text-right tnum">{s.overridden}</span>
                  <span className="text-right tnum">{s.rejected}</span>
                  <span className={`justify-self-start rounded-full px-2.5 py-[3px] text-xs font-semibold ${tag[1]}`} title={s.rule ?? ""}>{tag[0]}</span>
                </div>
              );
            })}
          </section>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {cards(data.measures, data.baseline).map((c) => {
              const series = data.weeks.map((w) => w[c.key] as number | null);
              const [statusText, statusTone] = STATUS_UI[c.status];
              return (
                <section key={c.key} className="card flex flex-col gap-3 px-5 py-[18px]">
                  <div className="flex items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[13px] font-semibold text-[#24323C]">{c.label}</h2>
                      <p className="mt-0.5 text-xs leading-snug text-ink-soft">{c.question}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-[9px] py-[3px] text-[11px] font-semibold ${statusTone}`}>{statusText}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                      <span className="text-[30px] font-semibold leading-none tracking-[-0.01em] tnum">{c.value}</span>
                      <span className="text-xs text-ink-faint">{c.unit}</span>
                    </div>
                    <LineChart actual={series} target={targetValue(c.key, data.baseline)} label={c.label} weeks={data.weeks.map((w) => w.week)} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 border-t border-rule-soft pt-2.5 text-xs">
                    <div>
                      <dt className="text-ink-faint" title="How the agency did this by hand, before the agent">Before (by hand)</dt>
                      <dd className="mt-0.5 font-medium">{c.baseline}</dd>
                    </div>
                    <div><dt className="text-ink-faint">Target</dt><dd className="mt-0.5 font-medium">{c.target}</dd></div>
                  </dl>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
