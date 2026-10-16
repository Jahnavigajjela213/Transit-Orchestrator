import { useMemo } from "react";
import { useData } from "./live";
import type { Approval, Workflow } from "./types";

/** The one true "what's waiting" list: pending, vehicle-health, escalations first then severity then oldest.
 *  Both the Focus Queue and the rail's badge read this — so the number on the bell always equals the number
 *  of rows you'd see if you opened the queue right now, for any role. */
export function useAttentionQueue() {
  const { data, error, reload } = useData<Approval[]>("/api/approvals?status=pending&limit=60");
  const { data: wfs } = useData<Workflow[]>("/api/workflows?workflow_type=vehicle_health&limit=200");
  const byId = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w])), [wfs]);
  const all = useMemo(() => {
    const rank: Record<string, number> = { escalation: 0, approval: 1, informational: 2 };
    const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (data || []).filter((a) => a.status === "pending" && (!wfs || byId[a.workflow_id]))
      .sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((sev[a.severity ?? "low"] ?? 4) - (sev[b.severity ?? "low"] ?? 4)) || a.requested_at.localeCompare(b.requested_at));
  }, [data, wfs, byId]);
  const escalations = useMemo(() => all.filter((a) => a.kind === "escalation").length, [all]);
  return { data, wfs, byId, all, escalations, error, reload };
}
