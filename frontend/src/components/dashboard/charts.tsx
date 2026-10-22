/** Plain SVG charts, drawn to scale, colored from the design tokens — no chart library. */
import { useState, type ReactNode } from "react";

const TOKEN: Record<string, string> = { route: "#0B6E69", signal: "#D98A00", stop: "#B42318", go: "#1F6B40", shop: "#3B4CB8" };

/** A small line + area, the last point emphasised. Callers decide when there isn't enough history to be worth
 *  drawing (the dashboard's rule is "at least 3 points") — this just draws whatever series it is given. */
export function Sparkline({ values, tone = "route", width = 120, height = 34, ariaLabel }: {
  values: (number | null)[]; tone?: keyof typeof TOKEN; width?: number; height?: number; ariaLabel: string;
}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const color = TOKEN[tone] ?? TOKEN.route;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const P = 2;
  const x = (i: number) => P + (i * (width - 2 * P)) / Math.max(1, values.length - 1);
  const y = (v: number) => height - P - ((v - lo) / span) * (height - 2 * P);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts[pts.length - 1].i).toFixed(1)},${height - P} L${x(pts[0].i).toFixed(1)},${height - P} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
      aria-label={`${ariaLabel}: ${pts.map((p) => p.v).join(", ")}, last ${last.v}`}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill={color} />
    </svg>
  );
}

/** A 12-ish-week line chart with a light grid, a dashed target line, and the last point labelled. */
export function LineChart({ series, target, targetLabel, yUnit = "%", ariaLabel }: {
  series: { label: string; value: number | null }[]; target?: number; targetLabel?: string; yUnit?: string; ariaLabel: string;
}) {
  const pts = series.map((s, i) => ({ ...s, i })).filter((p): p is { label: string; value: number; i: number } => p.value !== null);
  if (pts.length < 2) return <p className="text-sm text-ink-soft">Not enough history yet.</p>;
  const W = 640, H = 220, P = 34;
  const ys = pts.map((p) => p.value).concat(target !== undefined ? [target] : []);
  const lo = Math.floor(Math.min(...ys) - 1), hi = Math.ceil(Math.max(...ys) + 1);
  const x = (i: number) => P + (i * (W - 2 * P)) / (series.length - 1);
  const y = (v: number) => H - P + 6 - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const last = pts[pts.length - 1];
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img"
        aria-label={`${ariaLabel}: ${pts.map((p) => `${p.label} ${p.value}${yUnit}`).join(", ")}${target !== undefined ? `, target ${target}${yUnit}` : ""}`}>
        {ticks.map((t) => (
          <g key={t}><line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="#D3D9DF" strokeDasharray="3 3" />
            <text x={4} y={y(t) + 4} fontSize="10" fill="#7A8693">{t}{yUnit}</text></g>
        ))}
        {target !== undefined && (
          <g>
            <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} stroke={TOKEN.go} strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - P} y={y(target) - 6} fontSize="10.5" fontWeight={600} fill={TOKEN.go} textAnchor="end">{targetLabel ?? `Target ${target}${yUnit}`}</text>
          </g>
        )}
        <path d={line} fill="none" stroke={TOKEN.route} strokeWidth={2.25} strokeLinejoin="round" />
        {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.value)} r={p.i === last.i ? 3.5 : 2.5} fill="#fff" stroke={TOKEN.route} strokeWidth={2} />)}
        <text x={x(last.i)} y={y(last.value) - 10} fontSize="11" fontWeight={700} fill={TOKEN.route} textAnchor="middle">{last.value}{yUnit}</text>
        {pts.map((p, k) => (k % 2 === 0 || k === pts.length - 1) && (
          <text key={`t${p.i}`} x={x(p.i)} y={H - 6} fontSize="10" fill="#7A8693" textAnchor="middle">{p.label}</text>
        ))}
      </svg>
    </div>
  );
}

export interface TimelineRow { id: string; label: string; start: string; end: string; tone: "route" | "signal" | "stop" | "go"; note?: string }

/** A horizontal "what's running when" strip: one bar per row, a dashed "now" line, a legend underneath. */
export function Timeline({ rows, windowStart, windowEnd, now, ariaLabel }: {
  rows: TimelineRow[]; windowStart: Date; windowEnd: Date; now?: Date; ariaLabel: string;
}) {
  if (rows.length === 0) return null;
  const W = 640, RowH = 30, P = 8, LabelW = 120;
  const H = rows.length * RowH + P * 2;
  const span = windowEnd.getTime() - windowStart.getTime() || 1;
  const x = (iso: string) => LabelW + P + Math.max(0, Math.min(1, (new Date(iso).getTime() - windowStart.getTime()) / span)) * (W - LabelW - P * 2);
  const hour = (d: Date) => d.toLocaleTimeString([], { hour: "numeric" });
  const hourTicks: Date[] = [];
  for (let t = new Date(windowStart); t <= windowEnd; t.setHours(t.getHours() + 2)) hourTicks.push(new Date(t));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full min-w-[520px]" role="img"
        aria-label={`${ariaLabel}: ${rows.map((r) => `${r.label} ${r.start}–${r.end} (${r.tone})`).join("; ")}`}>
        {hourTicks.map((t) => (
          <g key={t.toISOString()}><line x1={x(t.toISOString())} x2={x(t.toISOString())} y1={0} y2={H} stroke="#EEF1F0" />
            <text x={x(t.toISOString())} y={H + 14} fontSize="9.5" fill="#9AA4AB" textAnchor="middle">{hour(t)}</text></g>
        ))}
        {rows.map((r, i) => {
          const y = P + i * RowH;
          const x1 = x(r.start), x2 = Math.max(x1 + 3, x(r.end));
          return (
            <g key={r.id}>
              <text x={0} y={y + RowH / 2 + 4} fontSize="10.5" fontFamily="var(--font-mono, monospace)" fill="#4B5862">{r.label}</text>
              <rect x={x1} y={y + 5} width={x2 - x1} height={RowH - 14} rx={4} fill={TOKEN[r.tone]} opacity={r.tone === "stop" ? 1 : 0.85} />
              {r.note && <text x={x1 + 6} y={y + RowH / 2 + 4} fontSize="9.5" fill="#fff" fontWeight={600}>{r.note}</text>}
            </g>
          );
        })}
        {now && now >= windowStart && now <= windowEnd && (
          <line x1={x(now.toISOString())} x2={x(now.toISOString())} y1={0} y2={H} stroke="#111A20" strokeDasharray="3 3" strokeWidth={1.25} />
        )}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: TOKEN.route }} />Covered</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: TOKEN.signal }} />Awaiting approval</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: TOKEN.stop }} />Needs cover</span>
        {now && <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-0.5 bg-ink" />Now</span>}
      </div>
    </div>
  );
}

/** A plain proportion bar — booked/total bays, acceptance percent, a plan's progress. Divs, not SVG: it's one number. */
export function HBar({ pct, tone = "route", height = 10 }: { pct: number; tone?: keyof typeof TOKEN; height?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="overflow-hidden rounded-[5px] bg-[#EEF1F0]" style={{ height }} role="img" aria-label={`${Math.round(clamped)}%`}>
      <div className="h-full rounded-[5px]" style={{ width: `${clamped}%`, background: TOKEN[tone] ?? TOKEN.route }} />
    </div>
  );
}

export interface Series { name: string; color: string; values: (number | null)[] }

/** Two or more series sharing one set of x labels, with a legend underneath. Each series may have its own gaps. */
export function MultiLineChart({ series, xLabels, yUnit = "", ariaLabel, height = 230 }: { series: Series[]; xLabels: string[]; yUnit?: string; ariaLabel: string; height?: number }) {
  const allVals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (allVals.length < 2 || xLabels.length < 2) return <p className="text-sm text-ink-soft">Not enough history yet.</p>;
  const W = 640, H = height, P = 34, topPad = 16, bottomPad = 26;
  const ticks = niceTicks(Math.max(0, ...allVals));
  const lo = 0, hi = ticks[ticks.length - 1];
  const x = (i: number) => P + (i * (W - 2 * P)) / (xLabels.length - 1);
  const y = (v: number) => H - bottomPad - ((v - lo) / (hi - lo || 1)) * (H - topPad - bottomPad);
  const desc = series.map((s) => `${s.name}: ${s.values.map((v) => v ?? "—").join(", ")}`).join("; ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label={`${ariaLabel}: ${desc}`}>
        {ticks.map((t) => (
          <g key={t}><line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="#D3D9DF" strokeDasharray="3 3" />
            <text x={4} y={y(t) + 4} fontSize="10" fill="#7A8693">{t}{yUnit}</text></g>
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
          const runs: string[] = []; let cur = "";
          s.values.forEach((v, i) => { if (v == null) { if (cur) runs.push(cur); cur = ""; return; } cur += `${cur ? " L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
          if (cur) runs.push(cur);
          return (
            <g key={s.name}>
              {runs.map((d, k) => <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />)}
              {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.5} fill="#fff" stroke={s.color} strokeWidth={2} />)}
            </g>
          );
        })}
        {xLabels.map((l, i) => (i % 2 === 0 || i === xLabels.length - 1) && (
          <text key={`t${i}`} x={x(i)} y={H - 6} fontSize="10" fill="#7A8693" textAnchor="middle">{l}</text>
        ))}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
      </div>
    </div>
  );
}

/** Round a scale's top value up to a "nice" number (1/2/5 × a power of ten, never below 1) so evenly spaced
 *  ticks land on whole, evenly incremented numbers instead of an arbitrary fraction of the data's max. */
function niceTicks(max: number, targetCount = 4): number[] {
  if (max <= 0) return [0, 1];
  const rawStep = max / targetCount;
  const mag = Math.max(1, Math.pow(10, Math.floor(Math.log10(rawStep))));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let t = 0; t <= hi + step / 2; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

/** One bar per category, each its own color - for a small set of independent totals read by name (the category
 *  label under each bar), not a multi-series comparison. No legend: the x-axis label already names each bar. */
export function CategoryBarChart({ categories, values, colors, yUnit = "", ariaLabel, tooltips }: {
  categories: string[]; values: number[]; colors: string[]; yUnit?: string; ariaLabel: string; tooltips?: ReactNode[];
}) {
  const [active, setActive] = useState<number | null>(null);
  if (categories.length === 0) return <p className="text-sm text-ink-soft">No data yet.</p>;
  const W = 640, H = 230, P = 34, bottomP = 24;
  const max = Math.max(1, ...values);
  const ticks = niceTicks(max);
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => H - bottomP - (v / hi) * (H - P - bottomP);
  const bandW = (W - 2 * P) / categories.length;
  const barW = Math.min(90, bandW * 0.45);
  const desc = categories.map((c, i) => `${c}: ${values[i] ?? 0}${yUnit}`).join(", ");
  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label={`${ariaLabel}: ${desc}`}>
          {ticks.map((t) => <line key={t} x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#D3D9DF" : "#EEF1F0"} strokeDasharray={t === 0 ? undefined : "3 3"} />)}
          {categories.map((c, i) => {
            const bandX = P + i * bandW;
            const v = values[i] ?? 0;
            const barH = Math.max(2, y(0) - y(v));
            const hot = active === i;
            return (
              <g key={c}>
                <rect x={bandX + (bandW - barW) / 2} y={y(0) - barH} width={barW} height={barH} rx={3} fill={colors[i]}
                  fillOpacity={hot ? 1 : 0.92} stroke={hot ? "#111A20" : "none"} strokeWidth={hot ? 1.5 : 0}
                  tabIndex={tooltips ? 0 : undefined} role={tooltips ? "button" : undefined}
                  aria-label={`${c}: ${v}${yUnit}`} style={tooltips ? { cursor: "pointer" } : undefined}
                  onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
                <text x={bandX + bandW / 2} y={H - 6} fontSize="10" fill="#7A8693" textAnchor="middle">{c}</text>
              </g>
            );
          })}
          {ticks.map((t) => <text key={t} x={4} y={y(t) + 4} fontSize="10" fill="#7A8693">{t}{yUnit}</text>)}
        </svg>
      </div>
      {tooltips && active !== null && tooltips[active] && (
        <div className="pointer-events-none absolute z-10 w-max max-w-[280px] rounded-[10px] border border-rule bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((P + active * bandW + bandW / 2) / W) * 100}%`,
            top: `${(y(values[active] ?? 0) / H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}>
          {tooltips[active]}
        </div>
      )}
    </div>
  );
}

/** One bar per category, either several series side by side ("grouped") or stacked into one bar ("stacked"). */
export function GroupedBarChart({ categories, series, mode = "grouped", yUnit = "", ariaLabel }: {
  categories: string[]; series: Series[]; mode?: "grouped" | "stacked"; yUnit?: string; ariaLabel: string;
}) {
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (vals.length === 0) return <p className="text-sm text-ink-soft">No data yet.</p>;
  const W = 640, H = 230, P = 34, bottomP = 24;
  const max = mode === "stacked"
    ? Math.max(1, ...categories.map((_, ci) => series.reduce((n, s) => n + (s.values[ci] ?? 0), 0)))
    : Math.max(1, ...vals);
  const ticks = niceTicks(max);
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => H - bottomP - (v / hi) * (H - P - bottomP);
  const bandW = (W - 2 * P) / categories.length;
  const barGap = 6;
  const desc = categories.map((c, ci) => `${c}: ${series.map((s) => `${s.name} ${s.values[ci] ?? 0}`).join(", ")}`).join("; ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label={`${ariaLabel}: ${desc}`}>
        {ticks.map((t) => <line key={t} x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#D3D9DF" : "#EEF1F0"} strokeDasharray={t === 0 ? undefined : "3 3"} />)}
        {categories.map((c, ci) => {
          const bandX = P + ci * bandW;
          if (mode === "stacked") {
            let acc = 0;
            return (
              <g key={c}>
                {series.map((s) => {
                  const v = s.values[ci] ?? 0;
                  const barW = bandW - barGap * 2;
                  const barH = v === 0 ? 0 : Math.max(2, y(acc) - y(acc + v));
                  const rect = <rect key={s.name} x={bandX + barGap} y={y(acc) - barH} width={barW} height={barH} fill={s.color} />;
                  acc += v;
                  return rect;
                })}
                <text x={bandX + bandW / 2} y={H - 6} fontSize="10" fill="#7A8693" textAnchor="middle">{c}</text>
              </g>
            );
          }
          const barW = (bandW - barGap * 2) / series.length;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const bx = bandX + barGap + si * barW;
                // A zero value still gets a thin baseline sliver, so every category shows the same number of
                // marks in the same place - without it, an empty slot reads as uneven spacing, not a zero.
                const barH = Math.max(2, y(0) - y(v));
                return <rect key={s.name} x={bx} y={y(0) - barH} width={Math.max(0, barW - 2)} height={barH} fill={s.color} />;
              })}
              <text x={bandX + bandW / 2} y={H - 6} fontSize="10" fill="#7A8693" textAnchor="middle">{c}</text>
            </g>
          );
        })}
        {ticks.map((t) => <text key={t} x={4} y={y(t) + 4} fontSize="10" fill="#7A8693">{t}{yUnit}</text>)}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
      </div>
    </div>
  );
}

/** A ring, not a pie — easier to read counts off the legend than off wedge angles. */
export function DonutChart({ segments, ariaLabel, centerLabel, size = 160 }: { segments: { label: string; value: number; color: string }[]; ariaLabel: string; centerLabel?: string; size?: number }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = size * 0.375, stroke = size * 0.1375, c = size / 2, circumference = 2 * Math.PI * r;
  let offset = 0;
  const desc = segments.map((s) => `${s.label}: ${s.value} (${total ? Math.round((s.value / total) * 100) : 0}%)`).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${ariaLabel}: ${desc}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#EEF1F0" strokeWidth={stroke} />
        {total === 0 ? null : segments.filter((s) => s.value > 0).map((s) => {
          const frac = s.value / total;
          const dash = `${frac * circumference} ${circumference}`;
          const el = <circle key={s.label} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={dash} strokeDashoffset={-offset * circumference} transform={`rotate(-90 ${c} ${c})`} />;
          offset += frac;
          return el;
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontSize="20" fontWeight={700} fill="#1C2733">{total}</text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="#7A8693">{centerLabel ?? "total"}</text>
      </svg>
      <ul className="flex flex-col gap-2.5 text-base">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5">
            <i className="inline-block h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-ink-soft">{s.label}</span>
            <span className="text-lg font-semibold tnum">{s.value}</span>
            <span className="text-ink-faint">({total ? Math.round((s.value / total) * 100) : 0}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
