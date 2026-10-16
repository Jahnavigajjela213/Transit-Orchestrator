import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Inbox, ShieldCheck, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, type AuthConfig } from "../lib/auth";
import { roleName } from "../lib/format";
import { ErrorNote } from "../components/ui";

interface Demo { email: string; full_name: string; role: string; tenant_name: string; password: string }

const STATIONS = ["Detect", "Assess", "Open work order", "Pull vehicle", "Reassign runs", "Notify riders", "Return to service"];
const PRODUCTS: [string, string][] = [["FASTER", "#F59E0B"], ["Ecolane", "#3FC1B0"], ["Bytecurve", "#8B9CFF"], ["Vestige", "#FF7A6B"], ["TripShot", "#C792EA"]];
const ROLE_INFO: Record<string, { icon: any; does: string }> = {
  dispatcher: { icon: Inbox, does: "Approves or overrides agent actions" },
  shop_manager: { icon: Wrench, does: "Approves and closes work orders" },
  admin: { icon: ShieldCheck, does: "Owns the autonomy policy" },
  viewer: { icon: ClipboardList, does: "Reads the decision audit log" },
};
const ROLE_ORDER = ["dispatcher", "shop_manager", "admin", "viewer"];
// persona-based views: each role lands where its work is
const landing: Record<string, string> = { dispatcher: "/", admin: "/", shop_manager: "/work-orders", viewer: "/overview" };

// One ride along the line every 14 s: station i lights up in turn, the bus moves, then the line resets.
const CYCLE = 14;
const rideCss = `
@keyframes ride-fill { 0% { width: 0%; } 78% { width: 100%; } 94% { width: 100%; opacity: 1; } 100% { width: 100%; opacity: 0; } }
@keyframes ride-bus { 0% { left: 0%; } 78% { left: 100%; } 94% { left: 100%; opacity: 1; } 100% { left: 100%; opacity: 0; } }
${STATIONS.map((_, i) => {
  const at = ((i / (STATIONS.length - 1)) * 78).toFixed(1);
  return `@keyframes lit-${i} { 0%, ${at}% { background: #0F1720; border-color: #3A4652; box-shadow: none; } ${(+at + 1).toFixed(1)}%, 94% { background: #3FC1B0; border-color: #3FC1B0; box-shadow: 0 0 0 6px rgba(63,193,176,0.18); } 100% { background: #0F1720; border-color: #3A4652; } }
.lit-${i} { animation: lit-${i} ${CYCLE}s ease-out infinite; }`;
}).join("\n")}
.ride-fill { animation: ride-fill ${CYCLE}s linear infinite; }
.ride-bus { animation: ride-bus ${CYCLE}s linear infinite; }
@keyframes float-card { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.float-card { animation: float-card 6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .ride-fill, .ride-bus, .float-card, ${STATIONS.map((_, i) => `.lit-${i}`).join(", ")} { animation: none; }
  .ride-fill { width: 55%; } .ride-bus { left: 55%; }
}`;

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("dispatcher@lsp.demo");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo[]>([]);
  const [agency, setAgency] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AuthConfig>({ mode: "local" });
  const [gcipTenant, setGcipTenant] = useState("");

  useEffect(() => {
    api.get<AuthConfig>("/api/auth/config").then((c) => {
      setCfg(c);
      if (c.mode === "gcip") { setEmail(""); setPassword(""); setGcipTenant(c.gcip?.tenants[0]?.gcip_tenant_id ?? ""); }
      else api.get<Demo[]>("/api/auth/demo-accounts").then((d) => { setDemo(d); setAgency((a) => a ?? d.find((x) => x.email === email)?.tenant_name ?? d[0]?.tenant_name ?? null); }).catch(() => {});
    }).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const agencies = useMemo(() => [...new Set(demo.map((d) => d.tenant_name))], [demo]);
  const accounts = demo.filter((d) => d.tenant_name === agency).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const chosen = demo.find((d) => d.email === email);

  if (user) return <Navigate to={landing[user.role] ?? "/"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password, cfg.mode === "gcip" ? gcipTenant || undefined : undefined); nav(landing[chosen?.role ?? ""] ?? "/"); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      <style>{rideCss}</style>

      {/* the story, told by the line itself */}
      <section aria-label="About TransitTechOS" className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white">
            <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#0F1720" /><circle cx="23" cy="16" r="3.5" fill="#0F1720" /><rect x="9" y="14.5" width="14" height="3" fill="#0F1720" /></svg>
          </span>
          <span className="text-[17px] font-semibold tracking-tight">TransitTechOS</span>
        </div>

        <div className="relative">
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#3FC1B0]">Agentic cross-product orchestration</p>
          <h1 className="max-w-[540px] text-[44px] font-semibold leading-[1.08] tracking-[-0.025em]">Vehicle Health to Service Continuity, across every product.</h1>
          <p className="mt-5 max-w-[480px] text-[17px] leading-relaxed text-white/65">
            A signal in one product triggers a coordinated, governed response across the others: a work order, the vehicle pulled, runs reassigned, riders notified. Operators approve or override where the autonomy policy says, and every step is written to the audit log.
          </p>

          <div className="relative mt-12 max-w-[560px] pr-6" aria-hidden>
            <div className="relative h-[22px]">
              <span className="absolute left-[11px] right-[11px] top-[9px] h-1 rounded-full bg-[#2A3540]" />
              <span className="absolute left-[11px] right-[11px] top-[9px] h-1">
                <span className="ride-fill block h-full rounded-full bg-[#3FC1B0]" />
                <span className="ride-bus absolute -top-[13px] -ml-[15px] flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white shadow-[0_6px_20px_-4px_rgba(63,193,176,0.6)]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#0F1720" strokeWidth="2" strokeLinecap="round"><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16M8 21v-3M16 21v-3" /></svg>
                </span>
              </span>
              <div className="absolute inset-0 flex justify-between">
                {STATIONS.map((s, i) => <span key={s} className={`lit-${i} relative h-[22px] w-[22px] rounded-full border-[3px] border-[#3A4652] bg-ink`} />)}
              </div>
            </div>
            <div className="mt-3 flex h-8 justify-between text-[11px] leading-tight text-white/55">
              {STATIONS.map((s) => <span key={s} className="relative w-[22px]"><span className="absolute left-1/2 w-[70px] -translate-x-1/2 text-center">{s}</span></span>)}
            </div>

            <div className="float-card relative ml-[24%] mt-9 w-[270px] rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F5B547]"><span className="h-2 w-2 rounded-full bg-[#F5B547]" />Approval · step 3 of 7</div>
              <div className="mt-2 text-[15px] font-semibold leading-snug">Open a work order for <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[13px] text-ink">P-223</span>?</div>
              <div className="mt-3 flex gap-2">
                <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink">Approve</span>
                <span className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80">Override</span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/55">
          <span>Action adapters for</span>
          {PRODUCTS.map(([n, c]) => <span key={n} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{n}</span>)}
        </div>
      </section>

      {/* sign in */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink">
              <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden><circle cx="9" cy="16" r="3.5" fill="#fff" /><circle cx="23" cy="16" r="3.5" fill="#fff" /><rect x="9" y="14.5" width="14" height="3" fill="#fff" /></svg>
            </span>
            <span className="text-[17px] font-semibold">TransitTechOS</span>
          </div>
          <h2 className="text-[30px] font-semibold tracking-[-0.02em]">Welcome back</h2>
          <p className="mt-1.5 text-ink-faint">{cfg.mode === "gcip" ? "Sign in with your TransitTechOS account." : "Choose who you are for this demo, or type an account."}</p>

          {demo.length > 0 && (
            <div className="mt-7">
              {agencies.length > 1 && (
                <div className="seg mb-3 w-full" role="radiogroup" aria-label="Agency">
                  {agencies.map((a) => (
                    <button key={a} type="button" role="radio" aria-checked={agency === a} className="flex-1"
                      onClick={() => { setAgency(a); const first = demo.find((d) => d.tenant_name === a && d.role === (chosen?.role ?? "dispatcher")); if (first) { setEmail(first.email); setPassword(first.password); } }}>
                      {a}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Demo account">
                {accounts.map((d) => {
                  const info = ROLE_INFO[d.role] ?? { icon: Inbox, does: "" };
                  const on = email === d.email;
                  return (
                    <button key={d.email} type="button" role="radio" aria-checked={on} onClick={() => { setEmail(d.email); setPassword(d.password); }}
                      className={`flex flex-col items-start gap-2 rounded-[14px] border p-3.5 text-left transition-all ${on ? "border-ink shadow-[inset_0_0_0_1px_#0F1720,0_8px_20px_-12px_rgba(15,23,32,0.35)]" : "border-[#E1E4E8] hover:border-[#B9C0C7]"}`}>
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${on ? "bg-ink text-white" : "bg-[#F3F5F6] text-ink-soft"}`}><info.icon className="h-4 w-4" aria-hidden /></span>
                      <span className="text-sm font-semibold">{roleName[d.role] ?? d.role}</span>
                      <span className="text-xs leading-snug text-ink-faint">{info.does}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={submit} className="mt-7 space-y-3.5">
            {cfg.mode === "gcip" && (cfg.gcip?.tenants.length ?? 0) > 1 && (
              <label className="block"><span className="label">Agency</span>
                <select className="input h-11" value={gcipTenant} onChange={(e) => setGcipTenant(e.target.value)}>
                  {cfg.gcip!.tenants.map((t) => <option key={t.gcip_tenant_id} value={t.gcip_tenant_id}>{t.name}</option>)}
                </select></label>
            )}
            <label className="block"><span className="label">Email</span>
              <input className="input h-11" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
            <label className="block"><span className="label">Password</span>
              <input className="input h-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            {error && <ErrorNote message={error} />}
            <button className="btn-primary h-12 w-full text-[15px]" disabled={busy}>
              {busy ? "Signing in…" : <>Sign in{chosen ? ` as ${roleName[chosen.role]?.toLowerCase() ?? chosen.role}` : ""} <ArrowRight className="h-4 w-4" aria-hidden /></>}
            </button>
          </form>
          {demo.length > 0 && <p className="mt-4 text-center text-xs text-ink-faint">Demo password for every account: <code className="rounded bg-[#F3F5F6] px-1 font-mono">{demo[0].password}</code></p>}
          <p className="mt-10 text-center text-xs text-ink-faint">Local build with synthetic agencies, vehicles, drivers and riders.</p>
        </div>
      </section>
    </div>
  );
}
