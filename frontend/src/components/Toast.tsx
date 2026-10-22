import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

type Toast = { id: number; text: string; tone: "ok" | "error"; leaving: boolean };
const Ctx = createContext<(text: string, tone?: "ok" | "error") => void>(() => {});

const SHOW_MS = { ok: 4000, error: 7000 };
const EXIT_MS = 300;

/** Toasts sit top right, under the top bar: each slides in, stays a few seconds, then slides out. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((x) => x.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), EXIT_MS);
  }, []);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone, leaving: false }]);
    setTimeout(() => dismiss(id), SHOW_MS[tone]);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-[68px] z-[60] flex flex-col items-end gap-2">
        {items.map((t) => <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </Ctx.Provider>
  );
}

function ToastCard({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  const ok = t.tone === "ok";
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div role={ok ? "status" : "alert"}
      className={`pointer-events-auto flex w-fit max-w-[min(300px,calc(100vw-32px))] items-start gap-2 rounded-xl border bg-white py-2.5 pl-3 pr-1.5 text-[12.5px] leading-snug text-ink shadow-[0_12px_32px_-12px_rgba(16,24,40,0.35)] ${t.leaving ? "toast-out" : "toast-in"} ${ok ? "border-l-[3px] border-rule border-l-go" : "border-l-[3px] border-stop/40 border-l-stop"}`}>
      <Icon className={`mt-px h-4 w-4 shrink-0 ${ok ? "text-go" : "text-stop"}`} aria-hidden />
      <span className="min-w-0 flex-1">{t.text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="-my-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-panel hover:text-ink">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export const useToast = () => useContext(Ctx);
