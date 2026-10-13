import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/live";
import { ago, sentence } from "../lib/format";
import { useToast } from "../components/Toast";
import { Empty, ErrorNote, Loading, PageHeader, Section, StatusBadge, Tag } from "../components/ui";

interface RunRow {
  id: string; provider: string; model_fast: string; model_smart: string; started_at: string; finished_at: string | null; status: string;
  score_pct: number | null; pass_threshold_pct: number; run_by: string;
  summary: { error?: string; cases?: number; cases_passed?: number; checks?: number; checks_passed?: number; input_tokens?: number;
    output_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number; cost_usd?: number; p50_latency_ms?: number; p95_latency_ms?: number };
}
interface CaseResult {
  id: string; task: string; title: string; passed: boolean; checks: { name: string; passed: boolean }[]; output: string;
  error: string | null; latency_ms: number; input_tokens: number; output_tokens: number;
  cache_creation_tokens?: number; cache_read_tokens?: number; cost_usd: number;
}
interface Listing {
  runs: RunRow[]; current: { llm_provider: string; slm_provider: string; model_fast: string; model_smart: string };
  providers: string[]; configured: Record<string, boolean>; cases: { id: string; task: string; title: string; checks: string[] }[];
}

export default function Evals() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useData<Listing>("/api/evals");
  const [provider, setProvider] = useState("mock");
  const [threshold, setThreshold] = useState(90);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail } = useData<RunRow & { cases: CaseResult[] }>(openId ? `/api/evals/${openId}` : null, [openId]);

  async function run() {
    setRunning(true);
    try {
      const r = await api.post<RunRow>("/api/evals/run", { provider, pass_threshold: threshold });
      toast(r.status === "error" ? r.summary.error ?? "Run failed" : `${sentence(r.status)}: ${r.score_pct}%`, r.status === "passed" ? "ok" : "error");
      setOpenId(r.id);
      reload();
    } catch (e: any) { toast(e.message, "error"); } finally { setRunning(false); }
  }

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-5">
      <PageHeader title="Model evaluation"
        intro="Run this suite before switching or upgrading a model. Every case is a real orchestrator task with checks for the rules the product depends on: valid JSON, picking only candidates that passed the hard checks (also under a prompt injection), length limits, required facts, saying when the record does not answer, and quoting grounded numbers exactly." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Section title="In use now">
          <div className="p-4">
            <dl className="space-y-2 text-sm">
              {([["Orchestrator model", `${data.current.llm_provider}: ${data.current.model_fast} (fast) / ${data.current.model_smart} (smart)`],
                ["Performance SLM", data.current.slm_provider],
                ["Cases in the suite", `${data.cases.length} fixed + 2 grounded on your agency's history`]] as [string, string][]).map(([k, v]) => (
                <div key={k}><dt className="text-2xs text-ink-soft">{k}</dt><dd className="break-words">{v}</dd></div>
              ))}
            </dl>
          </div>
          {user?.role === "admin" ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-rule p-4 text-sm">
              <label><span className="label">Provider to evaluate</span>
                <select className="input w-44" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {data.providers.map((p) => <option key={p} value={p}>{p}{data.configured[p] ? "" : " (not configured)"}</option>)}
                </select></label>
              <label><span className="label">Pass at (%)</span>
                <input type="number" min={0} max={100} className="input w-24" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
              <button className="btn-primary" disabled={running} onClick={run}>{running ? "Running…" : "Run evaluation"}</button>
            </div>
          ) : <p className="border-t border-rule px-4 py-3 text-xs text-ink-soft">Only the operations admin can start an evaluation run.</p>}
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-soft">Configure providers in backend/.env (ANTHROPIC_API_KEY, BEDROCK_MODEL_*, OLLAMA_MODEL). CLI: <code>python scripts/run_evals.py --provider anthropic</code></p>
        </Section>

        <Section title="Runs">
          {data.runs.length === 0 ? <Empty title="No runs yet">Run the suite against the mock first to see the baseline.</Empty> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>When</th><th>Provider / models</th><th>Score</th><th>Cases</th><th>Tokens used</th><th>Cache used</th>
                  <th>Cost</th><th>Latency p50 / p95</th><th>Result</th></tr></thead>
                <tbody>{data.runs.map((r) => {
                  const cc = r.summary.cache_creation_tokens ?? 0, cr = r.summary.cache_read_tokens ?? 0;
                  return (
                  <tr key={r.id} className={`cursor-pointer hover:bg-paper/60 ${openId === r.id ? "bg-route-tint/40" : ""}`} onClick={() => setOpenId(r.id)}>
                    <td className="text-xs">{ago(r.started_at)}<div className="text-2xs text-ink-soft">{r.run_by}</div></td>
                    <td className="text-xs"><div className="font-medium">{r.provider}</div><div className="text-ink-soft">{r.model_fast} / {r.model_smart}</div></td>
                    <td className="tnum font-semibold">{r.score_pct === null ? "—" : `${r.score_pct}%`}<div className="text-2xs font-normal text-ink-soft">pass at {r.pass_threshold_pct}%</div></td>
                    <td className="tnum text-xs">{r.summary.cases_passed ?? 0}/{r.summary.cases ?? 0}</td>
                    <td className="tnum text-xs">{((r.summary.input_tokens ?? 0) + (r.summary.output_tokens ?? 0)).toLocaleString()}</td>
                    <td className="tnum text-xs">{cc || cr ? (cc + cr).toLocaleString() : <span className="text-ink-soft">—</span>}</td>
                    <td className="tnum text-xs">${(r.summary.cost_usd ?? 0).toFixed(4)}</td>
                    <td className="tnum text-xs">{r.summary.p50_latency_ms ?? 0} / {r.summary.p95_latency_ms ?? 0} ms</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {openId && detail && (
        <Section title={`Run ${detail.provider}, ${ago(detail.started_at)}`} aside={<StatusBadge status={detail.status} />}>
          {detail.summary.error ? <div className="p-4"><ErrorNote message={detail.summary.error} /></div> : (
            <ul className="divide-y divide-rule">
              {detail.cases.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Tag color={c.passed ? "green" : "red"}>{c.passed ? "Pass" : "Fail"}</Tag>
                    <span className="font-medium">{c.title}</span><Tag>{c.task}</Tag>
                    <span className="text-2xs text-ink-soft tnum">{c.latency_ms} ms, {c.input_tokens + c.output_tokens} tokens
                      {((c.cache_creation_tokens ?? 0) + (c.cache_read_tokens ?? 0)) > 0 &&
                        ` (cache: ${(c.cache_creation_tokens ?? 0) + (c.cache_read_tokens ?? 0)})`}</span>
                  </div>
                  <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                    {c.checks.map((x) => <li key={x.name} className={x.passed ? "text-go" : "text-stop"}>{x.passed ? "✓" : "✗"} {x.name}</li>)}
                  </ul>
                  {c.error && <p className="mt-1 text-xs text-stop">{c.error}</p>}
                  <details className="mt-1 text-xs"><summary className="cursor-pointer text-route">Model output</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-paper p-2 text-ink-soft">{c.output || "(empty)"}</pre></details>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
