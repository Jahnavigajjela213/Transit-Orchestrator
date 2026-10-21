import { useNavigate } from "react-router-dom";
import { dayTime, sentence } from "../../lib/format";
import type { AuditRecord } from "../../lib/types";
import { Empty, ErrorNote, Loading, Tag } from "../ui";
import { OpenButton, ViewAllButton } from "./DashboardShell";

// Lined up like a table's columns, without the real-<table> semantics the rest of the app avoids.
const ACTIVITY_GRID = "grid grid-cols-[124px_76px_minmax(0,1fr)_170px] gap-3";

const ACTION_VERB: Record<string, string> = { approve: "approved", reject: "rejected", override: "changed and approved", acknowledge: "acknowledged" };
/** Who did what: a human decision or a policy edit names the person; everything else keeps its actor alongside it. */
export function describeActivity(r: AuditRecord): { title: string; showActor: boolean } {
  if (r.record_type === "human_action" && r.human_action) return { title: `${r.actor} ${ACTION_VERB[r.human_action] ?? r.human_action}`, showActor: false };
  if (r.record_type === "policy_change") return { title: `${r.actor} changed the autonomy policy`, showActor: false };
  return { title: sentence(r.record_type), showActor: true };
}

/** Date & time / vehicle / what happened / agent, lined up like a table. Shared by every role dashboard that
 *  shows recent activity, so the column layout and "who did what" phrasing never drift between them. */
export function RecentActivity({ title, viewAllHref, activity, error, vehicleOf }: {
  title: string; viewAllHref: string; activity: AuditRecord[] | null; error?: string | null; vehicleOf: Record<string, string | null>;
}) {
  const nav = useNavigate();
  return (
    <section className="card flex min-h-0 flex-1 flex-col p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <ViewAllButton onClick={() => nav(viewAllHref)} />
      </div>
      {error && <div className="mt-3 shrink-0"><ErrorNote message={error} /></div>}
      {!activity ? <div className="mt-2"><Loading /></div> : activity.length === 0 ? <div className="mt-2"><Empty title="No activity yet" /></div> : (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex min-h-0 flex-1 flex-col min-w-[800px]">
            <div className={`${ACTIVITY_GRID} hidden shrink-0 border-b border-rule pb-2 text-[11px] uppercase tracking-[0.08em] text-ink-faint sm:grid`}>
              <span>Date &amp; time</span><span>Vehicle</span><span>What happened</span><span>Agent</span>
            </div>
            {/* The dashboard screen itself never scrolls - this list always fills whatever room is left and scrolls in place. */}
            <div className="min-h-0 flex-1 divide-y divide-rule-soft overflow-y-auto">
              {activity.map((r) => {
                const { title: rowTitle, showActor } = describeActivity(r);
                const vehicle = r.workflow_id ? vehicleOf[r.workflow_id] : null;
                return (
                  <div key={r.id} className={`${ACTIVITY_GRID} items-start gap-y-1 py-2.5 text-sm`}>
                    <span className="whitespace-nowrap text-[11px] text-ink-faint tnum">{dayTime(r.created_at)}</span>
                    <span>{vehicle ? <span className="chip-v">{vehicle}</span> : <span className="text-xs text-ink-faint">—</span>}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[13px] font-semibold">{rowTitle}</span>
                        {r.step && <span className="text-xs text-ink-faint">{sentence(r.step)}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{r.explanation || "—"}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      {showActor ? <Tag color="grey">{r.actor}</Tag> : <span className="truncate text-xs text-ink-soft">{r.actor}</span>}
                      {r.workflow_id && <OpenButton onClick={() => nav(`/workflows/${r.workflow_id}`)} />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
