import { useSearchParams, Link } from "react-router-dom";
import { useData } from "../lib/live";
import { dayTime, kindLabel } from "../lib/format";
import { Empty, ErrorNote, Loading, PageHeader, Tag } from "../components/ui";

interface N { id: string; rider_name: string; language: string; contact: string; channel: string; kind: string; message: string; status: string; created_at: string; workflow_id: string | null; trip_id: string | null }
const langName: Record<string, string> = { en: "English", es: "Spanish", zh: "Chinese" };

export default function Riders({ embedded = false }: { embedded?: boolean }) {
  const [params] = useSearchParams();
  const wf = params.get("workflow");
  const { data, error } = useData<N[]>(`/products/rider-comms/notifications${wf ? `?workflow_id=${wf}` : ""}`, [wf]);
  return (
    <div className="fit-page">
      {!embedded && <PageHeader title="Rider messages" intro="Messages sent through rider communications (TripShot / Passio), in each rider's language and preferred channel." />}
      {wf && <p className="mb-3 text-sm">Showing messages for one <Link to={`/workflows/${wf}`} className="text-route underline">orchestration</Link>. <Link to="/simulate?tab=riders" className="text-route underline">Show all</Link></p>}
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : data.length === 0 ? <div className="panel"><Empty title="No messages sent yet">Riders are notified when the agent reassigns their run.</Empty></div> : (
        <div className="panel fit-scroll">
          <table className="table">
            <thead><tr><th>Sent</th><th>Rider</th><th>Channel</th><th>Type</th><th>Message</th></tr></thead>
            <tbody>
              {data.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap text-xs tnum">{dayTime(n.created_at)}</td>
                  <td><div className="font-medium">{n.rider_name}</div><div className="text-2xs text-ink-soft">{n.contact}</div></td>
                  <td><Tag>{n.channel}</Tag> <Tag>{langName[n.language] ?? n.language}</Tag></td>
                  <td><Tag color={n.kind === "eta_update" ? "amber" : "teal"}>{kindLabel(n.kind)}</Tag></td>
                  <td className="max-w-xl text-sm">{n.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
