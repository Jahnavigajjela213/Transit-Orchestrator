import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, sentence } from "../lib/format";
import { useToast } from "../components/Toast";
import PerformanceChat from "../components/PerformanceChat";
import { Empty, ErrorNote, Loading, PageHeader, Section, Tag } from "../components/ui";

interface Group { key: string; otp: number; runs: number; pickups: number; late_pickups: number; avg_late_min: number; recovery_min: number; dwell_min: number; load_factor: number; no_show_rate: number }
interface Card {
  version: number; trained_at: string; trained_by: string; rows: number; date_from: string; date_to: string; features: number; notes: string;
  metrics: Record<string, number>; importance: { feature: string; label: string; kind: string; strength: number; worst?: string; best?: string; direction?: string; odds_ratio_worst_vs_best?: number }[];
}
interface Summary {
  otp_30d: number; otp_prior_30d: number; runs_30d: number; pickups_30d: number; late_pickups_30d: number; no_shows_30d: number; late_cancels_30d: number;
  no_show_rate_30d: number; road_calls_30d: number; otp_when_pm_overdue: number; otp_when_pm_current: number; history_days: number; history_runs: number;
  weekly: { week: string; otp: number; runs: number }[]; by_route: Group[]; by_band: Group[]; by_weather: Group[]; by_tenure: Group[];
  coaching_candidates: (Group & { driver_name: string; tenure_band: string })[]; riders_with_3plus_no_shows_30d: number;
  model: Card | null; slm_provider: string; suggested_questions: string[];
}
interface Lever { key: string; name: string; detail: string; effort: string; cost_note: string; runs_affected: number; uplift_pp: number; cumulative_otp?: number }
interface Plan { current_otp: number; target_otp: number; reached: boolean; levers: Lever[]; plan: Lever[]; projected_otp: number; max_with_all_levers: number; model_version: number; baseline_runs: number }

const pct = (x?: number | null) => (x === null || x === undefined ? "—" : `${x.toFixed(1)}%`);
const bandName: Record<string, string> = { am_peak: "Morning peak", midday: "Midday", pm_peak: "Afternoon peak" };

export default function Performance() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: s, error, reload } = useData<Summary>("/api/performance/summary");
  const [target, setTarget] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [training, setTraining] = useState(false);

  useEffect(() => { if (s && target === null) setTarget(Math.round(s.otp_30d) + 3); }, [s, target]);
  useEffect(() => {
    if (target === null) return;
    const t = setTimeout(() => api.get<Plan>(`/api/performance/plan?target=${target}`).then(setPlan).catch((e) => toast(e.message, "error")), 250);
    return () => clearTimeout(t);
  }, [target, s?.model?.version, toast]);

  async function retrain() {
    setTraining(true);
    try {
      const c = await api.post<Card>("/api/performance/train");
      toast(`Model v${c.version} trained on ${c.rows.toLocaleString()} runs`);
      reload();
    } catch (err: any) { toast(err.message, "error"); } finally { setTraining(false); }
  }

  if (error) return <ErrorNote message={error} />;
  if (!s) return <Loading />;
  const canTrain = user?.role === "admin" || user?.role === "dispatcher";
  const delta = s.otp_30d - s.otp_prior_30d;

  return (
    <div className="space-y-5">
      <PageHeader title="Operator performance"
        intro={`What drives on-time pickups at ${user?.tenant_name}, learned from ${s.history_days} days and ${s.history_runs.toLocaleString()} runs of your own history, and what would move it.`}
        actions={<>
          <button className="btn-quiet" onClick={() => api.download("/api/performance/training-data", "slm_finetune.jsonl")}><Download className="h-4 w-4" aria-hidden /> Fine-tuning data</button>
          {canTrain && <button className="btn-primary" disabled={training} onClick={retrain}><RefreshCw className={`h-4 w-4 ${training ? "animate-spin" : ""}`} aria-hidden /> Retrain model</button>}
        </>} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Section title="Plan to a target">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="text-xs text-ink-soft">On-time pickups, last 30 days</div>
                <div className="font-sign text-4xl font-extrabold tnum">{pct(s.otp_30d)}</div>
                <div className={`text-xs tnum ${delta >= 0 ? "text-go" : "text-stop"}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts vs the 30 days before</div>
              </div>
              <label className="block">
                <span className="label">Target OTP</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={Math.floor(s.otp_30d)} max={99} step={0.5} value={target ?? 0} onChange={(e) => setTarget(Number(e.target.value))} className="w-48 accent-route" aria-label="Target OTP" />
                  <input type="number" step={0.5} className="input w-20 tnum" value={target ?? ""} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Target OTP value" />
                </div>
              </label>
            </div>
            {plan && <PlanLadder plan={plan} />}
            {plan && (
              <p className={`text-sm ${plan.reached ? "text-go" : "text-[#8A5900]"}`}>
                {plan.current_otp >= plan.target_otp ? "You're already at this target." :
                  plan.reached ? `Projected ${pct(plan.projected_otp)} with ${plan.plan.length} lever${plan.plan.length === 1 ? "" : "s"}, ranked by expected gain.` :
                    `Not reachable with these levers: all of them together project ${pct(plan.max_with_all_levers)}. The rest needs structural change, such as more vehicles or a schedule redesign.`}
              </p>
            )}
            {plan && plan.levers.length > 0 && (
              <div className="overflow-x-auto rounded-sm border border-rule">
                <table className="table">
                  <thead><tr><th>Lever</th><th>Expected gain</th><th>Effort</th><th>What it takes</th></tr></thead>
                  <tbody>{plan.levers.map((l) => {
                    const inPlan = plan.plan.find((p) => p.key === l.key);
                    return (
                      <tr key={l.key} className={inPlan ? "" : "text-ink-soft"}>
                        <td><div className="font-medium">{l.name}</div><div className="text-2xs text-ink-soft">{l.detail}</div></td>
                        <td className="tnum whitespace-nowrap font-semibold">+{l.uplift_pp.toFixed(2)} pts{inPlan && <div className="text-2xs font-normal text-ink-soft">to {pct(inPlan.cumulative_otp)}</div>}</td>
                        <td><Tag color={l.effort === "low" ? "green" : l.effort === "medium" ? "amber" : "red"}>{sentence(l.effort)}</Tag></td>
                        <td className="text-xs">{l.cost_note}<div className="text-ink-faint">{l.runs_affected} runs in the last 30 days</div></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            <p className="text-2xs text-ink-faint">Each lever changes the real conditions of your last 30 days of runs and is scored by model v{plan?.model_version}. Gains are not simply additive; the cumulative column applies them together.</p>
          </div>
        </Section>

        <PerformanceChat provider={s.slm_provider} suggestions={s.suggested_questions} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Section title="Weekly on-time performance"><TrendChart weeks={s.weekly} /></Section>
        <Section title="Model">
          {!s.model ? <Empty title="No model trained yet" /> : (
            <div className="space-y-3 p-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Version" value={`v${s.model.version}`} />
                <Stat label="Daily OTP error on holdout" value={`${s.model.metrics.holdout_daily_otp_mae_pp} pts`} />
                <Stat label="Better than a flat guess" value={`${s.model.metrics.log_loss_improvement_pct}%`} />
              </div>
              <p className="text-xs text-ink-soft">Trained {dayTime(s.model.trained_at)} by {s.model.trained_by} on {s.model.rows.toLocaleString()} runs ({s.model.date_from} to {s.model.date_to}). Last {s.model.metrics.holdout_days} days held out: actual {pct(s.model.metrics.holdout_otp_actual)}, predicted {pct(s.model.metrics.holdout_otp_predicted)}.</p>
              <h3 className="pt-1 text-xs font-bold text-ink-soft">What drives late pickups</h3>
              <ul className="space-y-1.5">
                {s.model.importance.map((f) => {
                  const max = s.model!.importance[0].strength || 1;
                  return (
                    <li key={f.feature}>
                      <div className="flex justify-between gap-2 text-xs"><span className="font-medium">{f.label}</span>
                        <span className="text-ink-soft">{f.kind === "category" ? `${sentence(bandName[f.worst!] ?? f.worst)} worst, ${f.odds_ratio_worst_vs_best}x the odds of ${bandName[f.best!] ?? f.best}` : f.direction}</span></div>
                      <div className="mt-0.5 h-1.5 rounded-sm bg-paper"><div className="h-1.5 rounded-sm bg-route" style={{ width: `${(100 * f.strength) / max}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section title="By route, last 30 days">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Route</th><th>OTP</th><th>Late pickups</th><th>Avg minutes late</th><th>Recovery per block</th><th>Dwell per stop</th><th>Load</th><th>No-shows</th></tr></thead>
            <tbody>{s.by_route.map((g) => (
              <tr key={g.key}><td className="font-medium">{g.key}</td><td><OtpCell v={g.otp} /></td><td className="tnum">{g.late_pickups}</td><td className="tnum">{g.avg_late_min}</td>
                <td className="tnum">{g.recovery_min} min</td><td className="tnum">{g.dwell_min} min</td><td className="tnum">{Math.round(g.load_factor * 100)}%</td><td className="tnum">{g.no_show_rate}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-5 md:grid-cols-3">
        <SmallTable title="Time of day" rows={s.by_band} name={(k) => bandName[k] ?? k} />
        <SmallTable title="Weather" rows={s.by_weather} name={sentence} />
        <SmallTable title="Operator experience" rows={s.by_tenure} name={sentence} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Coaching candidates, last 60 days">
          <table className="table">
            <thead><tr><th>Operator</th><th>Experience</th><th>Runs</th><th>OTP</th></tr></thead>
            <tbody>{s.coaching_candidates.map((d) => (
              <tr key={d.driver_name}><td>{d.driver_name}</td><td>{sentence(d.tenure_band)}</td><td className="tnum">{d.runs}</td><td><OtpCell v={d.otp} /></td></tr>
            ))}</tbody>
          </table>
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Lowest OTP among operators with at least 15 runs. Route mix matters, so read alongside the route table.</p>
        </Section>
        <Section title="Reliability and no-shows, last 30 days">
          <div className="grid grid-cols-2 gap-4 p-4">
            <Stat label="No-shows" value={`${s.no_shows_30d} (${s.no_show_rate_30d}%)`} />
            <Stat label="Late cancellations" value={String(s.late_cancels_30d)} />
            <Stat label="Riders with 3+ no-shows" value={String(s.riders_with_3plus_no_shows_30d)} />
            <Stat label="Breakdowns during runs" value={String(s.road_calls_30d)} />
            <Stat label="OTP when vehicle overdue for PM" value={pct(s.otp_when_pm_overdue)} />
            <Stat label="OTP when PM is current" value={pct(s.otp_when_pm_current)} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-2xs text-ink-soft">{label}</div><div className="font-sign text-lg font-bold tnum">{value}</div></div>;
}

function OtpCell({ v }: { v: number }) {
  return <span className={`tnum font-semibold ${v < 85 ? "text-stop" : v < 90 ? "text-[#8A5900]" : "text-go"}`}>{pct(v)}</span>;
}

function SmallTable({ title, rows, name }: { title: string; rows: Group[]; name: (k: string) => string }) {
  return (
    <Section title={title}>
      <table className="table">
        <thead><tr><th></th><th>OTP</th><th>Runs</th></tr></thead>
        <tbody>{rows.map((g) => <tr key={g.key}><td>{name(g.key)}</td><td><OtpCell v={g.otp} /></td><td className="tnum">{g.runs}</td></tr>)}</tbody>
      </table>
    </Section>
  );
}

function PlanLadder({ plan }: { plan: Plan }) {
  const lo = Math.floor(Math.min(plan.current_otp, plan.target_otp) - 1);
  const hi = Math.ceil(Math.max(plan.target_otp, plan.max_with_all_levers) + 0.5);
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  let prev = plan.current_otp;
  return (
    <div className="relative pt-5 pb-6" aria-label={`From ${plan.current_otp}% toward ${plan.target_otp}%`}>
      <div className="relative h-4 rounded-sm bg-paper">
        <div className="absolute inset-y-0 left-0 rounded-l bg-ink/80" style={{ width: x(plan.current_otp) }} />
        {plan.plan.map((st, i) => {
          const seg = <div key={st.key} title={`${st.name}: +${st.uplift_pp.toFixed(2)} pts`} className={`absolute inset-y-0 border-l border-white ${i % 2 ? "bg-route/70" : "bg-route"}`}
            style={{ left: x(prev), width: `calc(${x(st.cumulative_otp!)} - ${x(prev)})` }} />;
          prev = st.cumulative_otp!;
          return seg;
        })}
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-signal" style={{ left: x(plan.target_otp) }} />
        <div className="absolute -top-5 -translate-x-1/2 text-2xs font-semibold text-[#8A5900] tnum" style={{ left: x(plan.target_otp) }}>Target {plan.target_otp}%</div>
        <div className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-ink-faint" style={{ left: x(plan.max_with_all_levers) }} />
      </div>
      <div className="absolute bottom-0 left-0 text-2xs text-ink-faint tnum">{lo}%</div>
      <div className="absolute bottom-0 text-2xs text-ink-soft tnum" style={{ left: x(plan.current_otp) }}>now {plan.current_otp}%</div>
      <div className="absolute bottom-0 right-0 text-2xs text-ink-faint tnum">{hi}%</div>
    </div>
  );
}

function TrendChart({ weeks }: { weeks: { week: string; otp: number; runs: number }[] }) {
  const pts = weeks.filter((w) => w.otp !== null);
  if (pts.length < 2) return <Empty title="Not enough history yet" />;
  const W = 640, H = 200, P = 32;
  const ys = pts.map((p) => p.otp);
  const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
  const X = (i: number) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const Y = (v: number) => H - P + 6 - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.otp).toFixed(1)}`).join(" ");
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <div className="overflow-x-auto p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="Weekly OTP trend">
        {ticks.map((t) => (
          <g key={t}><line x1={P} x2={W - P} y1={Y(t)} y2={Y(t)} stroke="#D3D9DF" strokeDasharray="3 3" />
            <text x={4} y={Y(t) + 4} fontSize="10" fill="#7A8693">{t}%</text></g>
        ))}
        <path d={path} fill="none" stroke="#0B6E69" strokeWidth="2.5" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={p.week} cx={X(i)} cy={Y(p.otp)} r="3" fill="#fff" stroke="#0B6E69" strokeWidth="2"><title>{`Week of ${p.week}: ${p.otp}% over ${p.runs} runs`}</title></circle>)}
        {pts.map((p, i) => (i % 3 === 0 || i === pts.length - 1) && <text key={`t${p.week}`} x={X(i)} y={H - 4} fontSize="10" fill="#7A8693" textAnchor="middle">{p.week.slice(5)}</text>)}
      </svg>
    </div>
  );
}
