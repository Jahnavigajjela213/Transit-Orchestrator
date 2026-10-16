import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/* Shared pieces of the Focus layout: the side drawer, sandbox mode, and small page parts. */

/** A panel that slides in from the right over the page, so details never take the reader away from where they were. */
export function Drawer({ title, subtitle, onClose, children, wide = false }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <button className="fade-in fixed inset-0 z-[60] cursor-default bg-ink/30" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside role="dialog" aria-modal="true" className={`drawer-in fixed inset-y-0 right-0 z-[61] flex w-full flex-col bg-white shadow-[-20px_0_48px_-16px_rgba(15,23,32,0.25)] ${wide ? "max-w-[720px]" : "max-w-[520px]"}`}>
        <header className="flex items-start gap-3 border-b border-rule px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-faint">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3F5F6] hover:bg-rule" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-8 pt-5">{children}</div>
      </aside>
    </>
  );
}

/** Sandbox is a mode, not a page: switching it on tints the frame and shows the testing tools. Remembered per browser tab. */
const SandboxCtx = createContext<{ on: boolean; set: (v: boolean) => void }>({ on: false, set: () => {} });
export function SandboxProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem("tto_sandbox") === "1"; } catch { return false; } });
  useEffect(() => {
    document.body.classList.toggle("sandbox-mode", on);
    try { sessionStorage.setItem("tto_sandbox", on ? "1" : "0"); } catch { /* storage blocked */ }
  }, [on]);
  return <SandboxCtx.Provider value={{ on, set: setOn }}>{children}</SandboxCtx.Provider>;
}
export const useSandbox = () => useContext(SandboxCtx);

/** Page title block used by the list pages. */
export function Head({ title, intro, actions }: { title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        {intro && <p className="mt-1 text-ink-faint">{intro}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** A quiet row that opens a drawer. */
export function DrawerLink({ label, count, onClick }: { label: string; count?: number | string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between border-b border-rule py-3.5 text-left text-sm hover:text-route">
      <span>{label}{count !== undefined && <span className="text-ink-faint"> · {count}</span>}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9AA3AD" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
    </button>
  );
}

export const kbdCls = "rounded border border-[#E1E4E8] bg-white px-1.5 font-mono text-[11px] text-ink-faint";

/** Standard page frame for the list and settings pages. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[1240px] px-4 py-6 sm:px-10 sm:py-8">{children}</div>;
}
