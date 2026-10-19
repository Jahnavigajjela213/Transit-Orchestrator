import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowUp, Bot, Check, CloudRain, Copy, Database, LineChart, MapPin, RotateCcw, Sparkles, Target, UserX, Users,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { sentence } from "../lib/format";
import { useToast } from "./Toast";
import { Thinking, TypeOut } from "./Typing";
import { Json } from "./ui";

interface Answer { answer: string; intent: string; facts: Record<string, any>; model: string; provider: string; fallback: boolean }
type Msg = { id: number; role: "you"; text: string; at: Date } | ({ id: number; role: "assistant"; at: Date; animate: boolean } & Answer);

const providerName = (p: string) => (p === "ollama" ? "Local SLM" : p === "mock" ? "Built-in composer" : sentence(p));
const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Icon for a suggested question, by what it asks about. */
function iconFor(q: string) {
  const s = q.toLowerCase();
  if (/move otp|reach|target/.test(s)) return Target;
  if (/route|late on/.test(s)) return MapPin;
  if (/operator|coach|driver/.test(s)) return Users;
  if (/rain|weather/.test(s)) return CloudRain;
  if (/trend|months/.test(s)) return LineChart;
  if (/no-show|no show/.test(s)) return UserX;
  return Sparkles;
}

function Avatar({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br from-route to-rail text-white shadow-sm ${size === "lg" ? "h-12 w-12 rounded-2xl" : "h-7 w-7 rounded-lg"}`} aria-hidden>
      {size === "lg" ? <Sparkles className="h-6 w-6" /> : <Bot className="h-3.5 w-3.5" />}
    </span>
  );
}

/** Grounded Q&A over the agency's performance history, laid out as a chat. */
export default function PerformanceChat({ provider, suggestions }: { provider: string; suggestions: string[] }) {
  const { user } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs.length, asking]);
  useEffect(() => {
    const el = input.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }
  }, [q]);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setMsgs((m) => [...m, { id: nextId.current++, role: "you", text, at: new Date() }]);
    setQ("");
    setAsking(true);
    try {
      const r = await api.post<Answer>("/api/performance/ask", { question: text });
      setMsgs((m) => [...m.map((x) => (x.role === "assistant" ? { ...x, animate: false } : x)), { ...r, id: nextId.current++, role: "assistant", at: new Date(), animate: true }]);
    } catch (err: any) {
      toast(err.message, "error");
      setQ(text);
    } finally {
      setAsking(false);
      input.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(q); }
  }

  const first = user?.full_name?.split(" ")[0];
  const asked = new Set(msgs.filter((m) => m.role === "you").map((m) => m.text));
  const more = suggestions.filter((s) => !asked.has(s)).slice(0, 3);

  return (
    <section className="panel flex h-[600px] flex-col overflow-hidden xl:h-[660px]" aria-label="Performance assistant">
      <header className="flex items-center justify-between gap-3 border-b border-rule bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar />
          <div className="min-w-0 leading-tight">
            <h2 className="truncate font-sign text-sm font-bold">Performance assistant</h2>
            <p className="flex items-center gap-1.5 text-2xs text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-go" aria-hidden /> {providerName(provider)} · answers only from your history
            </p>
          </div>
        </div>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} disabled={asking} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> New chat
          </button>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-white to-paper/70">
        {msgs.length === 0 && !asking ? (
          <div className="flex flex-col items-center px-5 pb-6 pt-8 text-center">
            <Avatar size="lg" />
            <h3 className="mt-4 font-sign text-lg font-bold tracking-tight">{first ? `Hi ${first}, ask about on-time performance` : "Ask about on-time performance"}</h3>
            <p className="mt-1.5 max-w-sm text-xs text-ink-soft">Answers come only from your agency's run history and the trained model. Each one shows the facts it used, so you can check the numbers.</p>
            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {suggestions.map((s) => {
                const Icon = iconFor(s);
                return (
                  <button key={s} onClick={() => ask(s)}
                          className="group flex items-start gap-2.5 rounded-xl border border-rule bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-route/40 hover:shadow-md">
                    <span className="rounded-lg bg-route-tint p-1.5 text-route"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                    <span className="text-xs font-medium leading-snug text-ink group-hover:text-route">{s}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-4 py-5">
            {msgs.map((m) => m.role === "you" ? (
              <div key={m.id} className="flex flex-col items-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-route px-3.5 py-2 text-sm leading-relaxed text-white shadow-sm">{m.text}</div>
                <span className="mt-1 text-2xs text-ink-faint">{time(m.at)}</span>
              </div>
            ) : <AssistantMessage key={m.id} m={m} />)}
            {asking && (
              <div className="flex gap-2.5">
                <Avatar />
                <div className="rounded-2xl rounded-tl-md border border-rule bg-white px-4 py-2.5 shadow-sm">
                  <Thinking />
                </div>
              </div>
            )}
            {!asking && more.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-9">
                {more.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="rounded-[10px] border border-rule bg-white px-2.5 py-1 text-2xs text-ink-soft transition hover:border-route hover:text-route">{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={(e) => ask(q, e)} className="border-t border-rule bg-white px-3 pb-3 pt-2.5">
        <div className="flex items-end gap-2 rounded-2xl border border-rule bg-white p-1.5 pl-3.5 shadow-sm transition focus-within:border-route focus-within:ring-4 focus-within:ring-route/10">
          <textarea ref={input} rows={1} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Question"
                    placeholder="Ask about OTP, a route, operators, weather…"
                    className="max-h-[120px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-ink-faint" />
          <button disabled={asking || !q.trim()} aria-label="Ask"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-route text-white transition hover:bg-route-dark disabled:cursor-not-allowed disabled:bg-rule">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-center text-2xs text-ink-faint"><kbd className="font-sans font-semibold">Enter</kbd> to send · <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line</p>
      </form>
    </section>
  );
}

function AssistantMessage({ m }: { m: Extract<Msg, { role: "assistant" }> }) {
  const [copied, setCopied] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.answer); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const footer = (
    <div className="mt-2.5 border-t border-rule/70 pt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-soft">
        <button onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}
                className={`inline-flex items-center gap-1 rounded-[7px] border px-2 py-0.5 transition ${showFacts ? "border-route bg-route-tint text-route" : "border-rule hover:border-route hover:text-route"}`}>
          <Database className="h-3 w-3" aria-hidden /> {showFacts ? "Hide" : "Show"} the facts used
        </button>
        <span className="rounded-full bg-paper px-2 py-0.5">{sentence(m.intent)}</span>
        <span className="text-ink-faint">{m.model}{m.fallback ? " (fallback)" : ""}</span>
        <button onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-paper hover:text-ink" aria-label="Copy answer">
          {copied ? <><Check className="h-3.5 w-3.5 text-go" aria-hidden /> Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</>}
        </button>
      </div>
      {showFacts && <div className="mt-2 max-h-64 overflow-auto rounded-lg text-xs"><Json value={m.facts} /></div>}
    </div>
  );
  return (
    <div className="flex gap-2.5">
      <Avatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-2xs text-ink-faint"><span className="font-semibold text-ink-soft">Assistant</span><span>{time(m.at)}</span></div>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-rule bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-sm">
          {m.animate ? <TypeOut text={m.answer} after={footer} /> : <>{m.answer}{footer}</>}
        </div>
      </div>
    </div>
  );
}
