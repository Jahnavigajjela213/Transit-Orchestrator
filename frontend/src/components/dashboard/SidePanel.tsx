import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";

/** The one open panel lives in the URL (`?panel=key`), so it's linkable and the back button closes it,
 *  the same way any other navigation does. */
export function usePanelParam(): [string | null, (key: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const panel = params.get("panel");
  const set = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("panel", key); else next.delete("panel");
    setParams(next, { replace: !key });
  };
  return [panel, set];
}

/** A slide-over from the right, over a dimmed scrim. Esc, the scrim, or the X close it; focus stays inside while
 *  it's open and returns to whatever opened it when it closes. */
export function SidePanel({ open, onClose, title, description, footer, children, openerRef, wide = false }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; footer?: ReactNode; children: ReactNode;
  openerRef?: React.RefObject<HTMLElement | null>; wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openerRef?.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button type="button" aria-label="Close" tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/45 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-rule bg-white shadow-[-20px_0_48px_-16px_rgba(16,24,40,0.35)] transition-transform duration-200 ${wide ? "sm:w-[720px]" : "sm:w-[min(560px,100%)]"} ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}>
        <div className="flex items-start gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold leading-tight">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-ink-soft">{description}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close panel"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rule-soft text-ink-soft hover:bg-rule hover:text-ink">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-rule px-5 py-3.5">{footer}</div>}
      </div>
    </>
  );
}
