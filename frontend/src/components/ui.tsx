import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import { sentence } from "../lib/format";

/** A plain-white, divider-separated list in place of the browser's own (dark-on-some-systems) <select> popup. */
export function Dropdown({ value, items, onChange, placeholder = "Select…", align = "left", className }: {
  value: string; items: { id: string; label: string }[]; onChange: (v: string) => void; placeholder?: string; align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  const current = items.find((o) => o.id === value)?.label ?? placeholder;
  return (
    <div ref={ref} className={`relative ${className ?? "min-w-0 flex-1"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={items.length === 0}
        className="input flex h-[34px] w-full items-center justify-between gap-2 pr-3 text-left text-[13px] text-ink disabled:opacity-60">
        <span className="truncate">{current}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && items.length > 0 && (
        <div role="listbox" className={`absolute ${align === "right" ? "right-0" : "left-0"} top-[calc(100%+6px)] z-20 max-h-72 w-[320px] max-w-[80vw] overflow-y-auto rounded-[10px] border border-rule bg-white shadow-lg`}>
          {items.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => { onChange(o.id); setOpen(false); }}
              className={`block w-full truncate border-b border-rule-soft px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-panel ${o.id === value ? "font-semibold text-ink" : "text-ink-soft"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const tone: Record<string, string> = {
  teal: "bg-route-tint text-route-dark",
  amber: "bg-signal-tint text-signal-ink",
  red: "bg-stop-tint text-stop",
  green: "bg-go-tint text-go",
  blue: "bg-shop-tint text-shop",
  grey: "bg-[#EEF1F0] text-ink-soft",
};

export function Tag({ children, color = "grey", title }: { children: ReactNode; color?: keyof typeof tone; title?: string }) {
  return <span title={title} className={`pill ${tone[color]}`}>{children}</span>;
}

const statusColor: Record<string, keyof typeof tone> = {
  running: "teal", awaiting_approval: "amber", awaiting_event: "blue", completed: "green", completed_with_issues: "red",
  rejected: "grey", compensated: "red", failed: "red", informational: "grey",
  pending: "amber", approved: "green", overridden: "teal", acknowledged: "grey", cancelled: "grey",
  processed: "green", received: "teal", duplicate: "grey", ignored: "grey",
  open: "amber", in_progress: "teal", closed: "green", scheduled: "grey",
  available: "green", unavailable: "red", out_of_service: "red", sent: "green",
  shadow: "teal", stale: "grey", matched: "green", differed: "amber", no_action: "grey", passed: "green", error: "red",
  compliant: "green", suspended: "red", not_compliant: "red", restricted: "amber",
};

const statusText: Record<string, string> = {
  awaiting_approval: "Needs approval", awaiting_event: "In the shop", completed_with_issues: "With issues", running: "Assessing",
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
  return <span className={size === "lg" ? "inline-flex items-center rounded-[7px] bg-ink px-2.5 py-1 font-mono text-[15px] font-medium text-white" : "chip-v"}>{label}</span>;
}

/** The page's name lives in the top bar (Layout); this is the line under it: a short description, a badge, the page's buttons. */
export function PageHeader({ intro, actions, badge }: { title?: string; intro?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; badge?: ReactNode }) {
  if (!intro && !actions && !badge) return null;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        {intro && <p className="text-ink-soft">{intro}</p>}
        {badge}
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
