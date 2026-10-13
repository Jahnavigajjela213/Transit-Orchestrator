import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, type AuthConfig } from "../lib/auth";
import { roleName } from "../lib/format";
import { ErrorNote } from "../components/ui";

interface Demo { email: string; full_name: string; role: string; tenant_name: string; password: string }

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("dispatcher@mvt.demo");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<Demo[]>([]);
  const [cfg, setCfg] = useState<AuthConfig>({ mode: "local" });
  const [gcipTenant, setGcipTenant] = useState("");

  useEffect(() => {
    api.get<AuthConfig>("/api/auth/config").then((c) => {
      setCfg(c);
      if (c.mode === "gcip") { setEmail(""); setPassword(""); setGcipTenant(c.gcip?.tenants[0]?.gcip_tenant_id ?? ""); }
      else api.get<Demo[]>("/api/auth/demo-accounts").then(setDemo).catch(() => {});
    }).catch(() => {});
  }, []);
  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password, cfg.mode === "gcip" ? gcipTenant || undefined : undefined); nav("/"); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  const byTenant = demo.reduce<Record<string, Demo[]>>((acc, d) => ((acc[d.tenant_name] ||= []).push(d), acc), {});

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between bg-rail p-10 text-white lg:flex">
        <div className="font-sign text-lg font-bold">TransitTechOS</div>
        <div>
          <svg viewBox="-6 0 432 60" className="mb-8 w-full max-w-md" aria-hidden>
            <rect x="10" y="27" width="400" height="6" fill="#3FB4AA" />
            {[10, 76, 142, 208, 274, 340, 406].map((x, i) => (
              <circle key={x} cx={x} cy="30" r="9" fill={i < 4 ? "#3FB4AA" : "#22303D"} stroke="#3FB4AA" strokeWidth="4" />
            ))}
          </svg>
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">A fault on one bus, handled across every product.</h1>
          <p className="mt-4 max-w-md text-white/70">
            The orchestrator turns a vehicle health signal into a work order, pulls the bus, covers its runs and tells riders, asking you only where your policy says it should.
          </p>
        </div>
        <p className="text-xs text-white/40">Local build with synthetic agencies, vehicles, drivers and riders.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold">Sign in</h2>
          {cfg.mode === "gcip" && <p className="mt-1 text-sm text-ink-soft">Use your TransitTechOS account (Google Cloud Identity Platform).</p>}
          <form onSubmit={submit} className="mt-5 space-y-3">
            {cfg.mode === "gcip" && (cfg.gcip?.tenants.length ?? 0) > 1 && (
              <label className="block"><span className="label">Agency</span>
                <select className="input" value={gcipTenant} onChange={(e) => setGcipTenant(e.target.value)}>
                  {cfg.gcip!.tenants.map((t) => <option key={t.gcip_tenant_id} value={t.gcip_tenant_id}>{t.name}</option>)}
                </select></label>
            )}
            <label className="block"><span className="label">Email</span>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
            <label className="block"><span className="label">Password</span>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            {error && <ErrorNote message={error} />}
            <button className="btn-primary w-full justify-center py-2" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>

          {demo.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-bold">Demo accounts</h3>
              <p className="text-xs text-ink-soft">Password for all: <code className="rounded bg-white px-1">{demo[0].password}</code>. Pick one to fill the form.</p>
              {Object.entries(byTenant).map(([tenant, rows]) => (
                <div key={tenant} className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-ink-soft">{tenant}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {rows.map((d) => (
                      <button key={d.email} type="button" onClick={() => { setEmail(d.email); setPassword(d.password); }}
                        className={`rounded border px-2.5 py-1.5 text-left text-xs hover:border-route ${email === d.email ? "border-route bg-route-tint" : "border-rule bg-white"}`}>
                        <div className="font-medium">{roleName[d.role] ?? d.role}</div>
                        <div className="truncate text-ink-soft">{d.email}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
