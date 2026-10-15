import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const SIZES = [10, 25, 50];

/** Page through a list: 10 rows by default. `resetKey` changes (a filter changed) send the list back to page 1. */
export function usePaged<T>(items: T[] | null | undefined, resetKey: unknown) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const key = JSON.stringify(resetKey);
  useEffect(() => setPage(0), [key, size]);
  const total = items?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(page, pages - 1);
  return { rows: (items ?? []).slice(p * size, p * size + size), page: p, pages, size, total, setPage, setSize, big: size > SIZES[0] };
}

export function Pager({ page, pages, size, total, setPage, setSize }: {
  page: number; pages: number; size: number; total: number; setPage: (p: number) => void; setSize: (s: number) => void;
}) {
  if (!total) return null;
  const from = page * size + 1, to = Math.min(total, (page + 1) * size);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
      <label className="flex items-center gap-2">Rows per page
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-8 rounded-lg border border-rule bg-white px-2 text-xs text-ink">
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="flex-1" />
      <span className="tnum">{from}–{to} of {total}</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rule bg-white text-ink disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rule bg-white text-ink disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  );
}
