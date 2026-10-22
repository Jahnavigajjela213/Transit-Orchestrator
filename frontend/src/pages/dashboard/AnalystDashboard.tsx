import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, FlaskConical, GitBranch, UserCheck } from "lucide-react";
import { useData } from "../../lib/live";
import { sentence } from "../../lib/format";
import type { ShadowRec, Workflow } from "../../lib/types";
import { StatTile, StatTileRow } from "../../components/dashboard/DashboardShell";
import { CategoryBarChart, DonutChart, MultiLineChart, type Series } from "../../components/dashboard/charts";
import { STATUS, escalated, groupOf, type Group } from "../Workflows";

interface EvalRunRow { id: string; status: string; score_pct: number | null; started_at: string; summary?: { cases?: number } }
interface EvalsListing { runs: EvalRunRow[] }
interface ShadowStep { step: string; recommended: number; matched: number; differed: number }
interface ShadowSummary { steps: ShadowStep[]; total: number }
const STEP_LABEL: Record<string, string> = { open_work_order: "Open work order", pull_vehicle: "Pull vehicle", reassign_runs: "Reassign runs", notify_riders: "Notify riders", return_to_service: "Return to service", adjust_schedule: "Adjust schedule" };

const TERMINAL = new Set(["completed", "completed_with_issues", "failed", "rejected", "compensated"]);
const PERIOD_HOURS = 168;
const COLOR = { success: "#1F6B40", failure: "#B42318", total: "#0B6E69" };
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/** The title, a couple of tinted stat badges top-right (the "In service / Out of service" look), then a bar chart. */
function StatusBars({ title, stats, hasData, chart }: {
  title: string; stats: { label: string; value: string; tone: "go" | "stop" }[]; hasData: boolean; chart: ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <div className="flex shrink-0 items-stretch gap-2.5 text-right">
          {stats.map((s) => (
            <div key={s.label} className={`rounded-lg px-3 py-1.5 ${s.tone === "go" ? "bg-go-tint" : "bg-stop-tint"}`}>
              <div className={`text-xl font-semibold tnum ${s.tone === "go" ? "text-go" : "text-stop"}`}>{s.value}</div>
              <div className={`text-2xs ${s.tone === "go" ? "text-go" : "text-stop"}`}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      {!hasData ? <p className="mt-4 text-sm text-ink-soft">Not enough data yet.</p> : (
        <div className="mt-5">{chart}</div>
      )}
    </section>
  );
}

/** One rate as its own card: the number, then a track-and-fill bar reading the same percentage. */
function RateCard({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  return (
    <div className="rounded-xl border border-rule bg-[#FAFBFA] px-4 py-3.5">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-xl font-semibold tnum" style={{ color }}>{fmtPct(pct)}</div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-[#EEF1F0]">
        <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: color }} />
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
  const donutColors: Record<Group, string> = { approval: "#E3A23C", motion: "#2F9E8F", shop: "#5B6EE8", done: "#7CB342", issues: "#D65A4E" };

  // ---- Chart 3a: AI recommendation vs what the person actually did, by step ----
  const shadowDecidedSteps = useMemo(() => (shadowSummary?.steps ?? []).filter((s) => s.matched + s.differed > 0), [shadowSummary]);
  const shadowTotals = shadowDecidedSteps.reduce((acc, s) => ({ matched: acc.matched + s.matched, differed: acc.differed + s.differed }), { matched: 0, differed: 0 });
  const shadowDecidedTotal = shadowTotals.matched + shadowTotals.differed;
  const agreedPct = shadowDecidedTotal ? (shadowTotals.matched / shadowDecidedTotal) * 100 : null;
  const differedPct = shadowDecidedTotal ? (shadowTotals.differed / shadowDecidedTotal) * 100 : null;
  // Hover detail for each bar: the same total broken down by step, so "why" is one hover away.
  const shadowTooltips = useMemo(() => {
    const rows = shadowDecidedSteps.map((s) => ({ label: STEP_LABEL[s.step] ?? sentence(s.step), matched: s.matched, differed: s.differed, total: s.matched + s.differed }));
    const byStep = (key: "matched" | "differed", heading: string) => (
      <>
        <div className="mb-1 font-semibold text-ink">{heading} by step</div>
        <div className="space-y-0.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <span className="whitespace-nowrap text-ink-soft">{r.label}</span>
              <span className="whitespace-nowrap font-semibold tnum">{Math.round((r[key] / r.total) * 100)}%<span className="ml-1 font-normal text-ink-faint">({r[key]}/{r.total})</span></span>
            </div>
          ))}
        </div>
      </>
    );
    return [byStep("matched", "Agreed"), byStep("differed", "Differed")];
  }, [shadowDecidedSteps]);

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
        <section className="card flex flex-col p-4">
          <h2 className="text-[15px] font-semibold">Workflow performance over time</h2>
          {!dataLoaded ? <p className="mt-3 text-sm text-ink-soft">Loading…</p> : (
            <div className="mt-3 flex flex-1 flex-col justify-center"><MultiLineChart series={perfSeries} xLabels={bLabels} height={230} ariaLabel="Workflow performance over time" /></div>
          )}
        </section>
        <section className="card flex flex-col p-4">
          <h2 className="text-[15px] font-semibold">Orchestration status distribution</h2>
          <div className="mt-3 flex flex-1 items-center">
            <DonutChart centerLabel="orchestrations" ariaLabel="Current orchestration status distribution" size={210}
              segments={chartGroups.map((c) => ({ label: c.label, value: c.n, color: donutColors[c.g] }))} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <StatusBars title="AI recommendation vs Shadow Mode"
          stats={[{ label: "Agreed", value: fmtPct(agreedPct), tone: "go" }, { label: "Differed", value: fmtPct(differedPct), tone: "stop" }]}
          hasData={shadowDecidedTotal > 0}
          chart={<CategoryBarChart categories={["Agreed", "Differed"]} values={[shadowTotals.matched, shadowTotals.differed]}
            colors={[COLOR.success, COLOR.failure]} ariaLabel="AI recommendation vs Shadow Mode" tooltips={shadowTooltips} />} />
        <section className="card p-4">
          <h2 className="text-[15px] font-semibold">Success vs failure rate</h2>
          <div className="mt-3 flex flex-col gap-3">
            <RateCard label="Successful" pct={successRate} color={COLOR.success} />
            <RateCard label="Not successful" pct={failureRate} color={COLOR.failure} />
          </div>
        </section>
      </div>
    </div>
  );
}
