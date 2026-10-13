import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { User } from "./types";

export interface AuthConfig {
  mode: "local" | "gcip";
  gcip?: { api_key: string; project_id: string; tenants: { gcip_tenant_id: string; tenant_id: string; name: string }[] };
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, gcipTenantId?: string) => Promise<void>;
  logout: () => void;
}

/** Google Cloud Identity Platform: email/password sign-in over its REST API (no SDK), then exchange the ID token. */
async function gcipIdToken(cfg: AuthConfig, email: string, password: string, tenantId?: string): Promise<string> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(cfg.gcip!.api_key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true, ...(tenantId ? { tenantId } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(code.includes("INVALID") || code.includes("EMAIL_NOT_FOUND") ? "Email or password is incorrect." : `Identity Platform: ${code}`);
  }
  return j.idToken as string;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }
    api.get<User>("/api/auth/me").then(setUser).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string, gcipTenantId?: string) => {
    const cfg = await api.get<AuthConfig>("/api/auth/config");
    const r = cfg.mode === "gcip"
      ? await api.post<{ access_token: string; user: User }>("/api/auth/gcip", { id_token: await gcipIdToken(cfg, email, password, gcipTenantId) })
      : await api.post<{ access_token: string; user: User }>("/api/auth/login", { email, password });
    tokenStore.set(r.access_token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
