import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { easternNow } from "../lib/format";
import { useToast } from "../components/Toast";
import { ErrorNote, Loading, PageHeader } from "../components/ui";

export interface WO {
  id: string; asset_number: string; status: string; priority: string; fault_code: string | null; title: string; description: string;
  source: string; shop_depot: string | null; shop_start: string | null; shop_end: string | null; external_ref: string | null;
  created_by: string; created_at: string; closed_at: string | null; closed_by: string | null; resolution: string | null;
}

/** Still open and past the end of its own shop window - the shop's own definition of overdue, nothing invented. */
export const isOverdue = (w: WO) => (w.status === "open" || w.status === "in_progress") && !!w.shop_end && new Date(w.shop_end).getTime() < Date.now();

const PRIO: Record<string, string> = { critical: "bg-stop-tint text-stop", high: "bg-signal-tint text-signal-ink", medium: "bg-route-tint text-route-dark", low: "bg-[#EEF1F0] text-ink-soft" };
// The first lane names its contents: "Work order" for one, "Work orders" otherwise. Each heading carries a count pill in its lane's tone.
const LANES: { key: "open" | "in_progress" | "closed"; title: (n: number) => string; dot: string; pill: string }[] = [
  { key: "open", title: (n) => (n === 1 ? "Work order" : "Work orders"), dot: "bg-signal", pill: "bg-signal text-white" },
  { key: "in_progress", title: () => "In progress", dot: "bg-signal", pill: "border-[1.5px] border-dashed border-signal bg-white text-signal" },
  { key: "closed", title: () => "Closed today", dot: "bg-go", pill: "bg-go text-white" },
];
// The list is read from Databricks, which trails maintenance by several seconds: what the shop just did wins until it catches up.
const RANK: Record<string, number> = { open: 0, in_progress: 1, closed: 2, cancelled: 2 };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wd = (s: string) => new Date(s).toLocaleDateString([], { weekday: "short" });
const hm = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function shopWindow(w: WO): string {
  if (!w.shop_start || !w.shop_end) return "No shop window";
  const sameDay = w.shop_start.slice(0, 10) === w.shop_end.slice(0, 10);
  return `${wd(w.shop_start)} ${hm(w.shop_start)} → ${sameDay ? "" : `${wd(w.shop_end)} `}${hm(w.shop_end)}`;
}
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function WorkOrders() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error } = useData<WO[]>("/products/asset-mgmt/work-orders");
  const { data: assets } = useData<{ asset_number: string; unit_label: string }[]>("/products/asset-mgmt/assets");
  const label = Object.fromEntries((assets || []).map((a) => [a.asset_number, a.unit_label]));
  const isShop = user?.role === "shop_manager" || user?.role === "admin";
  const [done, setDone] = useState<Record<string, WO>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // A dashboard KPI can land here pre-filtered, e.g. /work-orders?priority=critical or ?overdue=1.
  const [params] = useSearchParams();
  const priorityFilter = params.get("priority");
  const overdueOnly = params.get("overdue") === "1";
  // A "requires attention" KPI (e.g. critical vehicle faults still open) counts only what's unresolved -
  // exclude anything already closed/cancelled so the board matches that count exactly.
  const activeOnly = params.get("active") === "1";

  const today = ymd(easternNow());
  const lanes = useMemo(() => {
    const rows = (data || []).map((w) => (done[w.id] && RANK[done[w.id].status] > RANK[w.status] ? done[w.id] : w))
      .filter((w) => (!priorityFilter || w.priority === priorityFilter) && (!overdueOnly || isOverdue(w))
        && (!activeOnly || (w.status !== "closed" && w.status !== "cancelled")));
    return LANES.map((l) => ({
      ...l,
      cards: rows.filter((w) => l.key === "closed"
        ? (w.status === "closed" || w.status === "cancelled") && (w.closed_at ?? w.created_at).slice(0, 10) === today
        : w.status === l.key)
        .sort((a, b) => (RANK[a.status] === 2 ? (b.closed_at ?? "").localeCompare(a.closed_at ?? "") : b.created_at.localeCompare(a.created_at))),
    }));
  }, [data, done, today, priorityFilter, overdueOnly, activeOnly]);

  async function act(wo: WO, action: "start" | "close") {
    setBusy(wo.id);
    try {
      const updated = await api.post<WO>(`/products/asset-mgmt/work-orders/${wo.id}/${action}`, action === "close" ? { resolution: "Repaired and road tested" } : {});
      setDone((d) => ({ ...d, [wo.id]: updated }));
      toast(action === "close" ? `Closed ${wo.id}` : `Started ${wo.id}`);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader intro="Start work first, then close it. Closing an agent-opened work order returns the vehicle to the schedule automatically."
        badge={(priorityFilter || overdueOnly || activeOnly) && (
          <span className="pill bg-[#EEF1F0] text-ink-soft">
            {[priorityFilter && `${sentenceCase(priorityFilter)} priority`, overdueOnly && "Overdue", activeOnly && "Still open"].filter(Boolean).join(" · ")} only
            <Link to="/work-orders" className="ml-1.5 font-semibold text-route hover:underline">Clear ✕</Link>
          </span>
        )} />

      {error && <ErrorNote message={error} />}
      {!data ? <div className="card"><Loading /></div> : (
        // From tablet width up the board fills the window and each lane scrolls inside itself.
        <div className="grid min-w-0 grid-cols-1 gap-3.5 md:min-h-0 md:flex-1 md:grid-cols-3 md:grid-rows-[minmax(0,1fr)]">
            {lanes.map((lane) => (
              <section key={lane.key} className="flex min-h-[240px] flex-col rounded-[14px] border border-rule bg-[#ECEFEE] md:min-h-0">
                <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-3.5">
                  <span className={`h-2 w-2 rounded-full ${lane.dot}`} aria-hidden />
                  <h2 className="text-sm font-semibold">{lane.title(lane.cards.length)}</h2>
                  <span className={`box-border flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tnum ${lane.pill}`}>{lane.cards.length}</span>
                </div>
                <div className="flex flex-col gap-2.5 px-3 pb-3.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
                  {lane.cards.length === 0 && <span className="px-1 py-2.5 text-xs text-[#9AA4AB]">Nothing here</span>}
                  {lane.cards.map((w) => (
                    <article key={w.id} className="rounded-xl border border-rule bg-white p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="chip-v">{label[w.asset_number] ?? "Vehicle"}</span>
                        <span className="flex-1 truncate font-mono text-[11px] text-ink-faint">{w.id}</span>
                        <span className={`rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold ${PRIO[w.priority] ?? PRIO.low}`}>{sentenceCase(w.priority)}</span>
                      </div>
                      <div className="mt-2 text-[13.5px] font-semibold">{w.title}</div>
                      <div className="mt-1 text-xs text-ink-soft">{shopWindow(w)}{w.shop_depot ? ` · ${w.shop_depot}` : ""}</div>
                      <div className="mt-2 text-[11.5px] text-route">
                        {w.status === "closed" && w.source === "orchestrator" ? "Returned to service automatically"
                          : w.status === "closed" || w.status === "cancelled" ? `${sentenceCase(w.status)}${w.closed_by ? ` by ${w.closed_by}` : ""}${w.resolution ? ` · ${w.resolution}` : ""}`
                          : w.source === "orchestrator" ? (w.external_ref ? <Link to={`/workflows/${w.external_ref}`} className="hover:underline">Opened by agent · orchestration</Link> : "Opened by agent")
                          : `Manual · ${w.description || w.created_by}`}
                      </div>
                      {isShop && w.status === "open" && (
                        <button type="button" disabled={busy === w.id} onClick={() => act(w, "start")}
                          className="mt-3 h-10 w-full rounded-[10px] bg-route font-semibold text-white hover:bg-route-dark disabled:opacity-50">Start work</button>
                      )}
                      {isShop && w.status === "in_progress" && (
                        <button type="button" disabled={busy === w.id} onClick={() => act(w, "close")}
                          className="mt-3 h-10 w-full rounded-[10px] border border-route bg-white font-semibold text-route hover:bg-route-tint disabled:opacity-50">Close work order</button>
                      )}
                      {!isShop && (w.status === "open" || w.status === "in_progress") && (
                        <div className="mt-3 text-[11.5px] text-ink-faint">The shop manager {w.status === "open" ? "starts" : "closes"} this work order.</div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
