import { Link } from "react-router-dom";

export interface Source { audit_id: string; workflow_id: string | null; record_type: string; text: string; score: number }

/** Audit records the assistant retrieved by semantic search (all-MiniLM-L6-v2), best match first. */
export function Sources({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <details className="mt-1.5 text-2xs text-ink-soft">
      <summary className="cursor-pointer">{sources.length > 1 ? `${sources.length} matched audit records` : "Best matching audit record"}</summary>
      <ol className="mt-1 space-y-1">
        {sources.map((s) => (
          <li key={s.audit_id} className="leading-snug">
            <span className="tnum font-semibold">{Math.round(s.score * 100)}%</span>{" "}
            {s.workflow_id ? <Link to={`/workflows/${s.workflow_id}`} className="text-route underline">{s.audit_id}</Link> : s.audit_id}: {s.text}
          </li>
        ))}
      </ol>
    </details>
  );
}
