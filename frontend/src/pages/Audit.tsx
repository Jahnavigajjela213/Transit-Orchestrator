import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { dayTime, seconds, sentence, words } from "../lib/format";
import type { AuditRecord } from "../lib/types";
import { Drawer, Head } from "../components/focus";
import { ErrorNote, Json, LevelTag, Loading, Tag } from "../components/ui";
import { storyText } from "./WorkflowDetail";

/* Audit log: every event, decision, approval and action, as the decision record the proposal describes (§4.2).
   Mirrors the Delta table in Databricks. */

const types = ["", "event_received", "assessment", "decision", "approval_requested", "human_action", "action_executed", "action_failed",
  "compensation", "workflow_status", "policy_change", "assistant_answer"];
const WHO: [string, string][] = [["", "Everyone"], ["agent", "Agent"], ["human", "People"], ["product", "Products"], ["system", "System"]];
const dot: Record<string, string> = { human: "bg-signal", agent: "bg-route", product: "bg-[#9AA3AD]", system: "bg-[#CDD2D8]" };

export default function Audit() {
  const [type, setType] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AuditRecord | null>(null);
  const qs = new URLSearchParams({ limit: "300", ...(type && { record_type: type }), ...(actor && { actor_type: actor }), ...(q && { q }) }).toString();
  const { data, error } = useData<AuditRecord[]>(`/api/audit?${qs}`, [qs]);

  return (
    <>
      <Head title="Audit log" intro="Every event, decision, approval and action, with the triggering event, data considered, model used, recommendation, human action and outcome. Written to the Delta table in Databricks."
        actions={<>
          <button className="btn-quiet" onClick={() => api.download("/api/audit/export?format=csv", "audit_log.csv")}><Download className="h-4 w-4" aria-hidden /> CSV</button>
          <button className="btn-quiet" onClick={() => api.download("/api/audit/export?format=jsonl", "audit_log.jsonl")}><Download className="h-4 w-4" aria-hidden /> JSONL</button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="seg" role="group" aria-label="Who">
          {WHO.map(([k, l]) => <button key={k} aria-pressed={actor === k} onClick={() => setActor(k)}>{l}</button>)}
        </div>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Record type">
          {types.map((t) => <option key={t} value={t}>{t ? sentence(t) : "All record types"}</option>)}
        </select>
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input className="input pl-9" placeholder="Search explanations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit log" />
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : (
        <div className="overflow-x-auto rounded-[14px] border border-rule">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Explanation</th><th>Step</th><th>Orchestration</th></tr></thead>
            <tbody>
              {data.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-ink-faint">No records match.</td></tr> : data.map((r) => (
                <tr key={r.id} tabIndex={0} className="cursor-pointer hover:bg-[#FAFBFB] focus-visible:bg-[#FAFBFB]" onClick={() => setOpen(r)} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                  <td className="whitespace-nowrap font-mono text-[13px] text-ink-faint">{new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })} {seconds(r.created_at)}</td>
                  <td className="whitespace-nowrap"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${dot[r.actor_type] ?? "bg-[#CDD2D8]"}`} aria-hidden />{r.actor}</td>
                  <td className="max-w-xl">{storyText(r)}{r.human_action && <span className="ml-2"><Tag color="amber">{r.human_action}</Tag></span>}</td>
                  <td className="whitespace-nowrap text-[13px] text-ink-faint">{words(r.step)}</td>
                  <td className="whitespace-nowrap">{r.workflow_id && <Link onClick={(e) => e.stopPropagation()} to={`/workflows/${r.workflow_id}`} className="text-[13px] text-route hover:underline">Open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Drawer title={sentence(open.record_type)} subtitle={`${open.actor} · ${dayTime(open.created_at)}`} onClose={() => setOpen(null)}>
          <p className="text-[15px] leading-relaxed">{storyText(open)}</p>
          <div className="flex flex-wrap gap-2">{open.step && <Tag>{words(open.step)}</Tag>}<LevelTag level={open.autonomy_level} />{open.model_used && <Tag>{open.model_used}</Tag>}</div>
          {open.workflow_id && <Link to={`/workflows/${open.workflow_id}`} className="text-sm font-medium text-route hover:underline">Open the orchestration</Link>}
          <Json value={open} />
        </Drawer>
      )}
    </>
  );
}
