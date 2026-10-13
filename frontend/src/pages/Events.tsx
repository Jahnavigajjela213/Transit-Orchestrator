import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useData } from "../lib/live";
import { seconds, sentence } from "../lib/format";
import type { EventRec } from "../lib/types";
import { Empty, ErrorNote, Json, Loading, PageHeader, Section, StatusBadge } from "../components/ui";

export default function Events() {
  const [type, setType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useData<EventRec[]>(`/api/events?limit=300${type ? `&type=${type}` : ""}`, [type]);
  const { data: catalog } = useData<{ type: string; source: string; triggers: string | null; description: string }[]>("/api/events/catalog");

  return (
    <div className="space-y-5">
      <PageHeader title="Event stream" intro="Products publish what happened; they don't need to know who is listening. Each event is stored, checked for duplicates, put in event-time order (vehicles with patchy connectivity send late), and handed to the orchestrator. Old signals for problems already fixed are kept as stale, not acted on."
        actions={<button className="btn-quiet" onClick={() => api.download("/api/events/export?since_hours=72", "events.jsonl")}>Export (CloudEvents JSONL)</button>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div>
          <select className="input mb-3 w-72" value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
            <option value="">All event types</option>
            {(catalog || []).map((c) => <option key={c.type} value={c.type}>{c.type}</option>)}
          </select>
          {error && <ErrorNote message={error} />}
          {!data ? <Loading /> : data.length === 0 ? <div className="panel"><Empty title="No events yet" /></div> : (
            <div className="panel overflow-x-auto">
              <table className="table">
                <thead><tr><th>Received</th><th>Type</th><th>Source</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>
                  {data.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="cursor-pointer hover:bg-paper/60" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        <td className="whitespace-nowrap text-xs tnum">{seconds(e.received_at)}</td>
                        <td className="font-medium">{e.type}</td>
                        <td className="text-xs">{sentence(e.source)}</td>
                        <td><StatusBadge status={e.status} /></td>
                        <td className="max-w-md text-xs text-ink-soft">
                          {e.note && <div className="text-2xs text-signal">{e.note}</div>}
                          {e.error ?? (e.data.fault_code ? `${e.data.fault_code} ${e.data.description ?? ""}` : e.data.work_order_id ?? e.data.run_id ?? e.data.status ?? e.data.step ?? "")}
                          {e.correlation_id && <> <Link onClick={(x) => x.stopPropagation()} className="text-route hover:underline" to={`/workflows/${e.correlation_id}`}>orchestration</Link></>}
                        </td>
                      </tr>
                      {open === e.id && <tr><td colSpan={5} className="bg-paper/50"><Json value={e} /></td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Section title="Event catalog">
          <ul className="divide-y divide-rule text-sm">
            {(catalog || []).map((c) => (
              <li key={c.type} className="px-4 py-2">
                <div className="font-medium">{c.type}</div>
                <div className="text-xs text-ink-soft">{c.description}</div>
                <div className="mt-0.5 text-2xs text-ink-faint">Published by {sentence(c.source)}{c.triggers ? `, ${c.triggers === "resume" ? "resumes a paused orchestration" : "starts an orchestration"}` : ""}</div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
