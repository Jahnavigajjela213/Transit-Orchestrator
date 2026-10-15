import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { sentence } from "../lib/format";

const tone: Record<string, string> = {
  teal: "bg-route-tint text-route-dark",
  amber: "bg-signal-tint text-[#8A5900]",
  red: "bg-stop-tint text-stop",
  green: "bg-go-tint text-go",
  grey: "bg-paper text-ink-soft border border-rule",
};

export function Tag({ children, color = "grey", title }: { children: ReactNode; color?: keyof typeof tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ${tone[color]}`}>
      {children}
    </span>
  );
}

const statusColor: Record<string, keyof typeof tone> = {
  running: "teal", awaiting_approval: "amber", awaiting_event: "teal", completed: "green", completed_with_issues: "amber",
  rejected: "grey", compensated: "red", failed: "red", informational: "grey",
  pending: "amber", approved: "green", overridden: "teal", acknowledged: "grey", cancelled: "grey",
  processed: "green", received: "teal", duplicate: "grey", ignored: "grey",
  open: "amber", in_progress: "teal", closed: "green", scheduled: "grey",
  available: "green", unavailable: "red", out_of_service: "red", sent: "green",
  shadow: "teal", stale: "grey", matched: "green", differed: "amber", no_action: "grey", passed: "green", error: "red",
  compliant: "green", suspended: "red", not_compliant: "red", restricted: "amber",
};

const statusText: Record<string, string> = {
  awaiting_approval: "Needs approval", awaiting_event: "In the shop", completed_with_issues: "Completed with issues",
  shadow: "Shadow run", stale: "Stale, not acted on", no_action: "No action taken", restricted: "No wheelchair runs",
};

export function StatusBadge({ status }: { status: string }) {
  return <Tag color={statusColor[status] ?? "grey"}>{statusText[status] ?? sentence(status)}</Tag>;
}

const sevColor: Record<string, keyof typeof tone> = { critical: "red", high: "amber", medium: "teal", low: "grey" };
export function SeverityTag({ severity }: { severity: string | null }) {
  if (!severity) return null;
  return <Tag color={sevColor[severity] ?? "grey"}>{sentence(severity)}</Tag>;
}

const levelText: Record<string, string> = { autonomous: "Agent acts", semi_autonomous: "Needs approval", informational: "Recommend only", shadow: "Shadow" };
export function LevelTag({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  return <Tag color={level === "autonomous" ? "teal" : level === "semi_autonomous" ? "amber" : "grey"}>{levelText[level] ?? level}</Tag>;
}

export function VehicleId({ label, size = "md" }: { label: string | null; size?: "md" | "lg" }) {
  if (!label) return null;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md bg-ink font-semibold tracking-wide text-white tnum ${size === "lg" ? "px-2.5 py-1 text-base" : "px-1.5 py-0.5 text-[11px]"}`}>
      {label}
    </span>
  );
}

export function PageHeader({ title, intro, actions, eyebrow, badge }: { title: string; intro?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-1 text-xs font-medium text-ink-faint">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
          {badge}
        </div>
        {intro && <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, aside, children, className = "", subtitle }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; subtitle?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-soft">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-sm border border-stop/30 bg-stop-tint px-3 py-2 text-sm text-stop">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {message}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function KeyVal({ items, dense = false }: { items: [string, ReactNode][]; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-[max-content_1fr] ${dense ? "gap-x-5 gap-y-1.5 text-[13px]" : "gap-x-6 gap-y-2.5 text-sm"}`}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-sm bg-paper p-3 text-xs leading-relaxed text-ink-soft">{JSON.stringify(value, null, 2)}</pre>
  );
}
