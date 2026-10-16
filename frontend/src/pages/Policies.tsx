import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { ago, roleName, sentence, words, workflowName } from "../lib/format";
import { Drawer, DrawerLink, Head } from "../components/focus";
import { useToast } from "../components/Toast";
import { ErrorNote, Loading } from "../components/ui";

/* Autonomy policy: the policy and autonomy engine's per-tenant rules (proposal §3.1, §4.1). Each write step gets one of the
   three autonomy levels; rarely touched settings (by-severity levels, thresholds, compensating actions, permissions, safety)
   live in drawers. Shadow mode is a run mode and its own tab. */

interface Pol {
  version: number; updated_by: string; updated_at: string; rules: any;
  meta: { name: string; workflow_types: { key: string; name: string }[]; levels: string[]; steps: { key: string; label: string; description: string }[]; roles: string[]; all_permissions: string[]; severities: string[];
    modes: string[]; personas: string[]; persona_permission_options: string[] };
}

const CHOICES: [string, string][] = [["informational", "Informational"], ["semi_autonomous", "Semi-autonomous"], ["autonomous", "Autonomous"]];
const levelHint: Record<string, string> = {
  informational: "The agent recommends; a person acts in the product.",
  semi_autonomous: "A person approves before the agent acts.",
  autonomous: "The agent acts on its own and records it.",
  shadow: "Shadow: the agent records this step without acting.",
};
const shortLevel: Record<string, string> = { informational: "Informational", shadow: "Shadow", semi_autonomous: "Semi-autonomous", autonomous: "Autonomous" };
const FIXED = ["detect", "assess", "close"];
const FAULT_SYSTEMS = ["Brakes", "Accessibility", "Engine", "Electrical", "Chassis", "Comfort", "Emissions", "Maintenance"];
const thresholdLabel: Record<string, string> = {
  service_window_hours: "Plan cover for runs in the next (hours)",
  pm_high_severity_miles_over: "PM overdue miles that count as high severity",
  max_spare_candidates: "Spare vehicles to offer per run",
  swap_delay_same_depot_min: "Delay when the spare is at the same depot (min)",
  swap_delay_other_depot_min: "Delay when the spare is at another depot (min)",
  delay_applies_within_minutes_of_run_start: "Riders delayed if pickup is within (min of run start)",
  no_show_minutes_saved: "Minutes freed by a no-show",
  late_cancel_minutes_saved: "Minutes freed by a late cancellation",
  late_threshold_min: "A pickup counts as late after (min)",
  max_insert_extra_min: "Most extra minutes a standby rider may add to later pickups",
  notify_if_eta_change_min: "Tell riders when their pickup moves by at least (min)",
  no_show_review_threshold_30d: "Flag a rider after this many no-shows in 30 days",
  max_standby_candidates: "Standby riders to offer",
};
const compensationLabel: Record<string, string> = {
  restore_vehicle_on_reassign_failure: "Put the vehicle back on the schedule if covering its runs fails",
  cancel_work_order_on_failure: "Cancel the work order if the orchestration cannot finish",
  cancel_booking_on_failure: "Cancel the standby booking if re-timing later pickups fails",
};

/** The two tabs of governance: the autonomy policy and shadow mode. */
export function GovernanceTabs({ shadow }: { shadow: boolean }) {
  return (
    <div className="seg mb-6" role="group" aria-label="Autonomy policy">
      <Link to="/policies" aria-pressed={!shadow} className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${!shadow ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,23,32,0.08)]" : "text-ink-faint hover:text-ink"}`}>Autonomy policy</Link>
      <Link to="/shadow" aria-pressed={shadow} className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${shadow ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,23,32,0.08)]" : "text-ink-faint hover:text-ink"}`}>Shadow mode</Link>
    </div>
  );
}

type DrawerKey = "severity" | "thresholds" | "rollbacks" | "agent" | "personas" | "safety";

export default function Policies() {
  const { user } = useAuth();
  const toast = useToast();
  const [wtype, setWtype] = useState("vehicle_health");
  const { data, error, reload } = useData<Pol>(`/api/policies/${wtype}`, [wtype]);
  const [rules, setRules] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [drawer, setDrawer] = useState<{ k: DrawerKey; step?: string } | null>(null);
  useEffect(() => { if (data) setRules(structuredClone(data.rules)); }, [data]);
  const isAdmin = user?.role === "admin";

  if (error) return <ErrorNote message={error} />;
  if (!data || !rules) return <Loading />;
  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules);
  const setStep = (k: string, patch: any) => setRules({ ...rules, steps: { ...rules.steps, [k]: { ...rules.steps[k], ...patch } } });
  const steps = data.meta.steps.filter((s) => !FIXED.includes(s.key));
  const fixed = data.meta.steps.filter((s) => FIXED.includes(s.key));
  const mode = rules.mode ?? "live";

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ version: number }>(`/api/policies/${wtype}`, { rules });
      toast(`Policy saved as version ${r.version}. New decisions use it straight away.`);
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  }

  const sev = drawer?.step ? rules.steps[drawer.step] : null;
  return (
    <>
      <Head title="Autonomy policy"
        intro={<>How much the agent may do on its own at each step, per use case, for {user?.tenant_name}. Version {data.version}, last changed by {data.updated_by} {ago(data.updated_at)}.</>} />
      <GovernanceTabs shadow={false} />
      {data.meta.workflow_types.length > 1 && (
        <div className="seg mb-5" role="radiogroup" aria-label="Use case">
          {data.meta.workflow_types.map((t) => (
            <button key={t.key} role="radio" aria-checked={wtype === t.key} onClick={() => { setRules(null); setDrawer(null); setWtype(t.key); }}>{workflowName[t.key] ?? t.name}</button>
          ))}
        </div>
      )}
      {!isAdmin && <p className="mb-4 text-ink-faint">Only the operations admin can change the policy. You can see the current rules below.</p>}

      <section className="mb-5 flex flex-wrap items-center gap-[18px] rounded-[14px] border border-rule px-[22px] py-[18px]">
        <div className="seg" role="radiogroup" aria-label="Run mode">
          {data.meta.modes.map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} disabled={!isAdmin} onClick={() => setRules({ ...rules, mode: m })}>{m === "live" ? "Live" : "Shadow"}</button>
          ))}
        </div>
        <p className="min-w-[260px] flex-1 text-sm text-ink-faint">
          {mode === "shadow" ? "Shadow mode: the agent works out exactly what it would do at every step and records it, but takes no action and asks no one. People keep working in the products; the Shadow mode tab compares the two and measures your baseline."
            : "Live: each step follows the autonomy level set below."}
        </p>
      </section>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label="Steps" className="min-w-0 flex-[999_1_600px] rounded-[14px] border border-rule">
          <div className="flex items-center gap-2 border-b border-rule px-[22px] py-4 text-sm text-ink-faint">
            <Check className="h-4 w-4" aria-hidden /><span>{fixed.map((s, i) => <span key={s.key}>{i ? (i === fixed.length - 1 ? " and " : ", ") : ""}<b className="font-semibold text-ink">{s.label}</b></span>)} are always automatic.</span>
          </div>
          {steps.map((s) => {
            const cfg = rules.steps[s.key] || {};
            const exceptions = Object.keys(cfg.by_severity || {}).length;
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-5 border-b border-rule px-[22px] py-5 last:border-b-0">
                <div className="min-w-0 flex-[1_1_280px]">
                  <div className="text-base font-semibold">{s.label}</div>
                  <div className="text-[13px] text-ink-faint">{s.description}</div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {data.meta.roles.filter((r) => r !== "admin").map((r) => (
                      <label key={r} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#E1E4E8] px-2.5 py-1 text-xs text-ink-soft">
                        <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={(cfg.approver_roles || []).includes(r)}
                          onChange={(e) => setStep(s.key, { approver_roles: e.target.checked ? [...(cfg.approver_roles || []), r] : (cfg.approver_roles || []).filter((x: string) => x !== r) })} />
                        {roleName[r]} approves
                      </label>
                    ))}
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-faint">Agent acts for
                      <select className="input w-auto py-1 pr-8 text-xs" disabled={!isAdmin} value={cfg.acts_as ?? ""} aria-label={`${s.label}: agent acts for`} onChange={(e) => setStep(s.key, { acts_as: e.target.value })}>
                        {data.meta.personas.filter((r) => r !== "viewer").map((r) => <option key={r} value={r}>{roleName[r]}</option>)}
                      </select>
                    </label>
                    {wtype === "vehicle_health" && <button className="text-xs font-medium text-route hover:underline" onClick={() => setDrawer({ k: "severity", step: s.key })}>
                      {exceptions ? `By severity: ${exceptions} override${exceptions === 1 ? "" : "s"}` : "Levels by severity"}
                    </button>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="seg" role="radiogroup" aria-label={s.label}>
                    {CHOICES.map(([l, t]) => (
                      <button key={l} role="radio" aria-checked={cfg.level === l} disabled={!isAdmin} onClick={() => setStep(s.key, { level: l })}
                        className={cfg.level === l ? (l === "semi_autonomous" ? "!bg-signal-tint !text-[#7A4F00]" : l === "autonomous" ? "!bg-route-tint !text-route-dark" : "") : ""}>{t}</button>
                    ))}
                  </div>
                  <span className={`text-xs ${cfg.level === "shadow" ? "text-[#8A5A00]" : "text-ink-faint"}`}>{levelHint[cfg.level] ?? ""}</span>
                </div>
              </div>
            );
          })}
        </section>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <section className="rounded-[14px] border border-rule p-[22px]">
            <h2 className="text-base font-semibold">Ready for more autonomy?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-faint">Write steps start <b className="text-ink">semi-autonomous</b>, or in shadow mode before go-live. Move a step to <b className="text-ink">autonomous</b> only on measured acceptance: at least 5 incidents compared in shadow mode with 80% or more agreement.</p>
            <Link to="/shadow" className="mt-3 inline-block text-sm font-medium text-route hover:underline">Open shadow mode</Link>
          </section>
          <section className="rounded-[14px] border border-rule px-[22px] pb-2 pt-4">
            <h2 className="mb-1 text-base font-semibold">Advanced</h2>
            <DrawerLink label="Thresholds" count={Object.keys(rules.thresholds).length} onClick={() => setDrawer({ k: "thresholds" })} />
            <DrawerLink label="Compensating actions" count={Object.keys(rules.compensation).length} onClick={() => setDrawer({ k: "rollbacks" })} />
            <DrawerLink label="Agent permissions" count={rules.agent_permissions.length} onClick={() => setDrawer({ k: "agent" })} />
            <DrawerLink label="Persona permissions" onClick={() => setDrawer({ k: "personas" })} />
            {rules.safety && <DrawerLink label="Safety & compliance (Vestige)" onClick={() => setDrawer({ k: "safety" })} />}
          </section>
        </aside>
      </div>

      {dirty && isAdmin && (
        <div className="sticky bottom-20 mt-6 flex flex-wrap items-center gap-3 rounded-[14px] bg-ink py-3 pl-5 pr-3.5 text-white shadow-[0_12px_32px_-12px_rgba(15,23,32,0.5)] lg:bottom-4">
          <span className="flex-1">You have unsaved changes to the autonomy policy.</span>
          <button className="btn h-[38px] border border-[#3A4652] text-white hover:bg-white/10" disabled={saving} onClick={() => setRules(structuredClone(data.rules))}>Discard</button>
          <button className="btn h-[38px] bg-white font-semibold text-ink hover:bg-[#F3F5F6]" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save policy"}</button>
        </div>
      )}

      {drawer?.k === "severity" && sev && (
        <Drawer title="Levels by severity" subtitle={data.meta.steps.find((s) => s.key === drawer.step)?.label} onClose={() => setDrawer(null)}>
          <p className="text-sm text-ink-faint">Use a different autonomy level for faults of a given severity. "Default" follows the step's own level ({shortLevel[sev.level] ?? sev.level}).</p>
          {data.meta.severities.map((sv) => (
            <label key={sv} className="grid grid-cols-[1fr_180px] items-center gap-3 text-sm">{sentence(sv)}
              <select className="input" disabled={!isAdmin} value={sev.by_severity?.[sv] ?? ""} onChange={(e) => {
                const bs = { ...(sev.by_severity || {}) };
                if (e.target.value) bs[sv] = e.target.value; else delete bs[sv];
                setStep(drawer.step!, { by_severity: bs });
              }}>
                <option value="">Default</option>
                {data.meta.levels.map((l) => <option key={l} value={l}>{shortLevel[l] ?? l}</option>)}
              </select>
            </label>
          ))}
        </Drawer>
      )}
      {drawer?.k === "thresholds" && (
        <Drawer title="Thresholds" subtitle="Configurable per customer, like the autonomy levels" onClose={() => setDrawer(null)}>
          {Object.entries(rules.thresholds).map(([k, v]) => (
            <label key={k} className="grid grid-cols-[1fr_110px] items-center gap-3 text-sm">
              <span>{thresholdLabel[k] ?? words(k)}</span>
              <input type="number" min={0} className="input" disabled={!isAdmin} value={v as number}
                onChange={(e) => setRules({ ...rules, thresholds: { ...rules.thresholds, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </Drawer>
      )}
      {drawer?.k === "rollbacks" && (
        <Drawer title="Compensating actions" subtitle="What the orchestrator undoes when a step fails midway, so systems do not drift out of sync" onClose={() => setDrawer(null)}>
          {Object.keys(rules.compensation).map((k) => (
            <label key={k} className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1 accent-route" disabled={!isAdmin} checked={!!rules.compensation[k]}
                onChange={(e) => setRules({ ...rules, compensation: { ...rules.compensation, [k]: e.target.checked } })} />{compensationLabel[k] ?? words(k)}
            </label>
          ))}
        </Drawer>
      )}
      {drawer?.k === "agent" && (
        <Drawer title="Agent permissions" subtitle="Product actions the agent itself may take through the action adapters" onClose={() => setDrawer(null)}>
          <p className="text-sm text-ink-faint">Removing a permission makes that step fail safely and escalate to a person, even if the step is autonomous.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.meta.all_permissions.map((p) => (
              <label key={p} className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={rules.agent_permissions.includes(p)}
                  onChange={(e) => setRules({ ...rules, agent_permissions: e.target.checked ? [...rules.agent_permissions, p] : rules.agent_permissions.filter((x: string) => x !== p) })} />
                <code className="font-mono text-xs">{p}</code>
              </label>
            ))}
          </div>
        </Drawer>
      )}
      {drawer?.k === "personas" && (
        <Drawer title="Persona permissions" subtitle="Agents cannot act outside the permissions of the persona they serve" onClose={() => setDrawer(null)} wide>
          <div className="overflow-x-auto rounded-xl border border-rule">
            <table className="table">
              <thead><tr><th>Product action</th>{data.meta.personas.map((r) => <th key={r} className="text-center">{roleName[r]}</th>)}</tr></thead>
              <tbody>{data.meta.persona_permission_options.map((perm) => (
                <tr key={perm}>
                  <td><code className="font-mono text-xs">{perm}</code></td>
                  {data.meta.personas.map((r) => {
                    const list: string[] = rules.persona_permissions?.[r] ?? [];
                    const all = list.includes("*");
                    return (
                      <td key={r} className="text-center">
                        <input type="checkbox" className="accent-route" aria-label={`${roleName[r]} may ${perm}`} disabled={!isAdmin || all} checked={all || list.includes(perm)}
                          onChange={(e) => setRules({ ...rules, persona_permissions: { ...rules.persona_permissions, [r]: e.target.checked ? [...list, perm] : list.filter((x) => x !== perm) } })} />
                      </td>
                    );
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="text-xs text-ink-faint">Each action needs the agent's own permission and the persona's. Operations admins hold every permission.</p>
        </Drawer>
      )}
      {drawer?.k === "safety" && rules.safety && (
        <Drawer title="Safety & compliance" subtitle="Vestige" onClose={() => setDrawer(null)}>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1 accent-route" disabled={!isAdmin} checked={!!rules.safety.exclude_noncompliant_drivers}
              onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, exclude_noncompliant_drivers: e.target.checked } })} />
            Never propose a driver Vestige marks out of compliance (expired medical card, overdue drug test, suspension; securement training for wheelchair runs)
          </label>
          <fieldset>
            <legend className="label">Also record a vehicle defect for faults on</legend>
            <div className="flex flex-wrap gap-1.5">
              {FAULT_SYSTEMS.map((sys) => (
                <label key={sys} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#E1E4E8] px-2.5 py-1 text-xs">
                  <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={(rules.safety.defect_systems || []).includes(sys)}
                    onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, defect_systems: e.target.checked ? [...(rules.safety.defect_systems || []), sys] : (rules.safety.defect_systems || []).filter((x: string) => x !== sys) } })} />
                  {sys}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="label">…and for any fault at or above</span>
            <select className="input" disabled={!isAdmin} value={rules.safety.defect_min_severity}
              onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, defect_min_severity: e.target.value } })}>
              {data.meta.severities.map((sv) => <option key={sv} value={sv}>{sentence(sv)}</option>)}
            </select>
          </label>
        </Drawer>
      )}
    </>
  );
}
