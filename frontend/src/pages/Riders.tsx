import { useSearchParams, Link } from "react-router-dom";
import { useData } from "../lib/live";
import { dayTime, kindLabel } from "../lib/format";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { Pager, usePaged } from "../components/Pager";

interface N { id: string; rider_name: string; language: string; contact: string; channel: string; kind: string; message: string; status: string; created_at: string; workflow_id: string | null; trip_id: string | null }
const langName: Record<string, string> = { en: "English", es: "Spanish", zh: "Chinese" };

const CHANNEL: Record<string, string> = { sms: "SMS", app: "App", email: "Email" };

export default function Riders({ embedded = false }: { embedded?: boolean }) {
  const [params] = useSearchParams();
  const wf = params.get("workflow");
  const { data, error } = useData<N[]>(`/products/rider-comms/notifications${wf ? `?workflow_id=${wf}` : ""}`, [wf]);
  const pg = usePaged(data, [wf]);
  return (
    <div className="flex flex-col gap-2.5 md:min-h-0 md:flex-1">
      {!embedded && <PageHeader title="Rider messages" intro="Messages sent through rider communications (TripShot / Passio), in each rider's language and preferred channel." />}
      {wf && <p className="shrink-0 text-[13px] text-ink-soft">Showing messages for one <Link to={`/workflows/${wf}`}>orchestration</Link>. <Link to="/simulate?tab=riders">Show all</Link></p>}
      {error && <div className="shrink-0"><ErrorNote message={error} /></div>}
      {!data ? <div className="card shrink-0"><Loading /></div> : data.length === 0 ? <div className="card shrink-0"><Empty title="No messages sent yet">Riders are notified when the agent reassigns their run.</Empty></div> : (
        <div className="flex flex-col gap-2.5 md:min-h-0 md:flex-1">
        <div className="flex flex-col gap-2.5 pr-1 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {pg.rows.map((n) => (
          <article key={n.id} className="card px-[18px] py-3.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
              <b className="text-[13.5px] text-ink">{n.rider_name}</b>
              <span className="pill bg-[#EEF1F0] px-2 py-0.5 font-normal text-ink-soft">{CHANNEL[n.channel] ?? n.channel}</span>
              <span className="pill bg-[#EEF1F0] px-2 py-0.5 font-normal text-ink-soft">{langName[n.language] ?? n.language}</span>
              <span className="pill bg-route-tint px-2 py-0.5 font-normal text-route-dark">{kindLabel(n.kind)}</span>
              <span className="flex-1" />
              <span title={n.contact}>{dayTime(n.created_at)}</span>
            </div>
            <p className="mt-2 text-[13.5px] leading-normal">{n.message}</p>
          </article>
        ))}
        </div>
        <div className="shrink-0"><Pager {...pg} /></div>
        </div>
      )}
    </div>
  );
}
