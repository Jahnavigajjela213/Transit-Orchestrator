import { useEffect, useRef, useState } from "react";
import { BusFront, CalendarClock, Check, Database, ExternalLink, HardHat, MessageSquare, Users, Wrench, X } from "lucide-react";
import { api } from "../lib/api";
import { sentence } from "../lib/format";
import type { Delegation, Step } from "../lib/types";
import LineMap from "./LineMap";

export interface AgentInfo {
  key: string; name: string; product: string; role: string; summary: string;
  data: string[]; links: { name: string; url: string }[];
}
export interface PlanStep { step: string; agents: { key: string; task: string }[] }
export interface AgentsResponse { agents: AgentInfo[]; plans: Record<string, PlanStep[]> }

// The agent catalogue does not change while the app runs: fetch it once and share it.
let catalogue: Promise<AgentsResponse> | null = null;
export const loadCatalogue = () => (catalogue ??= api.get<AgentsResponse>("/api/agents").catch((e) => { catalogue = null; throw e; }));

const agentIcon: Record<string, any> = { asset: Wrench, trip: CalendarClock, workforce: Users, safety: HardHat, rider_comms: MessageSquare };
const agentTone: Record<string, string> = {
  asset: "bg-[#FFF4E5] text-[#9A5B00]", trip: "bg-route-tint text-route-dark", workforce: "bg-[#EEF2FF] text-[#3B4CB8]",
  safety: "bg-stop-tint text-stop", rider_comms: "bg-[#F3E8FF] text-[#7A3DB8]",
};

/**
 * The seven-step line where each step that domain agents work on can be clicked: a popup shows each agent, what it does on that
 * step, which product and data it works from, and links to the product. With `delegations` (the orchestration page) it also
 * shows what each agent actually ran.
 */
export default function AgentFlow({ steps, medium = false, delegations, workflowType = "vehicle_health" }: {
  steps: Step[]; medium?: boolean; delegations?: Delegation[]; workflowType?: string;
}) {
  const [cat, setCat] = useState<AgentsResponse | null>(null);
  const [open, setOpen] = useState<{ step: Step; rect: DOMRect } | null>(null);
  useEffect(() => { loadCatalogue().then(setCat).catch(() => {}); }, []);

  const plan = cat?.plans[workflowType] ?? [];
  const count = Object.fromEntries(plan.map((p) => [p.step, p.agents.length]));
  return (
    <>
      <LineMap steps={steps} medium={medium} agentCount={count} onStepClick={(step, el) => setOpen({ step, rect: el.getBoundingClientRect() })} />
      {open && cat && (
        <Popover rect={open.rect} onClose={() => setOpen(null)}>
          <StepAgents step={open.step} index={steps.findIndex((s) => s.key === open.step.key)} total={steps.length}
            plan={plan.find((p) => p.step === open.step.key)} agents={cat.agents} delegations={delegations} onClose={() => setOpen(null)} />
        </Popover>
      )}
    </>
  );
}

const WIDTH = 400;

function Popover({ rect, onClose, children }: { rect: DOMRect; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };  // it is anchored to the station
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 12);
  const spaceBelow = window.innerHeight - rect.bottom - 22, spaceAbove = rect.top - 22;
  const below = spaceAbove < 220 && spaceBelow > spaceAbove;  // opens above the station unless there is no room there
  // never taller than the room on that side: the agent list scrolls inside
  const style = below ? { left, top: rect.bottom + 10, maxHeight: spaceBelow } : { left, bottom: window.innerHeight - rect.top + 10, maxHeight: spaceAbove };
  const arrow = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 6), WIDTH - 28);
  return (
    <div ref={ref} role="dialog" aria-label="Agents on this step" style={{ ...style, width: WIDTH }}
      className="fixed z-50 flex flex-col rounded-xl border border-rule bg-white shadow-[0_16px_48px_-12px_rgba(16,24,40,0.35)]">
      <span className={`absolute h-3 w-3 rotate-45 border-rule bg-white ${below ? "-top-1.5 border-l border-t" : "-bottom-1.5 border-b border-r"}`} style={{ left: arrow }} aria-hidden />
      {children}
    </div>
  );
}

function StepAgents({ step, index, total, plan, agents, delegations, onClose }: {
  step: Step; index: number; total: number; plan?: PlanStep; agents: AgentInfo[]; delegations?: Delegation[]; onClose: () => void;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">Step {index + 1} of {total}</div>
          <div className="text-sm font-semibold">{step.label}</div>
          <div className="mt-0.5 text-xs text-ink-soft">{plan?.agents.length ?? 0} agent{plan?.agents.length === 1 ? "" : "s"} work on this step for the supervisor</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto rounded-b-xl">
        {(plan?.agents ?? []).map((pa) => {
          const a = agents.find((x) => x.key === pa.key);
          if (!a) return null;
          const Icon = agentIcon[a.key] ?? BusFront;
          const ran = (delegations || []).filter((d) => d.step === step.key && d.key === a.key);
          const failed = ran.some((d) => d.status === "failed");
          return (
            <li key={a.key + pa.task} className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${agentTone[a.key] ?? "bg-paper text-ink-soft"}`}><Icon className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold">{a.name}</span>
                    <span className="text-xs text-ink-soft">{a.role}</span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium leading-snug">{pa.task}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{a.summary}</p>

                  <div className="mt-2.5 rounded-lg bg-paper px-3 py-2">
                    <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint"><Database className="h-3 w-3" aria-hidden />Works from</div>
                    <div className="mt-1 text-xs font-medium">{a.product}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.data.map((t) => <code key={t} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft ring-1 ring-rule">{t}</code>)}
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {a.links.map((l) => (
                      <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-route hover:underline">
                        {l.name} <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ))}
                    {delegations && (ran.length > 0 ? (
                      <span className={`ml-auto inline-flex items-center gap-1 text-2xs font-semibold ${failed ? "text-stop" : "text-go"}`}
                        title={step.status === "pending" ? "Looked ahead while assessing, to prepare this step's proposal before it actually runs." : undefined}>
                        {failed ? <X className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                        {failed ? "Failed" : `${step.status === "pending" ? "Consulted early" : "Ran"} ${ran.length} task${ran.length === 1 ? "" : "s"}`} · {ran.reduce((n, d) => n + d.duration_ms, 0)} ms
                      </span>
                    ) : <span className="ml-auto text-2xs text-ink-faint">Not run yet</span>)}
                  </div>
                  {failed && <p className="mt-1 text-2xs text-stop">{ran.find((d) => d.error)?.error}</p>}
                  {ran.length > 0 && !failed && (
                    <p className="mt-1 text-2xs text-ink-faint">{[...new Set(ran.map((d) => sentence(d.task)))].join(" · ")}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
