"""Domain agents and the supervisor that coordinates them.

The workflow graphs (orchestrator/graph.py, orchestrator/noshow.py) are the supervisor's plans. Every read
and write against a product goes through the domain agent that owns that product, via `supervisor.delegate`.
"""
from app.agents.domain import AGENTS, DomainAgent
from app.agents.supervisor import supervisor

__all__ = ["AGENTS", "DomainAgent", "supervisor"]
