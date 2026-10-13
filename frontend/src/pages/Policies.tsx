import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, roleName, sentence, words } from "../lib/format";
import { useToast } from "../components/Toast";
import { ErrorNote, Loading, PageHeader, Section } from "../components/ui";

interface Pol {
  version: number; updated_by: string; updated_at: string; rules: any;
  meta: { name: string; workflow_types: { key: string; name: string }[]; levels: string[]; steps: { key: string; label: string; description: string }[]; roles: string[]; all_permissions: string[]; severities: string[];
    modes: string[]; personas: string[]; persona_permission_options: string[] };
}

const levelLabel: Record<string, string> = { informational: "Recommend only", shadow: "Shadow (record, don't act)", semi_autonomous: "Needs approval", autonomous: "Agent acts" };
const shortLabel: Record<string, string> = { informational: "Recommend", shadow: "Shadow", semi_autonomous: "Approval", autonomous: "Agent acts" };
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

export default function Policies() {
  const { user } = useAuth();
  const toast = useToast();
  const [wtype, setWtype] = useState("vehicle_health");
  const { data, error, reload } = useData<Pol>(`/api/policies/${wtype}`, [wtype]);
  const [rules, setRules] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setRules(structuredClone(data.rules)); }, [data]);
  const isAdmin = user?.role === "admin";

  if (error) return <ErrorNote message={error} />;
  if (!data || !rules) return <Loading />;
  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules);
  const setStep = (k: string, patch: any) => setRules({ ...rules, steps: { ...rules.steps, [k]: { ...rules.steps[k], ...patch } } });

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ version: number }>(`/api/policies/${wtype}`, { rules });
      toast(`Policy saved as version ${r.version}. New decisions use it straight away.`);
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Autonomy policy" intro={<>How much the agent may do on its own at each step, for {user?.tenant_name}. Version {data.version}, last changed by {data.updated_by} on {dayTime(data.updated_at)}.</>}
        actions={isAdmin && <>
          <button className="btn-quiet" disabled={!dirty || saving} onClick={() => setRules(structuredClone(data.rules))}>Discard changes</button>
          <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save policy"}</button>
        </>} />
      <div className="flex gap-1 border-b border-rule" role="tablist">
        {data.meta.workflow_types.map((t) => (
          <button key={t.key} role="tab" aria-selected={wtype === t.key} onClick={() => { setRules(null); setWtype(t.key); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${wtype === t.key ? "border-route text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{t.name}</button>
        ))}
      </div>
      {!isAdmin && <p className="text-sm text-ink-soft">Only the operations admin can change the policy. You can see the current rules below.</p>}

      <Section title="Run mode">
        <div className="flex flex-wrap items-center gap-4 p-4 text-sm">
          <div className="inline-flex overflow-hidden rounded-sm border border-rule" role="radiogroup" aria-label="Run mode">
            {data.meta.modes.map((m) => (
              <button key={m} role="radio" aria-checked={(rules.mode ?? "live") === m} disabled={!isAdmin} onClick={() => setRules({ ...rules, mode: m })}
                className={`px-4 py-1.5 text-sm ${(rules.mode ?? "live") === m ? (m === "shadow" ? "bg-route text-white" : "bg-go text-white") : "bg-white hover:bg-paper"}`}>
                {m === "live" ? "Live" : "Shadow"}
              </button>
            ))}
          </div>
          <p className="max-w-3xl flex-1 text-ink-soft">
            {(rules.mode ?? "live") === "shadow"
              ? "Shadow: the agent works out exactly what it would do at every step and records it, but takes no action and asks no one. People keep working in the products; the Shadow mode screen compares the two and measures your baseline."
              : "Live: each step follows the level set below."}
          </p>
        </div>
      </Section>

      <Section title="Steps">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Step</th><th>Default level</th>{wtype === "vehicle_health" && <th>By severity</th>}<th>Who approves</th><th>Agent acts for</th></tr></thead>
            <tbody>
              {data.meta.steps.map((s) => {
                const cfg = rules.steps[s.key] || {};
                const fixed = s.key === "detect" || s.key === "assess" || s.key === "close";
                return (
                  <tr key={s.key}>
                    <td><div className="font-sign font-bold">{s.label}</div><div className="text-2xs text-ink-soft">{s.description}</div></td>
                    <td>
                      {fixed ? <span className="text-xs text-ink-soft">Always automatic</span> : (
                        <select className="input w-40" disabled={!isAdmin} value={cfg.level} onChange={(e) => setStep(s.key, { level: e.target.value })} aria-label={`${s.label} level`}>
                          {data.meta.levels.map((l) => <option key={l} value={l}>{levelLabel[l]}</option>)}
                        </select>
                      )}
                    </td>
                    {wtype === "vehicle_health" && <td>
                      {!fixed && (
                        <div className="flex flex-wrap gap-1.5">
                          {data.meta.severities.map((sev) => (
                            <label key={sev} className="flex flex-col text-2xs text-ink-soft">{sentence(sev)}
                              <select className="input w-28 py-1 text-xs" disabled={!isAdmin} value={cfg.by_severity?.[sev] ?? ""} aria-label={`${s.label} for ${sev}`}
                                onChange={(e) => {
                                  const bs = { ...(cfg.by_severity || {}) };
                                  if (e.target.value) bs[sev] = e.target.value; else delete bs[sev];
                                  setStep(s.key, { by_severity: bs });
                                }}>
                                <option value="">Default</option>
                                {data.meta.levels.map((l) => <option key={l} value={l}>{shortLabel[l]}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                    </td>}
                    <td>
                      {!fixed && (
                        <div className="flex flex-col gap-0.5">
                          {data.meta.roles.filter((r) => r !== "admin").map((r) => (
                            <label key={r} className="inline-flex items-center gap-1.5 text-xs">
                              <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={(cfg.approver_roles || []).includes(r)}
                                onChange={(e) => setStep(s.key, { approver_roles: e.target.checked ? [...(cfg.approver_roles || []), r] : (cfg.approver_roles || []).filter((x: string) => x !== r) })} />
                              {roleName[r]}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {!fixed && (
                        <select className="input w-36" disabled={!isAdmin} value={cfg.acts_as ?? ""} aria-label={`${s.label} acts for`}
                          onChange={(e) => setStep(s.key, { acts_as: e.target.value })}>
                          {data.meta.personas.filter((r) => r !== "viewer").map((r) => <option key={r} value={r}>{roleName[r]}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Operations admins can decide any step. Start write steps at "Needs approval" (or "Shadow" before go-live) and move them to "Agent acts" once acceptance on the Overview stays high. When a person approves a step the agent acts with that person's permissions; when it acts on its own it uses the "Agent acts for" persona.</p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Thresholds">
          <div className="grid gap-3 p-4">
            {Object.entries(rules.thresholds).map(([k, v]) => (
              <label key={k} className="grid grid-cols-[1fr_110px] items-center gap-3 text-sm">
                <span>{thresholdLabel[k] ?? words(k)}</span>
                <input type="number" min={0} className="input" disabled={!isAdmin} value={v as number}
                  onChange={(e) => setRules({ ...rules, thresholds: { ...rules.thresholds, [k]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
        </Section>
        <div className="space-y-5">
          <Section title="When a step fails">
            <div className="space-y-2 p-4 text-sm">
              {Object.keys(rules.compensation).map((k) => [k, compensationLabel[k] ?? words(k)]).map(([k, l]) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 accent-route" disabled={!isAdmin} checked={!!rules.compensation[k]}
                    onChange={(e) => setRules({ ...rules, compensation: { ...rules.compensation, [k]: e.target.checked } })} />{l}
                </label>
              ))}
            </div>
          </Section>
          <Section title="What the agent may do in products">
            <div className="grid gap-1 p-4 text-sm sm:grid-cols-2">
              {data.meta.all_permissions.map((p) => (
                <label key={p} className="inline-flex items-center gap-2">
                  <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={rules.agent_permissions.includes(p)}
                    onChange={(e) => setRules({ ...rules, agent_permissions: e.target.checked ? [...rules.agent_permissions, p] : rules.agent_permissions.filter((x: string) => x !== p) })} />
                  <code className="text-xs">{p}</code>
                </label>
              ))}
            </div>
            <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Removing a permission makes that step fail safely and escalate to a person, even if the step is set to "Agent acts".</p>
          </Section>
        </div>
      </div>

      <Section title="What each persona may do">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Product action</th>{data.meta.personas.map((r) => <th key={r} className="text-center">{roleName[r]}</th>)}</tr></thead>
            <tbody>
              {data.meta.persona_permission_options.map((perm) => (
                <tr key={perm}>
                  <td><code className="text-xs">{perm}</code></td>
                  {data.meta.personas.map((r) => {
                    const list: string[] = rules.persona_permissions?.[r] ?? [];
                    const all = list.includes("*");
                    return (
                      <td key={r} className="text-center">
                        <input type="checkbox" className="accent-route" aria-label={`${roleName[r]} may ${perm}`} disabled={!isAdmin || all}
                          checked={all || list.includes(perm)}
                          onChange={(e) => setRules({ ...rules, persona_permissions: { ...rules.persona_permissions,
                            [r]: e.target.checked ? [...list, perm] : list.filter((x) => x !== perm) } })} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">The agent never does more than the person it acts for: each action needs the agent's own permission above <em>and</em> the persona's permission here. Operations admins hold every permission.</p>
      </Section>

      {wtype === "vehicle_health" && rules.safety && (
        <Section title="Safety & compliance (Vestige)">
          <div className="grid gap-4 p-4 text-sm md:grid-cols-3">
            <fieldset>
              <legend className="label">Also record a vehicle defect in Vestige for faults on</legend>
              <div className="grid grid-cols-2 gap-1">
                {FAULT_SYSTEMS.map((sys) => (
                  <label key={sys} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={(rules.safety.defect_systems || []).includes(sys)}
                      onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, defect_systems: e.target.checked
                        ? [...(rules.safety.defect_systems || []), sys] : (rules.safety.defect_systems || []).filter((x: string) => x !== sys) } })} />
                    {sys}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block"><span className="label">…and for any fault at or above</span>
              <select className="input" disabled={!isAdmin} value={rules.safety.defect_min_severity}
                onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, defect_min_severity: e.target.value } })}>
                {data.meta.severities.map((sev) => <option key={sev} value={sev}>{sentence(sev)}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-route" disabled={!isAdmin} checked={!!rules.safety.exclude_noncompliant_drivers}
                onChange={(e) => setRules({ ...rules, safety: { ...rules.safety, exclude_noncompliant_drivers: e.target.checked } })} />
              Never propose a driver Vestige marks out of compliance (expired medical card, overdue drug test, suspension; securement training for wheelchair runs)
            </label>
          </div>
        </Section>
      )}
    </div>
  );
}
