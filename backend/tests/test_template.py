"""The workflow template in docs/PATTERN_GUIDE.md must stay buildable against the real orchestrator APIs."""
from langgraph.checkpoint.memory import MemorySaver

from app.orchestrator import template


def test_workflow_template_compiles():
    graph = template.build_graph().compile(checkpointer=MemorySaver())
    nodes = set(graph.get_graph().nodes)
    assert {"assess", "gate_act", "exec_act", "gate_notify", "exec_notify", "close"} <= nodes
