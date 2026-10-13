import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot, Send } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader } from "../components/ui";
import { useToast } from "../components/Toast";

interface Msg { role: "you" | "assistant"; text: string; workflow_id?: string | null; vehicle?: string | null; model?: string }

const prompts = ["Why was V-104 pulled from service?", "Who approved the work order for V-104?", "What happened with P-205?"];

export default function Assistant() {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    if (!question.trim()) return;
    setMsgs((m) => [...m, { role: "you", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api.post<{ answer: string; workflow_id: string | null; vehicle_label: string | null; model: string }>("/api/assistant/ask", { question });
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, workflow_id: r.workflow_id, vehicle: r.vehicle_label, model: r.model }]);
    } catch (err: any) { toast(err.message, "error"); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Assistant" intro="Ask what the orchestrator did and why. Answers come only from the orchestration record and audit log, and each question is logged." />
      <div className="panel flex min-h-[420px] flex-col">
        <div className="flex-1 space-y-4 p-4">
          {msgs.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-sm text-ink-soft">Mention a vehicle number to point the assistant at its latest orchestration.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {prompts.map((p) => <button key={p} className="btn-quiet text-xs" onClick={() => ask(p)}>{p}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "you" ? "flex justify-end" : "flex gap-2"}>
              {m.role === "assistant" && <Bot className="mt-1 h-5 w-5 shrink-0 text-route" aria-hidden />}
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${m.role === "you" ? "bg-route text-white" : "bg-paper"}`}>
                {m.text}
                {m.workflow_id && <div className="mt-1.5 text-2xs text-ink-soft">From the {m.vehicle} <Link to={`/workflows/${m.workflow_id}`} className="text-route underline">orchestration record</Link>, answered by {m.model}</div>}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => ask(q, e)} className="flex gap-2 border-t border-rule p-3">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why was V-105 pulled?" aria-label="Question" />
          <button className="btn-primary" disabled={busy}><Send className="h-4 w-4" aria-hidden /> Ask</button>
        </form>
      </div>
    </div>
  );
}
