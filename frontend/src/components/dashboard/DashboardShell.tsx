import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Sparkline } from "./charts";

const TILE_ICON_TONE: Record<"good" | "warn" | "bad" | "default", string> = {
  good: "bg-go-tint text-go", warn: "bg-signal-tint text-signal-ink", bad: "bg-stop-tint text-stop", default: "bg-route-tint text-route",
};

const DOT: Record<"stop" | "signal" | "go" | "route", string> = { stop: "bg-stop", signal: "bg-signal", go: "bg-go", route: "bg-route" };

export function DashboardHeader({ eyebrow, title, readOnly, actions }: { eyebrow?: string; title?: string; readOnly?: boolean; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-end gap-4">
      {(eyebrow || title) && (
        <div className="min-w-[280px] flex-1">
          {eyebrow && <p className="m-0 text-xs text-ink-faint">{eyebrow}</p>}
          {title && (
            <h1 className={`${eyebrow ? "mt-1" : ""} flex flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-[-0.01em]`}>
              {title}
              {readOnly && <span className="pill bg-[#EEF1F0] text-ink-soft">Read-only</span>}
            </h1>
          )}
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function PeriodSwitch({ value, onChange }: { value: number | null; onChange: (d: number | null) => void }) {
  const PERIODS: [number | null, string][] = [[7, "7 days"], [28, "28 days"], [null, "Pilot to date"]];
  return (
    <div role="tablist" aria-label="Period" className="flex rounded-[10px] border border-rule bg-white p-[3px]">
      {PERIODS.map(([d, label]) => (
        <button key={label} type="button" role="tab" aria-selected={value === d} onClick={() => onChange(d)}
          className={`h-8 rounded-[7px] px-3.5 text-xs ${value === d ? "bg-ink font-semibold text-white" : "text-ink-soft hover:text-ink"}`}>{label}</button>
      ))}
    </div>
  );
}

/** One sentence of what needs this person now, built deterministically from the data — no LLM call. */
export function Briefing({ tone, text, action }: { tone: "stop" | "signal" | "go" | "route"; text: ReactNode; action?: { label: string; onClick: () => void; quiet?: boolean } }) {
  return (
    <section className="card flex flex-wrap items-center gap-3.5 px-5 py-4">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      <p className="min-w-[240px] flex-1 text-[14.5px] leading-snug">{text}</p>
      {action && (
        <button type="button" onClick={action.onClick}
          className={action.quiet ? "btn-lg h-10 border border-rule bg-white px-4 text-[13px]" : "btn-lg h-10 bg-route px-4 text-[13px] font-semibold text-white hover:bg-route-dark"}>
          {action.label}
        </button>
      )}
    </section>
  );
}

export function StatTile({ label, value, sub, tone, icon: Icon, sparkline, onClick, ariaLabel }: {
  label: string; value: ReactNode; sub?: string; tone?: "good" | "warn" | "bad"; icon?: LucideIcon; sparkline?: (number | null)[]; onClick?: () => void; ariaLabel?: string;
}) {
  const color = tone === "bad" ? "text-stop" : tone === "warn" ? "text-signal-ink" : tone === "good" ? "text-go" : "";
  const body = (
    <div className="flex items-start gap-3">
      {Icon && <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${TILE_ICON_TONE[tone ?? "default"]}`}><Icon className="h-5 w-5" aria-hidden /></span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="block text-[12px] font-medium text-ink">{label}</span>
          {onClick && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}
        </div>
        <div className={`mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.01em] tnum ${color}`}>{value}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          {sub ? <span className="min-w-0 truncate text-xs text-ink-faint">{sub}</span> : <span />}
          {sparkline && sparkline.filter((v) => v !== null).length >= 3 && <Sparkline values={sparkline} tone={tone === "bad" ? "stop" : tone === "warn" ? "signal" : "route"} ariaLabel={label} />}
        </div>
      </div>
    </div>
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={ariaLabel ?? `${label}: ${value}. Open details.`} className="card px-3.5 py-2.5 text-left transition hover:border-route/40 hover:shadow-sm">{body}</button>
  ) : (
    <div className="card px-3.5 py-2.5">{body}</div>
  );
}

/** A real bordered button with a trailing arrow - the "see more" action every dashboard section ends with. */
export function ViewAllButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn-quiet inline-flex h-8 shrink-0 items-center gap-1 px-3 text-[12.5px]">
      View all<ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** The "go look at this" action - a record that's already in view, not waiting on a decision. */
export function OpenButton({ onClick, label = "Open" }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="h-8 shrink-0 rounded-[10px] bg-go-tint px-3 text-[12.5px] font-semibold text-go hover:bg-go-tint/70">{label}</button>;
}

/** The "a person needs to decide" action - filled in the same amber used for a pending/needs-approval state,
 *  so it reads as distinctly more urgent than the neutral Open button next to it. */
export function ReviewButton({ onClick, label = "Review" }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="h-8 shrink-0 rounded-[10px] bg-signal px-3 text-[12.5px] font-semibold text-white hover:bg-signal/90">{label}</button>;
}

export function StatTileRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function FocusGrid({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1080px]:grid-cols-[1.25fr_1fr]">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
}

export interface LauncherCard { key: string; title: string; icon: LucideIcon; hint?: string; count?: number | string; moduleLabel?: string; moduleIcon?: LucideIcon }

export function MoreViews({ cards, onOpen }: { cards: LauncherCard[]; onOpen: (key: string) => void }) {
  return (
    <section>
      <h2 className="text-sm font-semibold">More views</h2>
      <p className="mt-0.5 text-xs text-ink-soft">Everything you can open. Each one opens in a side panel.</p>
      <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
        {cards.map((c) => (
          <button key={c.key} type="button" onClick={() => onOpen(c.key)}
            aria-label={`${c.title}${c.hint ? `, ${c.hint}` : ""}. Open in a panel.`}
            className="card flex flex-col gap-2.5 px-4 py-3.5 text-left transition hover:border-route/40 hover:shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-route-tint text-route"><c.icon className="h-4 w-4" aria-hidden /></span>
              {c.count !== undefined && <span className="text-sm font-semibold tnum">{c.count}</span>}
            </div>
            <div>
              <div className="text-[13.5px] font-semibold">{c.title}</div>
              {c.hint && <div className="mt-0.5 truncate text-xs text-ink-soft">{c.hint}</div>}
            </div>
            {c.moduleLabel && c.moduleIcon && (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[#EEF1F0] px-2 py-0.5 text-[10.5px] text-ink-soft">
                <c.moduleIcon className="h-3 w-3" aria-hidden /> {c.moduleLabel}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
