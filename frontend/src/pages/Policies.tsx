import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { dayTime, roleName, sentence, words } from "../lib/format";
import { useToast } from "../components/Toast";
import { ErrorNote, Loading, PageHeader } from "../components/ui";

interface Pol {
  version: number; updated_by: string; updated_at: string; rules: any;
  meta: { name: string; workflow_types: { key: string; name: string }[]; levels: string[]; steps: { key: string; label: string; description: string }[]; roles: string[]; all_permissions: string[]; severities: string[];
    modes: string[]; personas: string[]; persona_permission_options: string[] };
}
interface Readiness { workflow_type: string; step: string; decisions_28d: number; acceptance_pct: number | null; ready: boolean; rule: string }

const WTYPE = "vehicle_health";
const FIXED = ["detect", "assess", "close"];
const levelLabel: Record<string, string> = { autonomous: "Agent acts", semi_autonomous: "Needs approval", informational: "Recommend only", shadow: "Shadow" };
const levelTone: Record<string, string> = { autonomous: "bg-route text-white", semi_autonomous: "bg-signal text-white", informational: "bg-ink-soft text-white", shadow: "bg-route-dark text-white" };
const LEVEL_ORDER = ["autonomous", "semi_autonomous", "informational", "shadow"];
const SEG = "h-8 rounded-[7px] px-3 text-xs transition-colors disabled:cursor-not-allowed";
const FAULT_SYSTEMS = ["Brakes", "Accessibility", "Engine", "Electrical", "Chassis", "Comfort", "Emissions", "Maintenance"];
const thresholdLabel: Record<string, string> = {
  service_window_hours: "Plan cover for runs in the next (hours)",
  pm_high_severity_miles_over: "PM overdue miles that count as high severity",
  max_spare_candidates: "Spare vehicles to offer per run",
  swap_delay_same_depot_min: "Delay when the spare is at the same depot (min)",
  swap_delay_other_depot_min: "Delay when the spare is at another depot (min)",
  delay_applies_within_minutes_of_run_start: "Riders delayed if pickup is within (min of run start)",
};
const compensationLabel: Record<string, string> = {
  restore_vehicle_on_reassign_failure: "Put the vehicle back on the schedule if covering its runs fails",
  cancel_work_order_on_failure: "Cancel the work order if the orchestration cannot finish",
};

export default function Policies() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useData<Pol>(`/api/policies/${WTYPE}`);
  const { data: summary } = useData<{ autonomy_readiness: Readiness[] }>("/api/metrics/summary");
  const [rules, setRules] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [openSev, setOpenSev] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  // Live updates refetch the policy often; only a new saved version (or the first load) replaces what is being edited.
  const [loaded, setLoaded] = useState<number | null>(null);
  useEffect(() => {
    if (data && data.version !== loaded) { setRules(structuredClone(data.rules)); setLoaded(data.version); }
  }, [data, loaded]);
  const isAdmin = user?.role === "admin";

  if (error) return <ErrorNote message={error} />;
  if (!data || !rules) return <Loading />;
  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules);
  const setStep = (k: string, patch: any) => setRules({ ...rules, steps: { ...rules.steps, [k]: { ...rules.steps[k], ...patch } } });
  const mode = rules.mode ?? "live";
  const name = data.meta.workflow_types.find((t) => t.key === WTYPE)?.name ?? data.meta.name;
  const readiness = Object.fromEntries((summary?.autonomy_readiness || []).filter((r) => r.workflow_type === WTYPE).map((r) => [r.step, r]));

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ version: number }>(`/api/policies/${WTYPE}`, { rules });
      toast(`Policy saved as version ${r.version}. New decisions use it straight away.`);
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader eyebrow={`Governance · ${name} · version ${data.version}`} title="Autonomy policy"
        intro="How much the agent may do on its own at each step. Write steps start as needing approval; move them on as trust is earned." />
      {!isAdmin && <p className="-mt-2 text-[13px] text-ink-soft">Only the operations admin can change the policy. Last changed by {data.updated_by} on {dayTime(data.updated_at)}.</p>}

      {/* run mode */}
      <section className="card flex flex-wrap items-center gap-[18px] px-5 py-4">
        <h2 className="text-sm font-semibold">Run mode</h2>
        <div role="radiogroup" aria-label="Run mode" className="flex rounded-[10px] border border-rule p-[3px]">
          {(data.meta.modes.length ? data.meta.modes : ["live", "shadow"]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!isAdmin} onClick={() => setRules({ ...rules, mode: m })}
              className={`${SEG} ${mode === m ? "bg-route text-white" : "text-ink-soft"}`}>
              {m === "live" ? "Live" : "Shadow"}
            </button>
          ))}
        </div>
        <p className="min-w-[280px] flex-1 text-[13px] text-ink-soft">
          {mode === "shadow"
            ? "Shadow: the agent works out what it would do at every step and records it, but takes no action. People keep working in the products and Shadow mode compares the two."
            : "Live: each step follows the level set below."}
        </p>
      </section>

      {/* steps */}
      <section className="card overflow-x-auto">
        <div className="grid min-w-[820px] grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] gap-3.5 border-b border-rule bg-panel px-5 py-3 text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          <span /><span>Step</span><span>Level</span><span>Who approves</span><span />
        </div>
        {data.meta.steps.map((s, i) => {
          const cfg = rules.steps[s.key] || {};
          const fixed = FIXED.includes(s.key);
          const rd = readiness[s.key];
          const levels = LEVEL_ORDER.filter((l) => data.meta.levels.includes(l) && (l !== "shadow" || cfg.level === "shadow"));
          return (
            <div key={s.key} className="min-w-[820px] border-b border-rule-soft last:border-b-0">
              <div className="grid grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_120px] items-center gap-3.5 px-5 py-3.5">
                <span className="font-mono text-xs text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block font-semibold">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{s.description}</span>
                  {rd?.ready && cfg.level !== "autonomous" && (
                    <span className="mt-1.5 block w-fit rounded-lg bg-go-tint px-2.5 py-1.5 text-left text-[12px] leading-snug text-go">
                      {rd.acceptance_pct}% approved unchanged in 28 days ({rd.decisions_28d} decisions) · ready for Agent acts
                    </span>
                  )}
                </span>
                {fixed ? <span className="text-[12.5px] text-ink-soft">Always automatic</span> : (
                  <div role="radiogroup" aria-label={s.label} className="flex w-fit flex-wrap rounded-[10px] border border-rule p-[3px]">
                    {levels.map((l) => (
                      <button key={l} type="button" role="radio" aria-checked={cfg.level === l} disabled={!isAdmin} onClick={() => setStep(s.key, { level: l })}
                        className={`${SEG} ${cfg.level === l ? levelTone[l] : "text-ink-soft"}`}>{levelLabel[l] ?? sentence(l)}</button>
                    ))}
                  </div>
                )}
                <span className="text-[12.5px] text-[#24323C]">{fixed ? "—" : (cfg.approver_roles || []).map((r: string) => roleName[r] ?? r).join(" or ") || "—"}</span>
                {fixed ? <span /> : (
                  <button type="button" onClick={() => setOpenSev(openSev === s.key ? null : s.key)} aria-expanded={openSev === s.key}
                    className="h-8 rounded-lg border border-rule bg-white text-xs text-ink-soft">{openSev === s.key ? "Hide severity" : "By severity"}</button>
                )}
              </div>
              {!fixed && openSev === s.key && (
                <div className="flex flex-wrap gap-2.5 pb-4 pl-[74px] pr-5">
                  {data.meta.severities.map((sev) => (
                    <label key={sev} className="flex flex-col gap-1 text-[11.5px] text-ink-soft">{sentence(sev)}
                      <select disabled={!isAdmin} value={cfg.by_severity?.[sev] ?? ""} aria-label={`${s.label} for ${sev}`}
                        className="h-[34px] rounded-lg border border-rule bg-white px-2 text-[12.5px] text-ink"
                        onChange={(e) => {
                          const bs = { ...(cfg.by_severity || {}) };
                          if (e.target.value) bs[sev] = e.target.value; else delete bs[sev];
                          setStep(s.key, { by_severity: bs });
                        }}>
                        <option value="">Default</option>
                        {data.meta.levels.map((l) => <option key={l} value={l}>{levelLabel[l] ?? sentence(l)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* everything else, on request */}
      <section className="card overflow-hidden">
        <button type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} className="flex w-full items-center gap-2 px-5 py-4 text-left">
          <span className="flex-1">
            <span className="block text-sm font-semibold">Advanced settings</span>
            <span className="mt-0.5 block text-xs text-ink-soft">Approvers and personas per step, thresholds, rollback, agent and persona permissions, safety rules</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-ink-faint transition-transform ${advanced ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {advanced && <Advanced data={data} rules={rules} setRules={setRules} setStep={setStep} isAdmin={isAdmin} />}
      </section>

      {dirty && (
        <footer className="sticky bottom-0 z-10 -mx-8 -mb-[26px] flex items-center gap-3 border-t border-rule bg-white px-8 py-3.5">
          <span className="flex-1 text-[13px] text-ink-soft">Unsaved changes · new decisions use the policy as soon as it is saved, and the change is written to the audit log.</span>
          <button type="button" onClick={() => setRules(structuredClone(data.rules))} disabled={saving} className="h-[42px] rounded-[10px] border border-rule bg-white px-4">Discard</button>
          <button type="button" onClick={save} disabled={saving || !isAdmin} className="h-[42px] rounded-[10px] bg-route px-[18px] font-semibold text-white hover:bg-route-dark disabled:opacity-50">
            {saving ? "Saving…" : `Save as version ${data.version + 1}`}
          </button>
        </footer>
      )}
    </>
  );
}

function Sub({ title, children, note, wide = true }: { title: string; children: React.ReactNode; note?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border border-rule bg-white p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="mb-3 text-[13px] font-semibold">{title}</h3>
      {children}
      {note && <p className="mt-3 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

function Advanced({ data, rules, setRules, setStep, isAdmin }: { data: Pol; rules: any; setRules: (r: any) => void; setStep: (k: string, p: any) => void; isAdmin: boolean }) {
  const steps = data.meta.steps.filter((s) => !FIXED.includes(s.key));
  return (
    <div className="grid grid-cols-1 gap-4 border-t border-rule bg-panel p-4 lg:grid-cols-2">
      <Sub title="Approvers and personas" note="Operations admins can decide any step. When a person approves, the agent acts with that person's permissions; when it acts on its own it uses the persona chosen here.">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Step</th><th>Who approves</th><th>Agent acts for</th></tr></thead>
            <tbody>
              {steps.map((s) => {
                const cfg = rules.steps[s.key] || {};
                return (
                  <tr key={s.key}>
                    <td className="font-medium">{s.label}</td>
                    <td>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {data.meta.roles.filter((r) => r !== "admin").map((r) => (
                          <label key={r} className="inline-flex items-center gap-1.5 text-xs">
                            <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={(cfg.approver_roles || []).includes(r)}
                              onChange={(e) => setStep(s.key, { approver_roles: e.target.checked ? [...(cfg.approver_roles || []), r] : (cfg.approver_roles || []).filter((x: string) => x !== r) })} />
                            {roleName[r]}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <select className="input w-40" disabled={!isAdmin} value={cfg.acts_as ?? ""} aria-label={`${s.label} acts for`} onChange={(e) => setStep(s.key, { acts_as: e.target.value })}>
                        {data.meta.personas.filter((r) => r !== "viewer").map((r) => <option key={r} value={r}>{roleName[r]}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sub>

      <Sub title="Thresholds" wide={false}>
          <div className="grid gap-2.5">
            {Object.entries(rules.thresholds).map(([k, v]) => (
              <label key={k} className="grid grid-cols-[1fr_110px] items-center gap-3 text-[13px]">
                <span>{thresholdLabel[k] ?? sentence(words(k))}</span>
                <input type="number" min={0} className="input" disabled={!isAdmin} value={v as number}
                  onChange={(e) => setRules({ ...rules, thresholds: { ...rules.thresholds, [k]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
      </Sub>
      <Sub title="When a step fails" wide={false}>
          <div className="space-y-2 text-[13px]">
            {Object.keys(rules.compensation).map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-route" disabled={!isAdmin} checked={!!rules.compensation[k]}
                  onChange={(e) => setRules({ ...rules, compensation: { ...rules.compensation, [k]: e.target.checked } })} />
                {compensationLabel[k] ?? sentence(words(k))}
              </label>
            ))}
          </div>
      </Sub>

      <Sub title="What the agent may do in products" note="Removing a permission makes that step fail safely and escalate to a person, even if the step is set to Agent acts.">
        <div className="grid gap-1 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
          {data.meta.all_permissions.map((p) => (
            <label key={p} className="inline-flex items-center gap-2">
              <input type="checkbox" className="accent-route" disabled={!isAdmin} checked={rules.agent_permissions.includes(p)}
                onChange={(e) => setRules({ ...rules, agent_permissions: e.target.checked ? [...rules.agent_permissions, p] : rules.agent_permissions.filter((x: string) => x !== p) })} />
              <span className="text-[13px]">{actionName(p)}</span>
            </label>
          ))}
        </div>
      </Sub>

      <Sub title="What each persona may do" note="The agent never does more than the person it acts for: each action needs the agent's permission above and the persona's permission here. Operations admins hold every permission.">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Product action</th>{data.meta.personas.map((r) => <th key={r} className="text-center">{roleName[r]}</th>)}</tr></thead>
            <tbody>
              {data.meta.persona_permission_options.map((perm) => (
                <tr key={perm}>
                  <td className="text-[13px]">{actionName(perm)}</td>
                  {data.meta.personas.map((r) => {
                    const list: string[] = rules.persona_permissions?.[r] ?? [];
                    const all = list.includes("*");
                    return (
                      <td key={r} className="text-center">
                        <input type="checkbox" className="accent-route" aria-label={`${roleName[r]} may ${actionName(perm)}`} disabled={!isAdmin || all} checked={all || list.includes(perm)}
                          onChange={(e) => setRules({ ...rules, persona_permissions: { ...rules.persona_permissions, [r]: e.target.checked ? [...list, perm] : list.filter((x) => x !== perm) } })} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      {rules.safety && (
        <Sub title="Safety & compliance (Vestige)">
          <div className="grid gap-4 text-[13px] md:grid-cols-3">
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
        </Sub>
      )}
    </div>
  );
}

// Permissions are stored as "product.action" keys; people read them as "Cancel work order · FASTER".
const PRODUCT_NAME: Record<string, string> = {
  asset_mgmt: "FASTER", trip_mgmt: "TripMaster", workforce: "Bytecurve", safety: "Vestige", rider_comms: "TripShot", telematics: "Telematics",
};
function actionName(key: string): string {
  const [product, action = ""] = key.split(".");
  const words = action.replace(/_/g, " ").replace("eta", "ETA");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} · ${PRODUCT_NAME[product] ?? product.replace(/_/g, " ")}`;
}
