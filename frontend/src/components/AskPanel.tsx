import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { sentence } from "../lib/format";
import type { Source } from "./Sources";
import { Thinking } from "./Typing";

interface Turn { id: number; q: string; a: string; model: string; sources: Source[]; workflowId?: string }
type Scope = "wf" | "all";

// Conversations are kept per scope for the session, so moving between decisions and back keeps each thread.
const threads = new Map<string, Turn[]>();

/**
 * The assistant, inside the Focus Queue's context drawer. Scoped to the decision in focus by default (it searches only
 * that orchestration's audit records), or to the whole agency. Answers cite the audit records they were drawn from.
 */
export default function AskPanel({ workflowId, vehicle, agency }: { workflowId: string; vehicle: string | null; agency?: string }) {
  const [scope, setScope] = useState<Scope>("wf");
  const key = scope === "wf" ? `wf:${workflowId}` : "all";
  const [turns, setTurns] = useState<Turn[]>(() => threads.get(key) ?? []);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setTurns(threads.get(key) ?? []); }, [key]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, asking]);

  const suggestions = scope === "wf"
    ? [`Why is ${vehicle ?? "this vehicle"} coming off the road?`, "Who approved the work order?", "Which drivers were ruled out and why?"]
    : ["Which vehicles are out of service today?", "How many runs did the agent cover this week?", "Which decisions are waiting longest?"];

  async function ask(question: string) {
    if (!question.trim() || asking) return;
    setAsking(question);
    setQ("");
    try {
      const history = turns.slice(-5).map((t) => ({ question: t.q, answer: t.a, workflow_id: t.workflowId }));
      const r = await api.post<{ answer: string; model: string; sources: Source[] }>("/api/assistant/ask", {
        question, workflow_id: scope === "wf" ? workflowId : undefined, history,
      });
      const next = [...turns, { id: Date.now(), q: question, a: r.answer, model: r.model, sources: r.sources ?? [], workflowId: scope === "wf" ? workflowId : undefined }];
      threads.set(key, next);
      setTurns(next);
    } catch (e: any) {
      const next = [...turns, { id: Date.now(), q: question, a: `Sorry, the assistant could not answer: ${e.message}`, model: "", sources: [] }];
      setTurns(next);
    } finally { setAsking(""); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };

  return (
    <div className="flex w-full flex-col lg:w-[400px]">
      <div className="border-b border-rule-soft px-5 pb-3 pt-[18px]">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-route-tint text-route"><Sparkles className="h-4 w-4" aria-hidden /></span>
          <h2 className="flex-1 text-[15px] font-semibold">Ask the assistant</h2>
        </div>
        <div role="radiogroup" aria-label="Scope" className="mt-3 flex flex-wrap gap-1.5">
          {([["wf", `This orchestration · ${vehicle ?? ""}`], ["all", `All of ${agency ?? "the agency"}`]] as [Scope, string][]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => setScope(k)}
              className={`h-[30px] rounded-[10px] px-3 text-xs ${scope === k ? "bg-ink text-white" : "border border-rule bg-white text-ink-soft hover:text-ink"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {turns.length === 0 && !asking && (
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {scope === "wf"
              ? `Ask why the agent proposed this, who did what, or what happens next for ${vehicle ?? "this vehicle"}. Answers come from this orchestration's audit log.`
              : "Ask about any vehicle, run or decision across the agency. Answers come from the audit log and the products."}
          </p>
        )}
        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-3.5">
            <div className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-[13.5px] text-white">{t.q}</div>
            <div className="flex max-w-[92%] flex-col gap-2.5">
              <p className="whitespace-pre-wrap text-[13.5px] leading-[1.6]">{t.a}</p>
              {t.sources.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {t.sources.slice(0, 4).map((s, i) => {
                    const body = (
                      <>
                        <span className="text-xs font-semibold text-route">[{i + 1}]</span>
                        <span className="min-w-0 flex-1 text-xs leading-snug">
                          <b className="line-clamp-2 font-semibold">{s.text}</b>
                          <span className="block text-ink-faint">{sentence(s.record_type)} · {Math.round(s.score * 100)}% match</span>
                        </span>
                      </>
                    );
                    const cls = "flex gap-2.5 rounded-[10px] border border-rule px-2.5 py-2 text-ink no-underline hover:border-route/40";
                    return s.workflow_id ? <Link key={s.audit_id} to={`/workflows/${s.workflow_id}`} className={cls}>{body}</Link> : <div key={s.audit_id} className={cls}>{body}</div>;
                  })}
                </div>
              )}
              {t.model && <span className="text-[11px] text-ink-faint">Answered from the audit log{t.workflowId ? " of this orchestration" : ""} · {t.model}</span>}
            </div>
          </div>
        ))}
        {asking && (
          <div className="flex flex-col gap-3.5">
            <div className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-[13.5px] text-white">{asking}</div>
            <Thinking />
          </div>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2.5 border-t border-rule-soft px-5 pb-4 pt-3">
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={!!asking} onClick={() => ask(s)}
              className="rounded-[10px] border border-rule bg-white px-2.5 py-1.5 text-left text-xs text-ink-soft hover:border-route/40 hover:text-ink">{s}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-reason-line py-1.5 pl-3.5 pr-1.5 focus-within:border-route">
          <span className="sr-only">Question</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === "wf" ? `Ask about ${vehicle ?? "this vehicle"}…` : "Ask about any vehicle, run or decision…"}
            className="flex-1 border-0 bg-transparent text-sm outline-none" />
          <button type="submit" disabled={!q.trim() || !!asking} aria-label="Ask"
            className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-route text-white disabled:opacity-40"><ArrowUp className="h-4 w-4" aria-hidden /></button>
        </label>
      </form>
    </div>
  );
}
