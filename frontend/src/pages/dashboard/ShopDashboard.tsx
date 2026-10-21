import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Clock, ShieldAlert, Wrench } from "lucide-react";
import { useData } from "../../lib/live";
import { useOpenWorkOrderApprovals } from "../../components/dashboard/panels";
import { ago, dayTime, sentence } from "../../lib/format";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import type { AuditRecord, FleetRow } from "../../lib/types";
import { Empty, ErrorNote, Loading } from "../../components/ui";
import { OpenButton, ReviewButton, StatTile, StatTileRow, ViewAllButton } from "../../components/dashboard/DashboardShell";
import { RecentActivity } from "../../components/dashboard/ActivityFeed";
import { isOverdue, type WO } from "../WorkOrders";

interface SummaryLite { operations: { vehicles: { total: number; out_of_service: number } } }

const PRIO: Record<string, string> = { critical: "bg-stop-tint text-stop", high: "bg-signal-tint text-signal-ink", medium: "bg-route-tint text-route-dark", low: "bg-[#EEF1F0] text-ink-soft" };
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ShopDashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const approvals = useOpenWorkOrderApprovals();

  const { data: wos, error: woErr, reload: reloadWos } = useData<WO[]>("/products/asset-mgmt/work-orders");
  const { data: assets } = useData<{ asset_number: string; unit_label: string }[]>("/products/asset-mgmt/assets");
  const { data: fleet } = useData<FleetRow[]>("/api/fleet");
  const { data: summary } = useData<SummaryLite>("/api/metrics/summary");
  const { data: activity, error: activityErr } = useData<AuditRecord[]>("/api/audit?limit=8");

  const label = useMemo(() => Object.fromEntries((assets ?? []).map((a) => [a.asset_number, a.unit_label])), [assets]);
  const vehicleOf = useMemo(() => Object.fromEntries((wos ?? []).filter((w) => w.external_ref).map((w) => [w.external_ref as string, label[w.asset_number] ?? null])), [wos, label]);

  const openWos = useMemo(() => (wos ?? []).filter((w) => w.status === "open" || w.status === "in_progress"), [wos]);
  const overdueWos = useMemo(() => openWos.filter(isOverdue), [openWos]);

  // One row per Vestige defect; a vehicle can carry more than one, each counted once. Same rule the other dashboards use.
  const criticalDefects = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; vehicle: string; category: string; out_of_service: boolean }[] = [];
    (fleet ?? []).forEach((v) => (v.open_defects ?? []).forEach((d) => {
      if (d.severity === "critical" && !seen.has(d.id)) { seen.add(d.id); out.push({ id: d.id, vehicle: v.label, category: d.category, out_of_service: d.out_of_service }); }
    }));
    return out;
  }, [fleet]);

  // Faults by severity, same dedupe.
  const faultsBySeverity = useMemo(() => {
    const seen = new Set<string>();
    const n: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    (fleet ?? []).forEach((v) => (v.open_defects ?? []).forEach((d) => {
      if (!seen.has(d.id)) { seen.add(d.id); n[d.severity] = (n[d.severity] ?? 0) + 1; }
    }));
    return n;
  }, [fleet]);

  const wosByStatus = useMemo(() => {
    const n: Record<string, number> = { open: 0, in_progress: 0, closed: 0, cancelled: 0 };
    (wos ?? []).forEach((w) => { n[w.status] = (n[w.status] ?? 0) + 1; });
    return n;
  }, [wos]);

  async function act(wo: WO, action: "start" | "close") {
    try {
      await api.post(`/products/asset-mgmt/work-orders/${wo.id}/${action}`, action === "close" ? { resolution: "Repaired and road tested" } : {});
      toast(action === "close" ? `Closed ${wo.id}` : `Started ${wo.id}`);
      reloadWos();
    } catch (e: any) { toast(e.message, "error"); }
  }

  // Awaiting shop review (not yet a work order), then overdue or critical, then the rest - oldest first within each tier.
  const attentionWos = useMemo(() => [...openWos].sort((a, b) =>
    (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0) || (a.priority === "critical" ? 0 : 1) - (b.priority === "critical" ? 0 : 1) || a.created_at.localeCompare(b.created_at)), [openWos]);

  const o = summary?.operations;
  const dataLoaded = !!wos && !!fleet;

  return (
    <div className="space-y-5 md:flex md:min-h-0 md:flex-1 md:flex-col md:space-y-0 md:gap-5 md:overflow-hidden">
      <div className="shrink-0">
        <StatTileRow>
          <StatTile label="Open work orders" icon={Wrench} value={wos ? openWos.length : "—"} sub="Open or in progress"
            tone={openWos.length ? "warn" : "good"} onClick={() => nav("/work-orders")} />
          <StatTile label="Critical vehicle faults" icon={ShieldAlert} value={fleet ? criticalDefects.length : "—"} sub="Unresolved, critical severity"
            tone={criticalDefects.length ? "bad" : "good"} onClick={() => nav("/work-orders?priority=critical")} />
          <StatTile label="Overdue maintenance" icon={Clock} value={wos ? overdueWos.length : "—"} sub="Past their shop window"
            tone={overdueWos.length ? "bad" : "good"} onClick={() => nav("/work-orders?overdue=1")} />
          <StatTile label="Vehicles out of service" icon={Ban} value={o ? o.vehicles.out_of_service : "—"} sub={o ? `of ${o.vehicles.total} vehicles` : undefined}
            tone={o?.vehicles.out_of_service ? "warn" : "good"} onClick={() => nav("/work-orders")} />
        </StatTileRow>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <section className="card flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Critical maintenance alerts</h2>
            <ViewAllButton onClick={() => nav("/work-orders?priority=critical")} />
          </div>
          {woErr && <div className="mt-3"><ErrorNote message={woErr} /></div>}
          {!wos ? <div className="mt-2"><Loading /></div> : (() => {
            const critical = (wos ?? []).filter((w) => w.priority === "critical" && (w.status === "open" || w.status === "in_progress"))
              .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 3);
            return critical.length === 0 ? <div className="mt-2 flex-1"><Empty title="No critical maintenance alerts" /></div> : (
              <ul className="mt-3 flex-1 divide-y divide-rule-soft">
                {critical.map((w) => (
                  <li key={w.id} className="py-2.5">
                    <div className="flex w-full items-start gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-stop" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-[13px] font-semibold">{w.fault_code ? `${w.fault_code} · ${w.title}` : w.title}</span>
                          <span className="chip-v">{label[w.asset_number] ?? w.asset_number}</span>
                          {isOverdue(w) && <span className="pill bg-stop-tint text-[10.5px] text-stop">Overdue</span>}
                        </div>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          Detected {ago(w.created_at)}{w.shop_depot ? ` · ${w.shop_depot}` : ""} · {sentence(w.status)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>

        <section className="card flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Work orders requiring attention</h2>
            <ViewAllButton onClick={() => nav("/work-orders")} />
          </div>
          {!wos ? <div className="mt-2"><Loading /></div> : approvals.length === 0 && attentionWos.length === 0 ? (
            <div className="mt-2 flex-1"><Empty title="Nothing needs attention">Every work order is on track.</Empty></div>
          ) : (
            <ul className="mt-3 flex-1 divide-y divide-rule-soft">
              {approvals.slice(0, 2).map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="flex w-full items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[13px] font-semibold">{a.title}</span>
                        <span className="chip-v">{a.vehicle_label}</span>
                        <span className={`pill text-[10.5px] ${PRIO[a.severity ?? "low"] ?? PRIO.low}`}>{sentence(a.severity ?? "")}</span>
                        <span className="pill bg-signal-tint text-[10.5px] text-signal-ink">Awaiting your review</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft">Waiting {ago(a.requested_at)}</p>
                    </div>
                    <ReviewButton onClick={() => nav("/attention")} />
                  </div>
                </li>
              ))}
              {attentionWos.slice(0, 3 - Math.min(2, approvals.length)).map((w) => (
                <li key={w.id} className="py-2.5">
                  <div className="flex w-full items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[13px] font-semibold">{w.title}</span>
                        <span className="chip-v">{label[w.asset_number] ?? w.asset_number}</span>
                        <span className={`pill text-[10.5px] ${PRIO[w.priority] ?? PRIO.low}`}>{sentenceCase(w.priority)}</span>
                        {isOverdue(w) ? <span className="pill bg-stop-tint text-[10.5px] text-stop">Overdue</span>
                          : <span className="pill bg-[#EEF1F0] text-[10.5px] text-ink-soft">{w.status === "in_progress" ? "In progress" : "Waiting for the shop"}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {w.shop_end ? `Due ${dayTime(w.shop_end)}` : "No shop window set"}{w.shop_depot ? ` · ${w.shop_depot}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {w.status === "open" && <button type="button" className="btn-primary h-8 px-3 text-[12.5px]" onClick={() => act(w, "start")}>Start work</button>}
                      {w.status === "in_progress" && <OpenButton label="Close" onClick={() => act(w, "close")} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 min-[1080px]:grid-cols-2">
        <section className="card flex flex-col overflow-y-auto p-4">
          <div className="flex shrink-0 items-start justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Maintenance status overview</h2>
            {dataLoaded && (
              <div className="flex shrink-0 items-stretch gap-2.5 text-right">
                <div className="rounded-lg bg-go-tint px-3 py-1.5">
                  <div className="text-xl font-semibold tnum text-go">{o ? o.vehicles.total - o.vehicles.out_of_service : "—"}</div>
                  <div className="text-2xs text-go">In service</div>
                </div>
                <div className="rounded-lg bg-stop-tint px-3 py-1.5">
                  <div className="text-xl font-semibold tnum text-stop">{o?.vehicles.out_of_service ?? "—"}</div>
                  <div className="text-2xs text-stop">Out of service</div>
                </div>
              </div>
            )}
          </div>
          {!dataLoaded ? <div className="mt-2"><Loading /></div> : (
            <div className="mt-3 flex flex-1 flex-col justify-center gap-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Faults by severity</h3>
                <div className="space-y-2">
                  {([["Critical", faultsBySeverity.critical, "bg-stop"], ["High", faultsBySeverity.high, "bg-signal"], ["Medium", faultsBySeverity.medium, "bg-route"], ["Low", faultsBySeverity.low, "bg-ink-faint"]] as [string, number, string][]).map(([l, n, bar]) => {
                    const total = Object.values(faultsBySeverity).reduce((a, b) => a + b, 0);
                    return (
                      <div key={l} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-sm font-medium">{l}</span>
                        <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]"><div className={`h-full rounded-full ${bar}`} style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
                        <span className="w-7 shrink-0 text-right text-base font-semibold tnum">{n}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Work orders by status</h3>
                <div className="space-y-2">
                  {([["Open", wosByStatus.open, "bg-signal"], ["In progress", wosByStatus.in_progress, "bg-shop"], ["Closed", wosByStatus.closed, "bg-go"], ["Cancelled", wosByStatus.cancelled, "bg-ink-faint"]] as [string, number, string][]).map(([l, n, bar]) => (
                    <div key={l} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-sm font-medium">{l}</span>
                      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]"><div className={`h-full rounded-full ${bar}`} style={{ width: `${(wos?.length ? (n / wos.length) * 100 : 0)}%` }} /></div>
                      <span className="w-7 shrink-0 text-right text-base font-semibold tnum">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <RecentActivity title="Recent maintenance activity" viewAllHref="/audit" activity={activity} error={activityErr} vehicleOf={vehicleOf} />
      </div>
    </div>
  );
}
