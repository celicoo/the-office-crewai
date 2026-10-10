"""Plain tool objects. CrewAI wraps them when a desk actually runs."""

from __future__ import annotations

import inspect
from typing import Any, Callable, Optional


class Tool:
    def __init__(
        self,
        func: Callable,
        name: Optional[str] = None,
        description: Optional[str] = None,
        args_schema: Optional[Any] = None,
    ):
        self.func = func
        self.name = name or func.__name__
        self.description = (description or func.__doc__ or f"Execute {self.name}").strip()
        self.args_schema = args_schema
        self.context_name = "default"

    async def execute(self, *args, **kwargs) -> Any:
        if inspect.iscoroutinefunction(self.func):
            return await self.func(*args, **kwargs)
        return self.func(*args, **kwargs)
