import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, X } from "lucide-react";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { dayTime, seconds, sentence, words } from "../lib/format";
import type { AuditRecord } from "../lib/types";
import { Empty, ErrorNote, Json, Loading, PageHeader, VehicleId } from "../components/ui";

const ACTORS: [string, string][] = [["", "Everyone"], ["agent", "Agents"], ["human", "People"], ["product", "Products"]];
const ACTOR_TONE: Record<string, string> = {
  agent: "bg-route-tint text-route-dark", human: "bg-signal-tint text-signal-ink", product: "bg-[#EEF1F0] text-ink-soft", system: "bg-[#EEF1F0] text-ink-soft",
};
const has = (v: unknown) => v !== null && v !== undefined && v !== "" && !(typeof v === "object" && Object.keys(v as object).length === 0);

export default function Audit() {
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const qs = new URLSearchParams({ limit: "300", ...(actor && { actor_type: actor }), ...(q && { q }) }).toString();
  const { data, error } = useData<AuditRecord[]>(`/api/audit?${qs}`, [qs]);
  const { data: wfs } = useData<{ id: string; vehicle_label: string | null; title: string }[]>("/api/workflows?limit=200");
  const { data: m } = useData<{ measures: { audit_complete_pct: number | null } }>("/api/metrics/summary");
  const complete = m?.measures?.audit_complete_pct;

  const byWf = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w])), [wfs]);
  // records arrive newest first; keep that order for the groups and oldest-first inside each one, like a trail
  const groups = useMemo(() => {
    const out: { id: string; records: AuditRecord[] }[] = [];
    const idx: Record<string, number> = {};
    for (const r of data || []) {
      const k = r.workflow_id ?? "_none";
      if (idx[k] === undefined) { idx[k] = out.length; out.push({ id: k, records: [] }); }
      out[idx[k]].records.push(r);
    }
    out.forEach((g) => g.records.reverse());
    return out;
  }, [data]);
  const rec = (data || []).find((r) => r.id === picked) ?? null;

  return (
    <div className="-my-[26px] flex min-h-[calc(100vh)] gap-0 lg:-mr-8">
      <div className="flex min-w-0 flex-1 flex-col gap-4 py-[26px] lg:pr-8">
        <PageHeader title="Audit log" eyebrow="Governance · mirrored to Databricks (Delta)"
          intro="Every event, decision, approval and action, with the evidence behind it."
          actions={<button className="btn-lg h-10 border border-rule bg-white px-3.5 text-[13px]" onClick={() => api.download("/api/audit/export?format=jsonl", "audit_log.jsonl")}>
            <Download className="h-4 w-4" aria-hidden /> Export JSONL</button>} />

        <div className="flex flex-wrap items-center gap-1.5">
          {ACTORS.map(([v, l]) => (
            <button key={l} onClick={() => setActor(v)} className={`h-[34px] rounded-full px-3.5 text-[12.5px] ${actor === v ? "bg-ink text-white" : "border border-rule bg-white text-ink-soft"}`}>{l}</button>
          ))}
          <label className="ml-2">
            <span className="sr-only">Search explanations</span>
            <input className="input h-[34px] w-60 rounded-full" placeholder="Search explanations" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <span className="flex-1" />
          {complete != null && <span className="text-xs text-ink-faint">{complete}% of decisions have a complete record</span>}
        </div>

        {error && <ErrorNote message={error} />}
        {!data ? <div className="card"><Loading /></div> : groups.length === 0 ? <div className="card"><Empty title="No records match" /></div> : groups.map((g) => {
          const wf = byWf[g.id];
          const open = !closed[g.id];
          return (
            <section key={g.id} className="card overflow-hidden">
              <button type="button" onClick={() => setClosed({ ...closed, [g.id]: open })} aria-expanded={open}
                className="flex w-full items-center gap-2.5 bg-panel px-[18px] py-3.5 text-left">
                {wf ? <VehicleId label={wf.vehicle_label} /> : null}
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {wf ? wf.title.replace(`${wf.vehicle_label}: `, "") : g.id === "_none" ? "Not tied to an orchestration (policy changes, assistant, system)" : `Orchestration ${g.id}`}
                </span>
                {wf && <Link to={`/workflows/${g.id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium">Open</Link>}
                <span className="text-xs text-ink-soft">{g.records.length} records</span>
                <span className="text-ink-faint">{open ? "▴" : "▾"}</span>
              </button>
              {open && g.records.map((r) => (
                <button key={r.id} type="button" onClick={() => setPicked(r.id)}
                  className={`grid w-full grid-cols-[80px_160px_250px_minmax(0,1fr)] items-center gap-3.5 border-t border-rule-soft px-[18px] py-3 text-left ${picked === r.id ? "bg-[#F1F7F6]" : "bg-white hover:bg-panel"}`}>
                  <span className="font-mono text-xs text-ink-faint">{seconds(r.created_at)}</span>
                  <span className={`pill justify-self-start text-[11.5px] ${ACTOR_TONE[r.actor_type] ?? ACTOR_TONE.system}`}>{r.actor}</span>
                  <span className="truncate font-semibold">{sentence(r.record_type)}{r.step ? <span className="font-normal text-ink-faint"> · {words(r.step)}</span> : null}</span>
                  <span className="truncate text-ink-soft">{r.explanation}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {rec && (
        <aside aria-label="Record" className="sticky top-0 flex h-screen w-[380px] shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-rule bg-white p-[22px]">
          <div className="flex items-start">
            <div className="flex-1">
              <div className="eyebrow">{dayTime(rec.created_at)} · {rec.actor}</div>
              <h2 className="mt-1 text-[17px] font-semibold">{sentence(rec.record_type)}{rec.step ? ` · ${words(rec.step)}` : ""}</h2>
            </div>
            <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-rule-soft text-ink-soft"><X className="h-4 w-4" /></button>
          </div>
          {rec.explanation && <p className="text-[13.5px] leading-relaxed">{rec.explanation}</p>}
          <dl className="flex flex-col gap-2.5">
            {([
              ["Triggering event", rec.triggering_event_id ? `${rec.triggering_event_id}${rec.trace_id ? ` · trace ${rec.trace_id.slice(0, 12)}…` : ""}` : "—", true],
              ["Data considered", rec.data_considered, false],
              ["Model used", rec.model_used || "—", false],
              ["Recommendation", rec.recommendation, false],
              ["Human action", rec.human_action || "—", false],
              ["Outcome", rec.outcome || "—", true],
            ] as [string, unknown, boolean][]).map(([k, v, mono]) => (
              <div key={k} className="rounded-[10px] border border-rule px-3 py-2.5">
                <dt className="eyebrow">{k}</dt>
                <dd className={`mt-1 text-[13px] ${mono ? "font-mono" : ""}`}>
                  {typeof v === "object" ? (has(v) ? <Json value={v} /> : "—") : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
}
