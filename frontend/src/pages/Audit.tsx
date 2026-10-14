import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { seconds, sentence, words } from "../lib/format";
import type { AuditRecord } from "../lib/types";
import { Empty, ErrorNote, Json, LevelTag, Loading, PageHeader, Tag } from "../components/ui";

const types = ["", "event_received", "assessment", "decision", "approval_requested", "human_action", "action_executed", "action_failed",
  "compensation", "workflow_status", "policy_change", "assistant_answer"];

export default function Audit() {
  const [type, setType] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ limit: "300", ...(type && { record_type: type }), ...(actor && { actor_type: actor }), ...(q && { q }) }).toString();
  const { data, error } = useData<AuditRecord[]>(`/api/audit?${qs}`, [qs]);

  return (
    <div className="fit-page">
      <PageHeader title="Audit log" intro="Every event, decision, approval and action, with the data considered, the model used and the outcome. Mirrors the Delta table planned for Databricks."
        actions={<>
          <button className="btn-quiet" onClick={() => api.download("/api/audit/export?format=csv", "audit_log.csv")}><Download className="h-4 w-4" aria-hidden /> CSV</button>
          <button className="btn-quiet" onClick={() => api.download("/api/audit/export?format=jsonl", "audit_log.jsonl")}><Download className="h-4 w-4" aria-hidden /> JSONL</button>
        </>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[200px_160px_1fr]">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Record type">
          {types.map((t) => <option key={t} value={t}>{t ? sentence(t) : "All record types"}</option>)}
        </select>
        <select className="input" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor">
          <option value="">Anyone</option><option value="agent">Agent</option><option value="human">People</option><option value="product">Products</option><option value="system">System</option>
        </select>
        <input className="input" placeholder="Search explanations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.length === 0 ? <div className="panel"><Empty title="No records match" /></div> : (
        <div className="panel fit-scroll">
          <table className="table">
            <thead><tr><th>Time</th><th>Record</th><th>Actor</th><th>Step</th><th>Explanation</th><th>Workflow</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-paper/60" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="whitespace-nowrap text-xs tnum">{new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })} {seconds(r.created_at)}</td>
                    <td className="whitespace-nowrap">{sentence(r.record_type)}{r.human_action && <div><Tag color="amber">{r.human_action}</Tag></div>}</td>
                    <td className="text-xs">{r.actor}<div className="text-ink-faint">{r.actor_type}</div></td>
                    <td className="text-xs">{words(r.step)} <LevelTag level={r.autonomy_level} /></td>
                    <td className="max-w-xl text-sm">{r.explanation}</td>
                    <td>{r.workflow_id && <Link onClick={(e) => e.stopPropagation()} to={`/workflows/${r.workflow_id}`} className="text-xs text-route hover:underline">Open</Link>}</td>
                  </tr>
                  {open === r.id && <tr><td colSpan={6} className="bg-paper/50"><Json value={r} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
