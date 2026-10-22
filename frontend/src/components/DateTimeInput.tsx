import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KE } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/** Date and time in the app's own look, in place of the browser's datetime-local popup. Value is "YYYY-MM-DDTHH:mm" (local), same as the native input.
 *  Pick a day on the calendar and a small time card opens beside that day, pointing at it, with hour and minute wheels.
 *  The calendar stays in view, so the day can still be changed. Nothing is saved until "Set". */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toValue = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = (v: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);
const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ROW = 34; // px per wheel row
const SHOWN = 5; // rows visible, the middle one is the choice
const GAP = 10; // between the calendar and the time card

type Pos = { top: number; arrow: number; side: "right" | "left" | "over" };

export function DateTimeInput({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  const sel = parse(value);
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => sel ?? new Date());
  const [month, setMonth] = useState(() => { const d = sel ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [up, setUp] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const calRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const start = () => {
    const d = sel ?? new Date(new Date().setSeconds(0, 0));
    setDraft(d); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setTimeOpen(false); setOpen(true);
  };
  const close = () => { setOpen(false); setTimeOpen(false); };
  const commit = () => { onChange(toValue(draft)); close(); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    // Esc steps back: first the time card, then the calendar.
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (timeOpen) setTimeOpen(false); else close(); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open, timeOpen]);

  // The calendar opens upward when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setUp(window.innerHeight - r.bottom < 360 && r.top > 360);
  }, [open]);

  // Place the time card beside the chosen day: on the right when it fits, else the left, else over the calendar (phones).
  // Its pointer lines up with the day; the card itself stays within the calendar's height.
  useLayoutEffect(() => {
    if (!timeOpen || !calRef.current || !timeRef.current) { setPos(null); return; }
    const cal = calRef.current, card = timeRef.current;
    const cell = cal.querySelector<HTMLElement>(`[data-day="${ymd(draft)}"]`);
    const anchor = cell ? cell.offsetTop + cell.offsetHeight / 2 : cal.offsetHeight / 2;
    const top = Math.max(0, Math.min(cal.offsetHeight - card.offsetHeight, anchor - card.offsetHeight / 2));
    const r = cal.getBoundingClientRect();
    const side = r.right + GAP + card.offsetWidth <= window.innerWidth - 8 ? "right" : r.left - GAP - card.offsetWidth >= 8 ? "left" : "over";
    setPos({ top: side === "over" ? Math.max(0, (cal.offsetHeight - card.offsetHeight) / 2) : top, arrow: anchor - top, side });
  }, [timeOpen, draft.getFullYear(), draft.getMonth(), draft.getDate(), month]);

  const pickDay = (d: Date) => {
    setDraft(new Date(d.getFullYear(), d.getMonth(), d.getDate(), draft.getHours(), draft.getMinutes()));
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setTimeOpen(true);
  };
  const setTime = (h: number, m: number) => setDraft(new Date(draft.getFullYear(), draft.getMonth(), draft.getDate(), h, m));

  const first = month.getDay();
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - first + 1));
  const today = new Date();
  const label = sel
    ? `${sel.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · ${pad(sel.getHours())}:${pad(sel.getMinutes())}`
    : "Pick date and time";
  const navBtn = "flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-panel hover:text-ink";
  const shadow = "shadow-[0_16px_40px_-12px_rgba(16,24,40,0.28)]";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => (open ? close() : start())} aria-expanded={open} aria-haspopup="dialog" aria-label={ariaLabel}
        className={`input flex h-[38px] items-center gap-2 pr-3 text-left ${open ? "border-route" : ""}`}>
        <CalendarDays className="h-4 w-4 shrink-0 text-route" aria-hidden />
        <span className={`flex-1 truncate tnum ${sel ? "text-ink" : "text-ink-faint"}`}>{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className={`absolute left-0 z-30 ${up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}>
          <div ref={calRef} role="dialog" aria-label="Choose a date"
            className={`dtp-view relative w-[268px] max-w-[calc(100vw-32px)] rounded-xl border border-rule bg-white p-3.5 ${shadow}`}>
            <div className="mb-2.5 flex items-center justify-between">
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className={navBtn}><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[13.5px] font-semibold">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" className={navBtn}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEK.map((w) => <span key={w} className="pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{w}</span>)}
              {days.map((d) => {
                const inMonth = d.getMonth() === month.getMonth();
                const on = sameDay(d, draft);
                const isToday = sameDay(d, today);
                return (
                  <button key={ymd(d)} data-day={ymd(d)} type="button" aria-pressed={on} aria-label={d.toDateString()} onClick={() => pickDay(d)}
                    className={`flex h-8 items-center justify-center rounded-lg text-[12.5px] tnum transition-colors ${
                      on ? `bg-route font-semibold text-white ${timeOpen ? "ring-[3px] ring-route/20" : ""}`
                      : isToday ? "font-semibold text-route ring-1 ring-inset ring-route/40 hover:bg-route-tint"
                      : inMonth ? "text-ink hover:bg-route-tint" : "text-[#B8C0C5] hover:bg-panel"}`}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-rule-soft pt-2.5">
              <button type="button" onClick={() => pickDay(today)} className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-route hover:bg-route-tint">Today</button>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-ink-soft hover:bg-panel">Cancel</button>
                {!timeOpen && <button type="button" onClick={() => setTimeOpen(true)} className="rounded-lg bg-route px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-route-dark">Done</button>}
              </div>
            </div>

            {timeOpen && (
              <div ref={timeRef} role="dialog" aria-label={`Time on ${draft.toDateString()}`}
                className={`absolute z-10 w-[212px] rounded-xl border border-rule bg-white p-3 ${shadow} ${
                  !pos ? "invisible" : pos.side === "right" ? "dtp-side-r left-full" : pos.side === "left" ? "dtp-side-l right-full" : "dtp-view left-1/2 -translate-x-1/2"}`}
                style={pos ? { top: pos.top, marginLeft: pos.side === "right" ? GAP : undefined, marginRight: pos.side === "left" ? GAP : undefined } : undefined}>
                {pos && pos.side !== "over" && (
                  <span aria-hidden style={{ top: pos.arrow - 6 }}
                    className={`absolute h-3 w-3 rotate-45 border-rule bg-white ${pos.side === "right" ? "-left-[7px] border-b border-l" : "-right-[7px] border-r border-t"}`} />
                )}
                <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                  {pos?.side === "over" ? (
                    // On a phone the card covers the calendar: its date is the way back to it.
                    <button type="button" onClick={() => setTimeOpen(false)} aria-label="Back to the calendar"
                      className="-ml-1 flex min-w-0 items-center gap-0.5 truncate text-[12px] font-semibold text-ink-soft hover:text-route">
                      <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />{draft.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                    </button>
                  ) : (
                    <span className="truncate text-[12px] font-semibold text-ink-soft">{draft.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
                  )}
                  <button type="button" onClick={() => { const n = new Date(); setTime(n.getHours(), n.getMinutes()); }}
                    className="shrink-0 text-[11.5px] font-semibold text-route hover:underline">Now</button>
                </div>

                <div className="relative flex items-center justify-center gap-0.5 rounded-lg bg-panel" style={{ height: ROW * SHOWN }}>
                  <div aria-hidden className="pointer-events-none absolute inset-x-1.5 rounded-md bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] ring-1 ring-rule" style={{ top: ROW * 2, height: ROW }} />
                  <Wheel label="Hour" items={HOURS} value={draft.getHours()} onChange={(h) => setTime(h, draft.getMinutes())} />
                  <span aria-hidden className="relative z-10 pb-0.5 text-[17px] font-semibold text-ink">:</span>
                  <Wheel label="Minute" items={MINUTES} value={draft.getMinutes()} onChange={(m) => setTime(draft.getHours(), m)} />
                </div>

                <button type="button" onClick={commit}
                  className="mt-2.5 h-8 w-full rounded-lg bg-route text-[12.5px] font-semibold text-white hover:bg-route-dark">
                  Set <span className="tnum">{pad(draft.getHours())}:{pad(draft.getMinutes())}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A scroll wheel like a phone's alarm clock: scroll, drag, click a number, or use the arrow keys. The row under the band is the value. */
function Wheel({ label, items, value, onChange }: { label: string; items: number[]; value: number; onChange: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(items.indexOf(value) * ROW);
  const settle = useRef<number>();
  const edge = ROW * ((SHOWN - 1) / 2);

  // Jump to the value when it changes from outside the wheel (opening, "Now").
  useLayoutEffect(() => {
    const el = ref.current;
    const want = items.indexOf(value) * ROW;
    if (el && Math.abs(el.scrollTop - want) > ROW / 2) { el.scrollTop = want; setTop(want); }
  }, [value, items]);

  const onScroll = () => {
    const el = ref.current; if (!el) return;
    setTop(el.scrollTop);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
      if (items[i] !== value) onChange(items[i]);
    }, 90);
  };
  const go = (i: number) => {
    const j = Math.max(0, Math.min(items.length - 1, i));
    ref.current?.scrollTo({ top: j * ROW, behavior: "smooth" });
    onChange(items[j]);
  };
  const onKey = (e: KE) => {
    const i = items.indexOf(value);
    if (e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
    else if (e.key === "PageUp") { e.preventDefault(); go(i - 5); }
    else if (e.key === "PageDown") { e.preventDefault(); go(i + 5); }
  };

  return (
    <div ref={ref} onScroll={onScroll} onKeyDown={onKey} tabIndex={0}
      role="spinbutton" aria-label={label} aria-valuenow={value} aria-valuemin={items[0]} aria-valuemax={items[items.length - 1]} aria-valuetext={pad(value)}
      className="dtp-wheel relative z-10 h-full w-[64px] snap-y snap-mandatory overflow-y-auto rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-route/40"
      style={{ paddingTop: edge, paddingBottom: edge }}>
      {items.map((n, i) => {
        // Rows shrink and fade the further they sit from the band, like a drum.
        const dist = Math.min(Math.abs(i * ROW - top) / ROW, 3);
        return (
          <button key={n} type="button" tabIndex={-1} onClick={() => go(i)} aria-hidden
            className={`flex w-full snap-center items-center justify-center tnum transition-colors ${dist < 0.5 ? "font-semibold text-ink" : "text-ink-soft"}`}
            style={{ height: ROW, fontSize: dist < 0.5 ? 19 : 16, opacity: 1 - dist * 0.28, transform: `scale(${1 - dist * 0.06})` }}>
            {pad(n)}
          </button>
        );
      })}
    </div>
  );
}
