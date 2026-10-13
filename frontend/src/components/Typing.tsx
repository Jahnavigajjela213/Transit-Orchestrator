import { useEffect, useState, type ReactNode } from "react";

/** Shown while the assistant is working on an answer: three dots in a wave. */
export function Thinking() {
  return (
    <span className="inline-flex h-5 items-center gap-1 text-route" role="status" aria-label="Thinking">
      {[0, 160, 320].map((d) => <span key={d} className="dot-wave h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Writes the text out a few words at a time, like an agent typing; `after` (sources, links) appears once it is done. */
export function TypeOut({ text, after, wordsPerTick = 1, tickMs = 70 }: { text: string; after?: ReactNode; wordsPerTick?: number; tickMs?: number }) {
  const words = text.split(/(\s+)/); // keep the spaces, so the text is rebuilt exactly
  const [shown, setShown] = useState(() => (reducedMotion() ? words.length : 0));
  const done = shown >= words.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setShown((n) => Math.min(words.length, n + wordsPerTick * 2)), tickMs);
    return () => clearTimeout(t);
  }, [shown, done, words.length, wordsPerTick, tickMs]);

  return (
    <>
      <span aria-live="polite">
        {words.slice(0, shown).join("")}
        {!done && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-route/70" aria-hidden />}
      </span>
      {done && after}
    </>
  );
}
