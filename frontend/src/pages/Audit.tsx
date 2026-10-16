import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { dayTime, seconds, sentence, words } from "../lib/format";
import type { AuditRecord } from "../lib/types";
import { Dropdown, Empty, ErrorNote, Json, Loading, PageHeader } from "../components/ui";

const ACTORS: [string, string][] = [["", "Everyone"], ["agent", "Agents"], ["human", "People"], ["product", "Products"]];
const ACTOR_TONE: Record<string, string> = {
  agent: "bg-route-tint text-route-dark", human: "bg-signal-tint text-signal-ink", product: "bg-[#EEF1F0] text-ink-soft", system: "bg-[#EEF1F0] text-ink-soft",
};
const has = (v: unknown) => v !== null && v !== undefined && v !== "" && !(typeof v === "object" && Object.keys(v as object).length === 0);

interface Wf { id: string; vehicle_label: string | null; title: string; detected_at: string }
const ALL = "_all", NONE = "_none";
const COLS = "grid min-w-[820px] grid-cols-[140px_170px_260px_minmax(0,1fr)] items-center gap-3.5";

export default function Audit() {
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);  // null until the orchestrations load: then the most recent one
  const [picked, setPicked] = useState<string | null>(null);
  const { data: wfs } = useData<Wf[]>("/api/workflows?limit=200");
  useEffect(() => { if (sel === null && wfs) setSel(wfs[0]?.id ?? ALL); }, [wfs, sel]);
  const one = sel && sel !== ALL && sel !== NONE ? sel : null;
  const qs = sel === null ? null : new URLSearchParams({ limit: "300", ...(actor && { actor_type: actor }), ...(q && { q }), ...(one && { workflow_id: one }) }).toString();
  const { data, error } = useData<AuditRecord[]>(qs === null ? null : `/api/audit?${qs}`, [qs]);
  const { data: m } = useData<{ measures: { audit_complete_pct: number | null } }>("/api/metrics/summary");
  const complete = m?.measures?.audit_complete_pct;

  // One entry per orchestration; a vehicle that had more than one gets the detection time so they can be told apart.
  const options = useMemo(() => {
    const per: Record<string, number> = {};
    for (const w of wfs || []) per[w.vehicle_label ?? ""] = (per[w.vehicle_label ?? ""] ?? 0) + 1;
    return (wfs || []).map((w) => ({
      id: w.id,
      label: [w.vehicle_label, w.title.replace(`${w.vehicle_label}: `, ""), per[w.vehicle_label ?? ""] > 1 ? dayTime(w.detected_at) : null].filter(Boolean).join(" · "),
    }));
  }, [wfs]);
  const orchItems = useMemo(() => [{ id: ALL, label: "All orchestrations" }, ...options, { id: NONE, label: "Not tied to an orchestration" }], [options]);
  const rows = useMemo(() => {
    const list = (data || []).filter((r) => sel !== NONE || !r.workflow_id);
    return one ? [...list].reverse() : list;  // one orchestration reads as a trail, oldest first; everything else newest first
  }, [data, sel, one]);
  const rec = rows.find((r) => r.id === picked) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader intro="Every event, decision, approval and action, with the evidence behind it. Mirrored to Databricks (Delta)."
        actions={<button className="btn-lg h-10 bg-route px-3.5 text-[13px] font-semibold text-white hover:bg-route-dark" onClick={() => api.download(`/api/audit/export?format=jsonl${one ? `&workflow_id=${one}` : ""}`, one ? `audit_${one}.jsonl` : "audit_log.jsonl")}>
          <Download className="h-4 w-4" aria-hidden /> Export JSONL</button>} />

      <div className="flex items-start gap-4">
        <section className="card flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* toolbar: search on the left, who acted next, which orchestration on the right */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-4 py-3">
            <label className="relative">
              <span className="sr-only">Search explanations</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
              <input className="input h-[34px] w-52 rounded-[10px] pl-8" placeholder="Search explanations" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {ACTORS.map(([v, l]) => (
              <button key={l} onClick={() => setActor(v)} className={`h-[34px] rounded-[10px] px-3.5 text-[12.5px] ${actor === v ? "bg-ink text-white" : "border border-rule bg-white text-ink-soft"}`}>{l}</button>
            ))}
            <span className="flex-1" />
            <label className="flex min-w-[260px] max-w-full items-center gap-2 text-xs text-ink-soft">
              <span className="shrink-0">Orchestration</span>
              <Dropdown value={sel ?? ALL} items={orchItems} onChange={(v) => { setSel(v); setPicked(null); }} align="right" />
            </label>
            {one && <Link to={`/workflows/${one}`} className="text-xs font-medium">Open</Link>}
          </div>

          {error && <div className="p-4"><ErrorNote message={error} /></div>}
          {!data ? <Loading /> : rows.length === 0 ? <Empty title="No records match" /> : (
            <div className="max-h-[calc(100vh-270px)] min-h-[240px] overflow-auto">
              <div className={`${COLS} eyebrow sticky top-0 z-10 border-b border-rule bg-panel px-[18px] py-2.5`}>
                <span>Time</span><span>Actor</span><span>Record</span><span>Explanation</span>
              </div>
              {rows.map((r) => (
                <button key={r.id} type="button" onClick={() => setPicked(r.id)} aria-pressed={picked === r.id}
                  className={`${COLS} w-full border-b border-rule-soft px-[18px] py-3 text-left ${picked === r.id ? "bg-[#F1F7F6]" : "bg-white hover:bg-panel"}`}>
                  <span className="text-xs text-ink-faint tnum">{one ? seconds(r.created_at) : dayTime(r.created_at)}</span>
                  <span className={`pill justify-self-start text-[11.5px] ${ACTOR_TONE[r.actor_type] ?? ACTOR_TONE.system}`}>{r.actor}</span>
                  <span className="truncate font-semibold">{sentence(r.record_type)}{r.step ? <span className="font-normal text-ink-faint"> · {words(r.step)}</span> : null}</span>
                  <span className="truncate text-ink-soft">{r.explanation}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 border-t border-rule px-[18px] py-2.5 text-xs text-ink-faint">
            <span className="tnum">{rows.length} record{rows.length === 1 ? "" : "s"}{(data?.length ?? 0) >= 300 ? " (latest 300)" : ""}</span>
            <span className="flex-1" />
            {complete != null && <span>{complete}% of decisions have a complete record</span>}
          </div>
        </section>

      {rec && (
        <aside aria-label="Record" className="flex flex-col gap-3.5 overflow-y-auto bg-white p-[22px] max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[420px] max-lg:border-l max-lg:border-rule max-lg:shadow-[-16px_0_40px_-16px_rgba(16,24,40,0.4)] lg:max-h-[calc(100vh-170px)] lg:w-[380px] lg:shrink-0 lg:rounded-[14px] lg:border lg:border-rule">
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
    </div>
  );
}
