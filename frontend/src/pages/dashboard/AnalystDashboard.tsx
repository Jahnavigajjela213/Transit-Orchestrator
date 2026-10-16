import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, FlaskConical, GitBranch, UserCheck } from "lucide-react";
import { useData } from "../../lib/live";
import { sentence } from "../../lib/format";
import type { ShadowRec, Workflow } from "../../lib/types";
import { StatTile, StatTileRow } from "../../components/dashboard/DashboardShell";
import { DonutChart, MultiLineChart, type Series } from "../../components/dashboard/charts";
import { STATUS, escalated, groupOf, type Group } from "../Workflows";

interface EvalRunRow { id: string; status: string; score_pct: number | null; started_at: string; summary?: { cases?: number } }
interface EvalsListing { runs: EvalRunRow[] }
interface ShadowStep { step: string; recommended: number; matched: number; differed: number }
interface ShadowSummary { steps: ShadowStep[]; total: number }
const STEP_LABEL: Record<string, string> = { open_work_order: "Open work order", pull_vehicle: "Pull vehicle", reassign_runs: "Reassign runs", notify_riders: "Notify riders", return_to_service: "Return to service", adjust_schedule: "Adjust schedule" };

const TERMINAL = new Set(["completed", "completed_with_issues", "failed", "rejected", "compensated"]);
const PERIOD_HOURS = 168;
const COLOR = { success: "#1F6B40", failure: "#B42318", total: "#0B6E69", risk: "#D98A00" };
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/** Green/amber/red by how good a rate is - the same traffic-light reading as everywhere else in the app. */
function rateColor(pct: number): string { return pct >= 80 ? COLOR.success : pct >= 50 ? COLOR.risk : COLOR.failure; }

/** The "SLA card" look: a couple of headline rates, then one short vertical bar per category - a grey track
 *  behind a colored fill, so the eye reads status from color and from height at the same time. */
function StatusBars({ title, stats, bars }: {
  title: string; stats: { label: string; value: string; color: string }[]; bars: { label: string; pct: number; color: string }[];
}) {
  return (
    <section className="card p-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-xs text-ink-soft">{s.label}</div>
            <div className="text-xl font-semibold tnum" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      {bars.length === 0 ? <p className="mt-4 text-sm text-ink-soft">Not enough data yet.</p> : (
        <div className="mt-5 flex gap-4" style={{ height: 150 }} role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.pct.toFixed(0)}%`).join(", ")}`}>
          {bars.map((b) => (
            <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="relative w-7 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]">
                <div className="absolute bottom-0 left-0 w-full rounded-full" style={{ height: `${Math.max(2, b.pct)}%`, background: b.color }} />
              </div>
              <span className="max-w-[80px] truncate text-[11px] text-ink-faint" title={b.label}>{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One rate as its own small horizontal card: the number, then a track-and-fill bar reading the same percentage. */
function RateCard({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  return (
    <div className="rounded-xl border border-rule bg-[#FAFBFA] px-4 py-3.5">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-xl font-semibold tnum" style={{ color }}>{fmtPct(pct)}</div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-[#EEF1F0]">
        <div className="h-full rounded-full" style={{ width: `${pct === null ? 0 : Math.max(2, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

/** Bucket keys/labels for the selected period: hourly for 24h, daily otherwise. UTC-based, so bucket edges may be
 *  an hour off the agency's own midnight - fine for a trend shape, not for billing-grade reporting. */
function buckets(periodHours: number): { keys: string[]; labels: string[]; granularity: "hour" | "day" } {
  const granularity: "hour" | "day" = periodHours <= 24 ? "hour" : "day";
  const n = granularity === "hour" ? 24 : periodHours / 24;
  const keys: string[] = [], labels: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    if (granularity === "hour") { d.setMinutes(0, 0, 0); d.setHours(d.getHours() - i); keys.push(d.toISOString().slice(0, 13)); labels.push(d.toLocaleTimeString([], { hour: "numeric" })); }
    else { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); keys.push(d.toISOString().slice(0, 10)); labels.push(d.toLocaleDateString([], { month: "short", day: "numeric" })); }
  }
  return { keys, labels, granularity };
}
const bucketKey = (iso: string, granularity: "hour" | "day") => (granularity === "hour" ? iso.slice(0, 13) : iso.slice(0, 10));

export default function AnalystDashboard() {
  const nav = useNavigate();
  const periodHours = PERIOD_HOURS;

  const { data: wfs } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=500");
  const { data: evals } = useData<EvalsListing>("/api/evals");
  const { data: shadowRecs } = useData<ShadowRec[]>("/api/shadow?limit=500");
  const { data: shadowSummary } = useData<ShadowSummary>("/api/shadow/summary");

  const since = Date.now() - periodHours * 3600_000;
  const liveWfs = useMemo(() => (wfs ?? []).filter((w) => w.status !== "shadow"), [wfs]);
  const inPeriod = useMemo(() => liveWfs.filter((w) => new Date(w.started_at).getTime() >= since), [liveWfs, since]);
  const eligible = useMemo(() => inPeriod.filter((w) => TERMINAL.has(w.status)), [inPeriod]);

  // ---- KPI 1: workflows evaluated - eval cases across eval runs in the period ----
  const evalRunsInPeriod = useMemo(() => (evals?.runs ?? []).filter((r) => new Date(r.started_at).getTime() >= since), [evals, since]);
  const evalCases = evalRunsInPeriod.reduce((n, r) => n + (r.summary?.cases ?? 0), 0);

  // ---- KPI 2: workflow success rate ------------------------------------------
  const successCount = eligible.filter((w) => w.status === "completed").length;
  const successRate = eligible.length ? (successCount / eligible.length) * 100 : null;

  // ---- KPI 3: human intervention rate (escalated or rejected) ----------------
  const interventions = eligible.filter((w) => escalated(w) || w.status === "rejected").length;
  const interventionRate = eligible.length ? (interventions / eligible.length) * 100 : null;

  // ---- KPI 4: shadow evaluations - decided comparisons in the period ---------
  const shadowInPeriod = useMemo(() => (shadowRecs ?? []).filter((r) => new Date(r.recommended_at).getTime() >= since), [shadowRecs, since]);
  const shadowCompleted = shadowInPeriod.filter((r) => r.status === "matched" || r.status === "differed").length;

  // ---- Chart 1: workflow performance over time -------------------------------
  const { keys: bKeys, labels: bLabels, granularity } = useMemo(() => buckets(periodHours), [periodHours]);
  const perfSeries: Series[] = useMemo(() => {
    const succ = new Array(bKeys.length).fill(0), fail = new Array(bKeys.length).fill(0), tot = new Array(bKeys.length).fill(0);
    eligible.forEach((w) => {
      const ts = w.completed_at ?? w.updated_at;
      const idx = bKeys.indexOf(bucketKey(ts, granularity));
      if (idx < 0) return;
      tot[idx] += 1;
      if (w.status === "completed") succ[idx] += 1; else if (w.status === "failed") fail[idx] += 1;
    });
    return [{ name: "Successful", color: COLOR.success, values: succ }, { name: "Failed", color: COLOR.failure, values: fail }, { name: "Total completed", color: COLOR.total, values: tot }];
  }, [eligible, bKeys, granularity]);

  // ---- Chart 2: current status distribution (point-in-time, not period-scoped) ----
  const chartGroups = (["approval", "motion", "shop", "done", "issues"] as Group[]).map((g) => ({ g, label: STATUS[g][0], n: liveWfs.filter((w) => groupOf(w) === g).length }));
  const donutColors: Record<Group, string> = { approval: "#D98A00", motion: "#0B6E69", shop: "#3B4CB8", done: "#1F6B40", issues: "#B42318" };

  // ---- Chart 3a: AI recommendation vs what the person actually did, by step ----
  const shadowDecidedSteps = useMemo(() => (shadowSummary?.steps ?? []).filter((s) => s.matched + s.differed > 0), [shadowSummary]);
  const shadowTotals = shadowDecidedSteps.reduce((acc, s) => ({ matched: acc.matched + s.matched, differed: acc.differed + s.differed }), { matched: 0, differed: 0 });
  const shadowDecidedTotal = shadowTotals.matched + shadowTotals.differed;
  const agreedPct = shadowDecidedTotal ? (shadowTotals.matched / shadowDecidedTotal) * 100 : null;
  const differedPct = shadowDecidedTotal ? (shadowTotals.differed / shadowDecidedTotal) * 100 : null;
  const shadowBars = useMemo(() => shadowDecidedSteps.map((s) => {
    const pct = (s.matched / (s.matched + s.differed)) * 100;
    return { label: STEP_LABEL[s.step] ?? sentence(s.step), pct, color: rateColor(pct) };
  }), [shadowDecidedSteps]);

  // ---- Chart 3b: success vs failure rate - two side-by-side rate cards ----
  const failureRate = successRate === null ? null : 100 - successRate;

  const dataLoaded = !!wfs;

  return (
    <div className="dash-scroll space-y-5 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
      <StatTileRow>
        <StatTile label="Workflows Evaluated" icon={FlaskConical} value={evals ? evalCases : "—"} sub="Selected reporting period" onClick={() => nav("/evals")} />
        <StatTile label="Workflow Success Rate" icon={GitBranch} value={successRate !== null ? `${successRate.toFixed(1)}%` : "—"} sub="Based on defined outcomes"
          tone={successRate === null ? undefined : successRate >= 90 ? "good" : "warn"} onClick={() => nav("/workflows?status=done")} />
        <StatTile label="Human Intervention Rate" icon={UserCheck} value={interventionRate !== null ? `${interventionRate.toFixed(1)}%` : "—"} sub="Approvals and overrides"
          tone={interventionRate === null ? undefined : interventionRate > 20 ? "warn" : "good"} onClick={() => nav("/audit")} />
        <StatTile label="Shadow Evaluations" icon={Eye} value={shadowRecs ? shadowCompleted : "—"} sub="Completed comparisons" onClick={() => nav("/shadow")} />
      </StatTileRow>

      <div className="grid grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <section className="card p-4">
          <h2 className="text-[15px] font-semibold">Workflow performance over time</h2>
          {!dataLoaded ? <p className="mt-3 text-sm text-ink-soft">Loading…</p> : (
            <div className="mt-3"><MultiLineChart series={perfSeries} xLabels={bLabels} height={180} ariaLabel="Workflow performance over time" /></div>
          )}
        </section>
        <section className="card p-4">
          <h2 className="text-[15px] font-semibold">Orchestration status distribution</h2>
          <div className="mt-3">
            <DonutChart centerLabel="orchestrations" ariaLabel="Current orchestration status distribution" size={130}
              segments={chartGroups.map((c) => ({ label: c.label, value: c.n, color: donutColors[c.g] }))} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <StatusBars title="AI recommendation vs Shadow Mode"
          stats={[{ label: "Agreed", value: fmtPct(agreedPct), color: COLOR.success }, { label: "Differed", value: fmtPct(differedPct), color: COLOR.failure }]}
          bars={shadowBars} />
        <section className="card p-4">
          <h2 className="text-[15px] font-semibold">Success vs failure rate</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <RateCard label="Successful" pct={successRate} color={COLOR.success} />
            <RateCard label="Not successful" pct={failureRate} color={COLOR.failure} />
          </div>
        </section>
      </div>
    </div>
  );
}
