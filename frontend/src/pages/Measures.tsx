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
  baseline: Record<string, number | null>; baseline_source: string; baseline_notes: string | null;
}

const PERIODS: [number | null, string][] = [[7, "7 days"], [28, "28 days"], [null, "Pilot to date"]];
const STEP_LABEL: Record<string, string> = { open_work_order: "Open work order", pull_vehicle: "Pull vehicle", reassign_runs: "Reassign runs" };
const SOURCE: Record<string, string> = { none: "Baseline not set yet", entered: "Baseline from Phase 0", measured_shadow: "Baseline from shadow mode", shadow_live: "Baseline measured live in shadow mode" };

type Status = "ok" | "close" | "none";
interface Card { label: string; key: keyof Values; value: string; unit: string; baseline: string; target: string; status: Status; lower?: boolean }

const fmtMin = (m: number | null | undefined) => (m == null ? "not set" : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${m} min`);
const pct = (v: number | null | undefined) => (v == null ? "not set" : `${v}%`);

function cards(m: Values, b: Record<string, number | null>): Card[] {
  const st = (v: number | null, ok: boolean, close = false): Status => (v == null ? "none" : ok ? "ok" : close ? "close" : "close");
  const v = m;
  return [
    { label: "Fault detection to open work order", key: "detect_to_work_order_minutes", value: v.detect_to_work_order_minutes == null ? "—" : String(v.detect_to_work_order_minutes),
      unit: v.detect_to_work_order_minutes == null ? "no data yet" : `min median · ${v.detect_to_work_order_samples} work order${v.detect_to_work_order_samples === 1 ? "" : "s"}`,
      baseline: fmtMin(b.detect_to_work_order_minutes), target: "Under 5 min", status: st(v.detect_to_work_order_minutes, (v.detect_to_work_order_minutes ?? 99) < 5), lower: true },
    { label: "Manual re-entry across products", key: "manual_reentries_per_incident", value: v.manual_reentries_per_incident == null ? "—" : String(v.manual_reentries_per_incident),
      unit: v.manual_reentries_per_incident == null ? "no data yet" : "per incident",
      baseline: b.manual_reentries_per_incident == null ? "not set" : `${b.manual_reentries_per_incident} per incident`, target: "Eliminated",
      status: st(v.manual_reentries_per_incident, v.manual_reentries_per_incident === 0), lower: true },
    { label: "Affected runs covered before pull-out", key: "runs_covered_pct", value: v.runs_covered_pct == null ? "—" : `${v.runs_covered_pct}%`,
      unit: v.runs_covered_pct == null ? "no data yet" : `${v.runs_covered} of ${v.runs_at_risk} runs`, baseline: pct(b.runs_covered_pct),
      target: b.runs_covered_pct == null ? "Above baseline" : `Above ${b.runs_covered_pct}%`,
      status: st(v.runs_covered_pct, (v.runs_covered_pct ?? 0) > (b.runs_covered_pct ?? 89)) },
    { label: "Decisions with a complete audit record", key: "audit_complete_pct", value: v.audit_complete_pct == null ? "—" : `${v.audit_complete_pct}%`,
      unit: v.audit_complete_pct == null ? "no data yet" : "of orchestrations", baseline: pct(b.audit_complete_pct), target: "100%",
      status: st(v.audit_complete_pct, v.audit_complete_pct === 100) },
    { label: "Dispatcher acceptance of recommendations", key: "acceptance_pct", value: v.acceptance_pct == null ? "—" : `${v.acceptance_pct}%`,
      unit: v.acceptance_pct == null ? "no decisions yet" : `approved unchanged · ${v.decisions} decision${v.decisions === 1 ? "" : "s"}`,
      baseline: "—", target: "Tracked weekly", status: st(v.acceptance_pct, (v.acceptance_pct ?? 0) >= 90) },
    { label: "Vehicle returned to schedule after close", key: "auto_returned_pct", value: v.auto_returned_pct == null ? "—" : `${v.auto_returned_pct}%`,
      unit: v.auto_returned_pct == null ? "no data yet" : "returned automatically", baseline: b.manual_steps_to_return == null ? "manual" : `${b.manual_steps_to_return} manual steps`,
      target: "Automatic", status: st(v.auto_returned_pct, v.auto_returned_pct === 100) },
  ];
}

const STATUS_UI: Record<Status, [string, string]> = { ok: ["On target", "bg-go-tint text-go"], close: ["Not yet", "bg-signal-tint text-signal-ink"], none: ["No data", "bg-[#EEF1F0] text-ink-soft"] };

export default function Measures() {
  const [days, setDays] = useState<number | null>(28);
  const { data, error } = useData<Pilot>(`/api/metrics/pilot${days ? `?days=${days}` : ""}`, [days]);

  return (
    <>
      <PageHeader title="Pilot measures" eyebrow="Governance · Vehicle health pilot · targets from the proposal, baseline from Phase 0"
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
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {cards(data.measures, data.baseline).map((c) => {
              const series = data.weeks.map((w) => w[c.key] as number | null);
              const max = Math.max(1, ...series.map((x) => x ?? 0));
              const [statusText, statusTone] = STATUS_UI[c.status];
              return (
                <section key={c.key} className="card flex flex-col gap-2.5 px-5 py-[18px]">
                  <div className="flex items-start gap-2.5">
                    <h2 className="flex-1 text-[13px] font-semibold text-[#24323C]">{c.label}</h2>
                    <span className={`rounded-full px-[9px] py-[3px] text-[11px] font-semibold ${statusTone}`}>{statusText}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[30px] font-semibold tracking-[-0.01em] tnum">{c.value}</span>
                    <span className="text-xs text-ink-faint">{c.unit}</span>
                  </div>
                  <div className="flex h-[34px] items-end gap-[3px]" role="img" aria-label={`${c.label}, last 8 weeks`}>
                    {series.map((x, i) => (
                      <span key={i} title={`Week of ${data.weeks[i].week}: ${x ?? "no data"}`}
                        className={`flex-1 rounded-[3px] ${x == null ? "bg-[#EEF1F0]" : i === series.length - 1 ? "bg-route" : "bg-reason-line"}`}
                        style={{ height: x == null ? "8%" : `${Math.max(8, Math.round((x / max) * 100))}%` }} />
                    ))}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 border-t border-rule-soft pt-2.5 text-xs">
                    <div><dt className="text-ink-faint">Baseline</dt><dd className="mt-0.5 font-medium">{c.baseline}</dd></div>
                    <div><dt className="text-ink-faint">Target</dt><dd className="mt-0.5 font-medium">{c.target}</dd></div>
                  </dl>
                </section>
              );
            })}
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
              <div className="min-w-[260px] flex-1">
                <h2 className="text-sm font-semibold">Dispatcher acceptance by step · weekly</h2>
                <p className="mt-0.5 text-xs text-ink-soft">Steps with steady acceptance are the candidates to move to “Agent acts” in the autonomy policy.</p>
              </div>
              <Link to="/policies" className="text-[13px] font-medium">Open autonomy policy →</Link>
            </div>
            <div className="grid grid-cols-[180px_minmax(0,1fr)_90px_90px_90px_170px] gap-3.5 bg-panel px-5 py-2.5 text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              <span>Step</span><span>Last 8 weeks</span><span className="text-right">Approved</span><span className="text-right">Changed</span><span className="text-right">Rejected</span><span />
            </div>
            {data.steps.map((s) => {
              const latest = [...s.weekly].reverse().find((w) => w.acceptance_pct != null)?.acceptance_pct;
              const tag = s.level === "autonomous" ? ["Agent acts already", "bg-route-tint text-route-dark"] : s.ready ? ["Ready for Agent acts", "bg-go-tint text-go"] : ["Keep approving", "bg-signal-tint text-signal-ink"];
              return (
                <div key={s.step} className="grid grid-cols-[180px_minmax(0,1fr)_90px_90px_90px_170px] items-center gap-3.5 border-t border-rule-soft px-5 py-3.5">
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
        </>
      )}
    </>
  );
}
