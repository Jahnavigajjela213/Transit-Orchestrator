import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";

export interface LiveMessage { kind: string; at: string; data: Record<string, any>; }

interface LiveCtx {
  connected: boolean;
  tick: number;           // bumps (debounced) whenever the server reports a change
  last: LiveMessage[];    // recent messages for the activity ticker
}

const Ctx = createContext<LiveCtx>({ connected: false, tick: 0, last: [] });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const [last, setLast] = useState<LiveMessage[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener("hello", () => setConnected(true));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const msg: LiveMessage = JSON.parse(e.data);
        setLast((prev) => [msg, ...prev].slice(0, 40));
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTick((t) => t + 1), 350);
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  return <Ctx.Provider value={{ connected, tick, last }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

/** Fetch data and refetch automatically when the server pushes a change. */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const { tick } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api.get<T>(path);
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { if (tick) load(); }, [tick, load]);

  return { data, error, loading, reload: load, setData };
}
