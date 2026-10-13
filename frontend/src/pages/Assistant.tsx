import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, Bot, Check, Copy, History, Link2, RotateCcw, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import type { Workflow } from "../lib/types";
import { useToast } from "../components/Toast";
import { Sources, type Source } from "../components/Sources";
import { Thinking, TypeOut } from "../components/Typing";

const CONTEXT_TURNS = 5; // earlier questions sent with each new one, so follow-ups ("who approved it?") are understood

interface Msg {
  id: number; role: "you" | "assistant"; text: string; at: Date;
  workflow_id?: string | null; vehicle?: string | null; model?: string; sources?: Source[]; contextTurns?: number; followsOn?: string | null;
}
interface AskOut {
  answer: string; workflow_id: string | null; vehicle_label: string | null; model: string; sources: Source[];
  context_turns: number; follows_on_from: string | null;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The last few question/answer pairs, oldest first, as the API expects them. */
function history(msgs: Msg[]) {
  const turns: { question: string; answer: string; workflow_id: string | null }[] = [];
  msgs.forEach((m, i) => {
    const a = msgs[i + 1];
    if (m.role === "you" && a?.role === "assistant") turns.push({ question: m.text, answer: a.text, workflow_id: a.workflow_id ?? null });
  });
  return turns.slice(-CONTEXT_TURNS);
}

export default function Assistant() {
  const toast = useToast();
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { data: recent } = useData<Workflow[]>("/api/workflows?limit=20");

  const v = [...new Set((recent ?? []).map((w) => w.vehicle_label).filter(Boolean))];
  const suggestions = [
    { icon: Search, title: "Which vehicles had a fault detected?", hint: "Search the whole audit log" },
    { icon: Wrench, title: v[0] ? `Why was ${v[0]} taken out of service?` : "Why was a vehicle taken out of service?", hint: "Reasoning behind a decision" },
    { icon: ShieldCheck, title: v[1] ? `Who approved the work order for ${v[1]}?` : "Who approved the latest work order?", hint: "People and approvals" },
    { icon: History, title: "Which steps ran in shadow mode?", hint: "What the agent would have done" },
  ];

  // keep the newest message in view while it is being typed out, unless the reader scrolled up
  useEffect(() => {
    const el = scroller.current, body = content.current;
    if (!el || !body) return;
    const ro = new ResizeObserver(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  // grow the composer with its text, up to a limit
  useEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  }, [q]);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    if (!question.trim() || busy) return;
    const turns = history(msgs);
    setMsgs((m) => [...m, { id: Date.now(), role: "you", text: question.trim(), at: new Date() }]);
    setQ("");
    setBusy(true);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
    try {
      const r = await api.post<AskOut>("/api/assistant/ask", { question: question.trim(), history: turns });
      setMsgs((m) => [...m, {
        id: Date.now(), role: "assistant", text: r.answer, at: new Date(), workflow_id: r.workflow_id, vehicle: r.vehicle_label,
        model: r.model, sources: r.sources, contextTurns: r.context_turns, followsOn: r.follows_on_from,
      }]);
    } catch (err: any) { toast(err.message, "error"); } finally { setBusy(false); input.current?.focus(); }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(q); }
  }

  const used = Math.min(history(msgs).length, CONTEXT_TURNS);
  const first = user?.full_name?.split(" ")[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-white to-paper">
      {/* title bar */}
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-white/80 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Avatar size="md" />
          <div className="leading-tight">
            <h1 className="font-sign text-base font-bold">Orchestration Assistant</h1>
            <p className="flex items-center gap-1.5 text-2xs text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-go" aria-hidden /> Answers from your audit log, searched by meaning
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-rule bg-white px-2.5 py-1 text-2xs text-ink-soft sm:inline-flex"
                title="Earlier questions sent with each new one, so follow-ups are understood">
            <History className="h-3.5 w-3.5" aria-hidden /> Remembers <span className="tnum font-semibold text-ink">{used}/{CONTEXT_TURNS}</span> earlier questions
          </span>
          <button className="btn-quiet rounded-full text-xs" onClick={() => setMsgs([])} disabled={!msgs.length || busy}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> New chat
          </button>
        </div>
      </div>

      {/* conversation */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {msgs.length === 0 && !busy ? (
            <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
              <Avatar size="lg" />
              <h2 className="mt-5 font-sign text-2xl font-bold tracking-tight">{first ? `Hi ${first}, what would you like to know?` : "What would you like to know?"}</h2>
              <p className="mt-2 max-w-md text-sm text-ink-soft">
                Ask what the orchestrator did and why. Every answer comes from the decision audit log, and follow-up questions keep the context of the conversation.
              </p>
              <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button key={s.title} onClick={() => ask(s.title)}
                          className="group flex items-start gap-3 rounded-xl border border-rule bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-route/40 hover:shadow-md">
                    <span className="rounded-lg bg-route-tint p-2 text-route"><s.icon className="h-4 w-4" aria-hidden /></span>
                    <span>
                      <span className="block text-sm font-medium text-ink group-hover:text-route">{s.title}</span>
                      <span className="mt-0.5 block text-2xs text-ink-faint">{s.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {msgs.map((m) => m.role === "you" ? (
                <div key={m.id} className="flex flex-col items-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-route px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">{m.text}</div>
                  <span className="mt-1 text-2xs text-ink-faint">{clock(m.at)}</span>
                </div>
              ) : (
                <AssistantMessage key={m.id} m={m} />
              ))}
              {busy && (
                <div className="flex gap-3">
                  <Avatar />
                  <div className="rounded-2xl rounded-tl-md border border-rule bg-white px-4 py-3 shadow-sm"><Thinking /></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-rule bg-white/90 px-4 pb-4 pt-3 backdrop-blur sm:px-6">
        <form onSubmit={(e) => ask(q, e)} className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-rule bg-white p-2 pl-4 shadow-sm transition focus-within:border-route focus-within:ring-4 focus-within:ring-route/10">
            <textarea ref={input} rows={1} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus
                      placeholder={msgs.length ? "Ask a follow-up…" : "Ask about a vehicle, a decision or an approval…"} aria-label="Question"
                      className="max-h-[180px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-ink-faint" />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Send"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-route text-white transition hover:bg-route-dark disabled:cursor-not-allowed disabled:bg-rule">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-center text-2xs text-ink-faint">
            <kbd className="font-sans font-semibold">Enter</kbd> to send · <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line · every question is recorded in the audit log
          </p>
        </form>
      </div>
    </div>
  );
}

function Avatar({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const box = { sm: "h-8 w-8 rounded-lg", md: "h-9 w-9 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  const icon = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-7 w-7" }[size];
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br from-route to-rail text-white shadow-sm ${box}`} aria-hidden>
      {size === "lg" ? <Sparkles className={icon} /> : <Bot className={icon} />}
    </span>
  );
}

function AssistantMessage({ m }: { m: Msg }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="group flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-2xs text-ink-faint">
          <span className="font-semibold text-ink-soft">Assistant</span><span>{clock(m.at)}</span>
          {m.followsOn && <span className="inline-flex items-center gap-1 rounded-full bg-route-tint px-2 py-0.5 text-route"><Link2 className="h-3 w-3" aria-hidden />Following on from {m.followsOn}</span>}
        </div>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-rule bg-white px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          <TypeOut text={m.text} after={
            <div className="mt-3 border-t border-rule/70 pt-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-soft">
                {m.workflow_id && <Link to={`/workflows/${m.workflow_id}`} className="inline-flex items-center gap-1 font-medium text-route hover:underline">Open the {m.vehicle} orchestration →</Link>}
                {m.model && <span>Answered by {m.model}</span>}
                {!!m.contextTurns && <span>Used {m.contextTurns} earlier question{m.contextTurns > 1 ? "s" : ""} as context</span>}
                <button onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-paper hover:text-ink" aria-label="Copy answer">
                  {copied ? <><Check className="h-3.5 w-3.5 text-go" aria-hidden /> Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</>}
                </button>
              </div>
              <Sources sources={m.sources} />
            </div>
          } />
        </div>
      </div>
    </div>
  );
}
