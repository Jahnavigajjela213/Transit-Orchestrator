import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp, Bot, Check, Copy, History, Link2, MessageSquare, PanelLeft, Plus, Search, ShieldCheck, Sparkles, Trash2, Wrench, X,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import type { Workflow } from "../lib/types";
import { useToast } from "../components/Toast";
import { Sources, type Source } from "../components/Sources";
import { Thinking, TypeOut } from "../components/Typing";

const CONTEXT_TURNS = 5; // earlier questions of the chat used as context, so follow-ups ("who approved it?") are understood
const ACTIVE_KEY = "assistant.activeChat"; // the open chat, so leaving the page and coming back returns to it
const PENDING_MS = 3 * 60_000; // a question this recent with no answer yet is still being answered

interface Msg {
  id: string; role: "you" | "assistant"; text: string; at: Date; animate?: boolean;
  workflow_id?: string | null; vehicle?: string | null; sources?: Source[]; contextTurns?: number; followsOn?: string | null;
}
interface ChatSummary { id: string; title: string; created_at: string; updated_at: string; messages: number }
interface SavedMessage {
  id: string; role: "you" | "assistant"; text: string; created_at: string; workflow_id?: string | null; vehicle_label?: string | null;
  sources?: Source[]; context_turns?: number; follows_on_from?: string | null;
}
interface AskOut {
  answer: string; workflow_id: string | null; vehicle_label: string | null; sources: Source[];
  context_turns: number; follows_on_from: string | null; session_id: string | null;
}

const store = {
  get: () => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } },
  set: (id: string | null) => { try { id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY); } catch { /* storage blocked */ } },
};

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stamp = (d: Date) => (d.toDateString() === new Date().toDateString() ? clock(d) : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${clock(d)}`);

const fromSaved = (m: SavedMessage): Msg => ({
  id: m.id, role: m.role, text: m.text, at: new Date(m.created_at), workflow_id: m.workflow_id, vehicle: m.vehicle_label,
  sources: m.sources, contextTurns: m.context_turns, followsOn: m.follows_on_from,
});

/** Chats grouped by when they were last used. */
function groups(chats: ChatSummary[]) {
  const day = 86_400_000, start = new Date(); start.setHours(0, 0, 0, 0);
  const out: { label: string; items: ChatSummary[] }[] = [
    { label: "Today", items: [] }, { label: "Yesterday", items: [] }, { label: "Previous 7 days", items: [] }, { label: "Older", items: [] },
  ];
  for (const c of chats) {
    const t = new Date(c.updated_at).getTime();
    out[t >= start.getTime() ? 0 : t >= start.getTime() - day ? 1 : t >= start.getTime() - 7 * day ? 2 : 3].items.push(c);
  }
  return out.filter((g) => g.items.length);
}

export default function Assistant() {
  const toast = useToast();
  const { user } = useAuth();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [opening, setOpening] = useState(false);
  const [waiting, setWaiting] = useState(false); // an answer is on its way for the open chat
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState(false); // chat list on small screens
  const activeRef = useRef<string | null>(null);
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

  const loadChats = useCallback(async () => {
    try { setChats(await api.get<ChatSummary[]>("/api/assistant/sessions")); } catch (e: any) { toast(e.message, "error"); setChats([]); }
  }, [toast]);

  const select = (id: string | null) => { activeRef.current = id; setActive(id); store.set(id); };

  const open = useCallback(async (id: string) => {
    select(id);
    setDrawer(false);
    setOpening(true);
    try {
      const d = await api.get<{ messages: SavedMessage[] }>(`/api/assistant/sessions/${id}`);
      if (activeRef.current !== id) return;
      const list = d.messages.map(fromSaved);
      setMsgs(list);
      const last = list[list.length - 1];
      // the question was sent (perhaps before leaving this page) and its answer has not arrived yet
      setWaiting(!!last && last.role === "you" && Date.now() - last.at.getTime() < PENDING_MS);
    } catch {
      select(null); setMsgs([]); setWaiting(false); // the chat was deleted
    } finally { setOpening(false); }
  }, []);

  function newChat() {
    select(null); setMsgs([]); setWaiting(false); setDrawer(false); setQ("");
    input.current?.focus();
  }

  async function remove(c: ChatSummary) {
    if (!window.confirm(`Delete the chat "${c.title}"? This cannot be undone.`)) return;
    try {
      await api.del(`/api/assistant/sessions/${c.id}`);
      if (activeRef.current === c.id) newChat();
      setChats((x) => x?.filter((y) => y.id !== c.id) ?? x);
      toast("Chat deleted.");
    } catch (e: any) { toast(e.message, "error"); }
  }

  // first visit: the chat list, and the chat that was open when the page was left
  useEffect(() => {
    loadChats();
    const last = store.get();
    if (last) open(last);
  }, [loadChats, open]);

  // an answer that was still on its way when the page was left: check until it is saved
  useEffect(() => {
    if (!waiting || !active || msgs[msgs.length - 1]?.role !== "you") return;
    const t = window.setInterval(async () => {
      try {
        const d = await api.get<{ messages: SavedMessage[] }>(`/api/assistant/sessions/${active}`);
        if (activeRef.current !== active) return;
        const list = d.messages.map(fromSaved);
        if (list[list.length - 1]?.role === "assistant") {
          list[list.length - 1].animate = true;
          setMsgs(list); setWaiting(false); loadChats();
        }
      } catch { /* try again */ }
    }, 3000);
    return () => window.clearInterval(t);
  }, [waiting, active, msgs, loadChats]);

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

  // an opened chat starts at its latest message
  useEffect(() => {
    if (!opening) requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
  }, [opening, active]);

  // grow the composer with its text, up to a limit
  useEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  }, [q]);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    const text = question.trim();
    if (!text || waiting) return;
    const chat = activeRef.current;
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, role: "you", text, at: new Date() }]);
    setQ("");
    setWaiting(true);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
    try {
      const r = await api.post<AskOut>("/api/assistant/ask", chat ? { question: text, session_id: chat } : { question: text, new_session: true });
      if (activeRef.current !== chat) { loadChats(); return; } // the user moved to another chat: the answer is saved in its own
      if (!chat && r.session_id) select(r.session_id);
      setMsgs((m) => [...m, {
        id: `local-${Date.now()}-a`, role: "assistant", text: r.answer, at: new Date(), animate: true, workflow_id: r.workflow_id,
        vehicle: r.vehicle_label, sources: r.sources, contextTurns: r.context_turns, followsOn: r.follows_on_from,
      }]);
      loadChats();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      if (activeRef.current === chat || !chat) setWaiting(false);
      input.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(q); }
  }

  const answered = msgs.filter((m) => m.role === "assistant").length;
  const used = Math.min(answered, CONTEXT_TURNS);
  const first = user?.full_name?.split(" ")[0];
  const title = chats?.find((c) => c.id === active)?.title;

  const sidebar = (
    <div className="flex h-full w-72 flex-col border-r border-rule bg-white">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <span className="px-1 font-sign text-sm font-bold">Chats</span>
        <button className="rounded-md p-1 text-ink-soft hover:bg-paper lg:hidden" onClick={() => setDrawer(false)} aria-label="Close chat list"><X className="h-4 w-4" /></button>
      </div>
      <div className="px-3 pb-3">
        <button className="btn-primary w-full justify-center rounded-xl py-2" onClick={newChat}><Plus className="h-4 w-4" aria-hidden /> New chat</button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Saved chats">
        {chats === null ? <p className="px-2 text-xs text-ink-faint">Loading chats…</p>
          : chats.length === 0 ? <p className="px-2 py-6 text-center text-xs text-ink-faint">Your chats appear here, so you can come back to them.</p>
          : groups(chats).map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">{g.label}</div>
              {g.items.map((c) => (
                <div key={c.id} className={`group relative flex items-center rounded-lg ${c.id === active ? "bg-route-tint text-route" : "text-ink hover:bg-paper"}`}>
                  <button onClick={() => open(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left" aria-current={c.id === active ? "true" : undefined}>
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.title}</span>
                      <span className="block text-2xs text-ink-faint">{stamp(new Date(c.updated_at))} · {Math.ceil(c.messages / 2)} question{c.messages > 2 ? "s" : ""}</span>
                    </span>
                  </button>
                  <button onClick={() => remove(c)} aria-label={`Delete chat: ${c.title}`}
                          className="mr-1 rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-stop-tint hover:text-stop focus:opacity-100 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* chat list: a column on wide screens, a drawer on small ones */}
      <aside className="hidden min-h-0 lg:flex">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="h-full shadow-xl">{sidebar}</div>
          <button className="flex-1 bg-ink/30" onClick={() => setDrawer(false)} aria-label="Close chat list" />
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gradient-to-b from-white to-paper">
        {/* title bar */}
        <div className="flex items-center justify-between gap-3 border-b border-rule bg-white/80 px-5 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-md p-1.5 text-ink-soft hover:bg-paper lg:hidden" onClick={() => setDrawer(true)} aria-label="Show chats"><PanelLeft className="h-5 w-5" /></button>
            <Avatar size="md" />
            <div className="min-w-0 leading-tight">
              <h1 className="truncate font-sign text-base font-bold">{title ?? "Orchestration Assistant"}</h1>
              <p className="flex items-center gap-1.5 text-2xs text-ink-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-go" aria-hidden /> {title ? "Orchestration Assistant · saved chat" : "Answers from your audit log, searched by meaning"}
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-rule bg-white px-2.5 py-1 text-2xs text-ink-soft sm:inline-flex"
                title="Earlier questions of this chat used with each new one, so follow-ups are understood">
            <History className="h-3.5 w-3.5" aria-hidden /> Remembers <span className="tnum font-semibold text-ink">{used}/{CONTEXT_TURNS}</span> earlier questions
          </span>
        </div>

        {/* conversation */}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div ref={content} className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            {opening && msgs.length === 0 ? (
              <div className="flex justify-center pt-16"><Thinking /></div>
            ) : msgs.length === 0 && !waiting ? (
              <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
                <Avatar size="lg" />
                <h2 className="mt-5 font-sign text-2xl font-bold tracking-tight">{first ? `Hi ${first}, what would you like to know?` : "What would you like to know?"}</h2>
                <p className="mt-2 max-w-md text-sm text-ink-soft">
                  Ask what the orchestrator did and why. Every answer comes from the decision audit log, follow-up questions keep the context, and your chats are saved on the left.
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
                    <span className="mt-1 text-2xs text-ink-faint">{stamp(m.at)}</span>
                  </div>
                ) : (
                  <AssistantMessage key={m.id} m={m} />
                ))}
                {waiting && (
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
              <button type="submit" disabled={waiting || !q.trim()} aria-label="Send"
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
  const footer = (
    <div className="mt-3 border-t border-rule/70 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-soft">
        {m.workflow_id && <Link to={`/workflows/${m.workflow_id}`} className="inline-flex items-center gap-1 font-medium text-route hover:underline">Open the {m.vehicle} orchestration →</Link>}
        {!!m.contextTurns && <span>Used {m.contextTurns} earlier question{m.contextTurns > 1 ? "s" : ""} as context</span>}
        <button onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-paper hover:text-ink" aria-label="Copy answer">
          {copied ? <><Check className="h-3.5 w-3.5 text-go" aria-hidden /> Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</>}
        </button>
      </div>
      <Sources sources={m.sources} />
    </div>
  );
  return (
    <div className="group flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-2xs text-ink-faint">
          <span className="font-semibold text-ink-soft">Assistant</span><span>{stamp(m.at)}</span>
          {m.followsOn && <span className="inline-flex items-center gap-1 rounded-full bg-route-tint px-2 py-0.5 text-route"><Link2 className="h-3 w-3" aria-hidden />Following on from {m.followsOn}</span>}
        </div>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-rule bg-white px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {/* only a newly arrived answer is typed out; saved answers show at once */}
          {m.animate ? <TypeOut text={m.text} after={footer} /> : <>{m.text}{footer}</>}
        </div>
      </div>
    </div>
  );
}
