import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/live";
import type { Approval, Workflow } from "../lib/types";
import DecisionCard from "../components/DecisionCard";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui";

export default function Attention() {
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const status = tab === "pending" ? "pending" : "approved,rejected,overridden,acknowledged";
  const { data, error, reload } = useData<Approval[]>(`/api/approvals?status=${status}&limit=60`, [tab]);
  const { data: wfs } = useData<Workflow[]>("/api/workflows?limit=200");
  const stepsById = useMemo(() => Object.fromEntries((wfs || []).map((w) => [w.id, w.steps])), [wfs]);

  const sorted = useMemo(() => {
    const rank: Record<string, number> = { escalation: 0, approval: 1, informational: 2 };
    const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...(data || [])].sort((a, b) => tab === "pending"
      ? (rank[a.kind] - rank[b.kind]) || ((sev[a.severity ?? "low"] ?? 4) - (sev[b.severity ?? "low"] ?? 4)) || a.requested_at.localeCompare(b.requested_at)
      : b.decided_at!.localeCompare(a.decided_at!));
  }, [data, tab]);

  return (
    <div>
      <PageHeader title="Needs your attention" intro="Actions the agent wants to take that your policy says a person must approve, plus anything it could not finish on its own." />
      <div className="mb-4 flex gap-1 border-b border-rule" role="tablist">
        {(["pending", "decided"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-route text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {t === "pending" ? "Waiting" : "Decided"}
          </button>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      {!data ? <Loading /> : sorted.length === 0 ? (
        <div className="panel">
          <Empty title={tab === "pending" ? "You're all caught up" : "No decisions yet"}>
            {tab === "pending" ? <>New items appear here as soon as the agent needs you. To try one, inject a fault from the <Link to="/simulator" className="text-route underline">simulator</Link>.</> : null}
          </Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((a) => <DecisionCard key={a.id} item={a} steps={stepsById[a.workflow_id]} onDone={reload} />)}
        </div>
      )}
    </div>
  );
}
