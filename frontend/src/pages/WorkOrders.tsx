import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, sentence } from "../lib/format";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Loading, PageHeader, SeverityTag, StatusBadge, Tag } from "../components/ui";

interface WO {
  id: string; asset_number: string; status: string; priority: string; fault_code: string | null; title: string; description: string;
  source: string; shop_depot: string | null; shop_start: string | null; shop_end: string | null; external_ref: string | null;
  created_by: string; created_at: string; closed_at: string | null; closed_by: string | null; resolution: string | null;
}

export default function WorkOrders() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("open,in_progress");
  const { data, error, reload } = useData<WO[]>(`/products/asset-mgmt/work-orders?status=${status}`, [status]);
  const { data: assets } = useData<{ asset_number: string; unit_label: string }[]>("/products/asset-mgmt/assets");
  const label = Object.fromEntries((assets || []).map((a) => [a.asset_number, a.unit_label]));
  const isShop = user?.role === "shop_manager" || user?.role === "admin";
  const [resolution, setResolution] = useState<Record<string, string>>({});
  // The list is read from Databricks, which trails maintenance by several seconds: show what the shop just did right away.
  const [done, setDone] = useState<Record<string, WO>>({});
  const rank: Record<string, number> = { open: 0, in_progress: 1, closed: 2, cancelled: 2 };
  const rows = (data || []).map((w) => (done[w.id] && rank[done[w.id].status] > rank[w.status] ? done[w.id] : w));

  async function act(wo: WO, action: "start" | "close") {
    try {
      const updated = await api.post<WO>(`/products/asset-mgmt/work-orders/${wo.id}/${action}`, action === "close" ? { resolution: resolution[wo.id] || "Repaired and road tested" } : {});
      setDone((d) => ({ ...d, [wo.id]: updated }));
      toast(action === "close" ? `Closed ${wo.id}` : `Started ${wo.id}`);
      reload();
    } catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <div>
      <PageHeader title="Maintenance" eyebrow="Work orders · asset management" intro="The shop's view in asset management (FASTER). Start work first, then close it: closing a work order the agent opened returns the vehicle to the schedule automatically. New work orders can take a few seconds to show here while they sync to Databricks." />
      <div className="seg mb-4" role="tablist" aria-label="Status">
        {[["open,in_progress", "Open"], ["closed,cancelled", "Closed"], ["", "All"]].map(([v, l]) => (
          <button key={l} role="tab" aria-selected={status === v} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>
      {!isShop && <p className="mb-3 text-xs text-ink-soft">Sign in as the shop manager to start or close work orders.</p>}
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : rows.length === 0 ? <div className="panel"><Empty title="No work orders here" /></div> : (
        <div className="panel overflow-x-auto">
          <table className="table">
            <thead><tr><th>Work order</th><th>Vehicle</th><th>Priority</th><th>Shop window</th><th>Opened</th><th>Status</th><th className="w-72"></th></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td><div className="font-medium">{w.id}</div><div className="text-xs">{w.title}</div>
                    {w.source === "orchestrator" && <div className="mt-0.5"><Tag color="teal">Opened by agent</Tag>{w.external_ref && <Link to={`/workflows/${w.external_ref}`} className="ml-1.5 text-2xs text-route hover:underline">orchestration</Link>}</div>}</td>
                  <td>{label[w.asset_number] ?? ""}<div className="text-2xs text-ink-soft">{w.asset_number}</div></td>
                  <td><SeverityTag severity={w.priority} /></td>
                  <td className="text-xs">{w.shop_start ? <>{dayTime(w.shop_start)}<br />to {dayTime(w.shop_end)}<div className="text-ink-soft">{w.shop_depot}</div></> : "—"}</td>
                  <td className="text-xs">{dayTime(w.created_at)}<div className="text-ink-soft">{w.created_by}</div></td>
                  <td><StatusBadge status={w.status} />{w.closed_by && <div className="mt-0.5 text-2xs text-ink-soft">{sentence(w.status)} by {w.closed_by}</div>}</td>
                  <td>
                    {isShop && ["open", "in_progress"].includes(w.status) && (
                      <div className="flex flex-col gap-1.5">
                        {w.status === "in_progress" && <input className="input text-xs" placeholder="Resolution (optional)" value={resolution[w.id] || ""} onChange={(e) => setResolution({ ...resolution, [w.id]: e.target.value })} aria-label={`Resolution for ${w.id}`} />}
                        {w.status === "open" ? (
                          <div className="flex items-center gap-2">
                            <button className="btn-primary" onClick={() => act(w, "start")}>Start work</button>
                            <span className="text-2xs text-ink-soft">Start work before it can be closed</span>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <button className="btn-primary" onClick={() => act(w, "close")}>Close work order</button>
                          </div>
                        )}
                      </div>
                    )}
                    {w.resolution && <div className="text-xs text-ink-soft">{w.resolution}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
