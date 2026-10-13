import { Check, Clock, Eye, RotateCcw, X } from "lucide-react";
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
  awaiting_approval: "bg-signal border-signal text-white station-live",
  waiting: "bg-white border-route text-route",
  recommended: "bg-white border-signal text-signal",
  shadowed: "bg-route-tint border-route border-dashed text-route",
  failed: "bg-stop border-stop text-white",
  compensated: "bg-white border-stop text-stop",
  skipped: "bg-white border-rule border-dashed text-ink-faint",
  not_run: "bg-white border-rule border-dashed text-ink-faint",
  pending: "bg-white border-rule text-ink-faint",
};

const statusWord: Record<string, string> = {
  done: "Done", active: "In progress", awaiting_approval: "Needs approval", waiting: "Waiting on the shop",
  recommended: "Recommended only", shadowed: "Shadow: not executed", failed: "Failed", compensated: "Rolled back", skipped: "Skipped", not_run: "Not reached", pending: "Not yet",
};

function Glyph({ status, compact }: { status: string; compact: boolean }) {
  const cls = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  if (status === "done") return <Check className={cls} strokeWidth={3} aria-hidden />;
  if (status === "failed") return <X className={cls} strokeWidth={3} aria-hidden />;
  if (status === "compensated") return <RotateCcw className={cls} strokeWidth={3} aria-hidden />;
  if (status === "waiting") return <Clock className={cls} strokeWidth={2.5} aria-hidden />;
  if (status === "shadowed") return <Eye className={cls} strokeWidth={2.5} aria-hidden />;
  return null;
}

export default function LineMap({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  const lastReached = steps.reduce((acc, s, i) => (["done", "compensated", "failed", "recommended", "shadowed", "active", "awaiting_approval", "waiting"].includes(s.status) ? i : acc), -1);
  const size = compact ? "h-4 w-4 border-2" : "h-7 w-7 border-[3px]";
  return (
    <ol className="relative flex w-full" aria-label="Workflow progress">
      {steps.map((s, i) => {
        const travelled = i < lastReached;
        return (
          <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" title={`${s.label}: ${statusWord[s.status] ?? s.status}${s.detail ? ` — ${s.detail}` : ""}`}>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-1/2 w-full ${compact ? "top-[7px] h-[3px]" : "top-[12px] h-[5px]"} ${travelled ? "bg-route" : "bg-rule"}`}
              />
            )}
            <span className={`relative z-10 flex items-center justify-center rounded-full ${size} ${stationStyle[s.status] ?? stationStyle.pending}`}>
              <Glyph status={s.status} compact={compact} />
            </span>
            {compact && (
              <span className={`mt-1 hidden truncate px-0.5 text-[10px] leading-tight sm:block ${s.status === "awaiting_approval" ? "font-semibold text-[#8A5900]" : s.status === "pending" || s.status === "not_run" || s.status === "skipped" ? "text-ink-faint" : "text-ink-soft"}`}>
                {s.label}
              </span>
            )}
            {!compact && (
              <span className="mt-2 px-1">
                <span className={`block font-sign text-xs font-bold leading-tight ${s.status === "awaiting_approval" ? "text-[#8A5900]" : ""}`}>{s.label}</span>
                <span className="mt-0.5 block text-2xs text-ink-soft">{statusWord[s.status] ?? s.status}{s.at && s.status !== "pending" ? `, ${time(s.at)}` : ""}</span>
                {s.detail && <span className="mt-0.5 hidden text-2xs leading-snug text-ink-faint md:block">{s.detail}</span>}
              </span>
            )}
            <span className="sr-only">{s.label}: {statusWord[s.status]}</span>
          </li>
        );
      })}
    </ol>
  );
}
