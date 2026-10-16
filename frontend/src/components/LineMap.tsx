import { AlertTriangle, Check, Eye, RotateCcw, X } from "lucide-react";
import type { Step } from "../lib/types";
import { time } from "../lib/format";

/**
 * The workflow drawn as a transit line: seven stations from Detect to Return to service.
 * Filled stations are done, the amber pulsing station is waiting on a person,
 * red marks a failure or a rollback, hollow grey stations were skipped or not reached.
 */
const stationStyle: Record<string, string> = {
  done: "bg-route border-route text-white",
  active: "bg-white border-route text-route",
  awaiting_approval: "bg-white border-signal text-signal station-live",
  waiting: "bg-white border-shop text-shop shadow-[0_0_0_5px_rgba(47,111,179,0.14)]",
  recommended: "bg-white border-signal text-signal",
  shadowed: "bg-route-tint border-route border-dashed text-route",
  failed: "bg-stop border-stop text-white",
  escalated: "bg-stop border-stop text-white shadow-[0_0_0_5px_rgba(196,50,31,0.14)]",
  compensated: "bg-white border-stop text-stop",
  skipped: "bg-white border-[#CDD2D8] border-dashed text-ink-faint",
  not_run: "bg-white border-[#CDD2D8] border-dashed text-ink-faint",
  pending: "bg-white border-[#CDD2D8] text-ink-faint",
};

const statusWord: Record<string, string> = {
  done: "Done", active: "In progress", awaiting_approval: "Needs approval", waiting: "Waiting on the shop",
  recommended: "Recommended only", escalated: "Raised with dispatcher", shadowed: "Shadow: not executed", failed: "Failed", compensated: "Rolled back", skipped: "Skipped", not_run: "Not reached", pending: "Not yet",
};

function Glyph({ status, compact }: { status: string; compact: boolean }) {
  if (compact) return null;
  const cls = "h-3 w-3";
  if (status === "done") return <Check className={cls} strokeWidth={3} aria-hidden />;
  if (status === "failed") return <X className={cls} strokeWidth={3} aria-hidden />;
  if (status === "escalated") return <AlertTriangle className={cls} strokeWidth={2.5} aria-hidden />;
  if (status === "compensated") return <RotateCcw className={cls} strokeWidth={3} aria-hidden />;
  if (status === "shadowed") return <Eye className={cls} strokeWidth={2.5} aria-hidden />;
  return null;
}

/** `medium`: the size used inside decision cards, with each step's name and a short state under it. */
/** `onStepClick` + `agentCount`: stations with agents become buttons (with a small count badge) that open the step's agents. */
export default function LineMap({ steps, compact = false, labels = true, medium = false, onStepClick, agentCount }: {
  steps: Step[]; compact?: boolean; labels?: boolean; medium?: boolean;
  onStepClick?: (step: Step, el: HTMLElement) => void; agentCount?: Record<string, number>;
}) {
  const lastReached = steps.reduce((acc, s, i) => (["done", "compensated", "failed", "escalated", "recommended", "shadowed", "active", "awaiting_approval", "waiting"].includes(s.status) ? i : acc), -1);
  const ring = (st: string) => ["awaiting_approval", "waiting"].includes(st) ? (compact ? "border-[3px]" : medium ? "border-4" : "border-[5px]") : "";
  const size = compact ? "h-3 w-3 border-2" : medium ? "h-5 w-5 border-2" : "h-[22px] w-[22px] border-2";
  return (
    <ol className="relative flex w-full" aria-label="Workflow progress">
      {steps.map((s, i) => {
        const travelled = i < lastReached;
        return (
          <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" title={`${s.label}: ${statusWord[s.status] ?? s.status}${s.detail ? ` — ${s.detail}` : ""}`}>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-1/2 w-full ${compact ? "top-[5px] h-[2px]" : medium ? "top-[9px] h-[2px]" : "top-[10px] h-[3px]"} ${travelled ? "bg-route" : "bg-[#E1E4E8]"}`}
              />
            )}
            {onStepClick && agentCount?.[s.key] ? (
              <button type="button" onClick={(e) => onStepClick(s, e.currentTarget)} aria-label={`${s.label}: see the ${agentCount[s.key]} agent(s) on this step`}
                className={`group/station relative z-10 flex items-center justify-center rounded-full ring-route/30 transition hover:scale-110 hover:ring-4 focus-visible:ring-4 ${size} ${ring(s.status)} ${stationStyle[s.status] ?? stationStyle.pending}`}>
                <Glyph status={s.status} compact={compact || medium} />
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-ink px-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white" aria-hidden>
                  {agentCount[s.key]}
                </span>
              </button>
            ) : (
              <span className={`relative z-10 flex items-center justify-center rounded-full ${size} ${ring(s.status)} ${stationStyle[s.status] ?? stationStyle.pending}`}>
                <Glyph status={s.status} compact={compact || medium} />
              </span>
            )}
            {compact && labels && (
              <span className={`mt-1 hidden truncate px-0.5 text-[10px] leading-tight sm:block ${s.status === "awaiting_approval" ? "font-semibold text-[#8A5900]" : s.status === "pending" || s.status === "not_run" || s.status === "skipped" ? "text-ink-faint" : "text-ink-soft"}`}>
                {s.label}
              </span>
            )}
            {medium && (
              <span className="mt-2 px-1">
                <span className={`block text-[11.5px] font-semibold leading-tight ${s.status === "awaiting_approval" ? "text-[#8A5900]" : s.status === "escalated" ? "text-stop" : ["pending", "not_run", "skipped"].includes(s.status) ? "text-ink-faint" : "text-ink"}`}>{s.label}</span>
                <span className="mt-0.5 hidden text-[10.5px] text-ink-faint sm:block">
                  {s.status === "awaiting_approval" ? "Your decision" : `${statusWord[s.status] ?? s.status}${s.at && ["done", "escalated"].includes(s.status) ? ` · ${time(s.at)}` : ""}`}
                </span>
              </span>
            )}
            {!compact && !medium && (
              <span className="mt-2.5 px-1">
                <span className={`block text-sm font-medium leading-tight ${s.status === "awaiting_approval" ? "font-semibold text-[#8A5A00]" : s.status === "waiting" ? "font-semibold text-[#22578F]" : s.status === "escalated" || s.status === "failed" ? "font-semibold text-[#A12A1A]" : ["pending", "not_run", "skipped"].includes(s.status) ? "text-ink-faint" : ""}`}>{s.label}</span>
                <span className="mt-1 block font-mono text-xs text-ink-faint">{s.status === "awaiting_approval" ? "needs approval" : s.status === "waiting" ? "in the shop" : s.status === "escalated" ? "escalated" : s.at && s.status !== "pending" ? time(s.at) : "\u00a0"}</span>
              </span>
            )}
            <span className="sr-only">{s.label}: {statusWord[s.status]}</span>
          </li>
        );
      })}
    </ol>
  );
}
