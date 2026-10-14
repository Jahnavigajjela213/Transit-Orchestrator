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
        if (msg.kind !== "sync") setLast((prev) => [msg, ...prev].slice(0, 40));  // sync = data reached Databricks: reload only
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTick((t) => t + 1), 350);
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  return <Ctx.Provider value={{ connected, tick, last }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Fetch data and refetch automatically when the server pushes a change.
 *  A tab in the background does not refetch: it remembers that data changed and refetches once when shown again.
 *  Refetches never overlap: changes that arrive during a load trigger one more load after it. */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const { tick } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const again = useRef(false);  // a change arrived while loading, or while the tab was hidden
  const latest = useRef<() => Promise<void>>(async () => {});  // the load for the current path and filters

  const load = useCallback(async () => {
    if (!path) return;
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    try {
      const d = await api.get<T>(path);
      setData(d);
      setError(null);
    } catch (e: any) {
      setData(null);  // show the error, never stale rows
      setError(e.message);
    } finally {
      setLoading(false);
      inFlight.current = false;
      if (again.current && !hidden()) { again.current = false; latest.current(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  latest.current = load;

  useEffect(() => { setLoading(true); load(); }, [load]);  // during another load this queues one more, with the new path
  useEffect(() => {
    if (!tick) return;
    if (hidden()) again.current = true;
    else load();
  }, [tick, load]);
  useEffect(() => {
    const onShow = () => { if (!hidden() && again.current) { again.current = false; load(); } };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
