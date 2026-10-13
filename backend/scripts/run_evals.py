"""Run the model evaluation suite from the command line (backend/ directory, venv active):

    python scripts/run_evals.py --provider anthropic [--tenant ten_mvt] [--threshold 90]

Exits non-zero when the run does not pass, so it can gate a model change in CI.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--provider", default="mock", choices=["mock", "anthropic", "bedrock", "ollama"])
    p.add_argument("--tenant", default="ten_mvt")
    p.add_argument("--threshold", type=float, default=90.0)
    a = p.parse_args()
    from app.core import database
    from app.llm.evals import run_suite

    await database.create_all()
    r = await run_suite(a.tenant, a.provider, run_by="cli", pass_threshold=a.threshold)
    print(f"{r.provider} ({r.model_fast} / {r.model_smart}): {r.status.upper()} score {r.score_pct}% (threshold {r.pass_threshold_pct}%)")
    if r.summary.get("error"):
        print(r.summary["error"])
    for c in r.cases:
        mark = "PASS" if c["passed"] else "FAIL"
        failed = [x["name"] for x in c["checks"] if not x["passed"]]
        print(f"  [{mark}] {c['id']:<24} {c['latency_ms']:>6} ms  " + ("" if c["passed"] else "failed: " + "; ".join(failed)) + (f" ERROR {c['error']}" if c.get("error") else ""))
    s = r.summary
    if s.get("cases"):
        print(f"tokens in/out {s['input_tokens']}/{s['output_tokens']}, est. cost ${s['cost_usd']}, p50 {s['p50_latency_ms']} ms, p95 {s['p95_latency_ms']} ms")
    await database.engine.dispose()
    return 0 if r.status == "passed" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
