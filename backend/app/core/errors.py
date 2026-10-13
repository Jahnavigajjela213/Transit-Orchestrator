class ProductAPIError(Exception):
    """A product system rejected or failed an action."""

    def __init__(self, system: str, action: str, message: str, transient: bool = False):
        super().__init__(f"{system}.{action}: {message}")
        self.system = system
        self.action = action
        self.message = message
        self.transient = transient


class PolicyViolation(Exception):
    """An agent tried to act outside the permissions of the persona it serves."""


class WorkflowError(Exception):
    pass
