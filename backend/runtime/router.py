"""Async pub/sub so a desk wakes when its task lands on the board."""

from __future__ import annotations

import asyncio
import fnmatch
import logging
from typing import Dict, List

from runtime.events import BlackboardEvent

logger = logging.getLogger("office.router")


class EventRouter:
    def __init__(self) -> None:
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, pattern: str) -> asyncio.Queue:
        async with self._lock:
            queue: asyncio.Queue = asyncio.Queue()
            self._subscribers.setdefault(pattern, []).append(queue)
            logger.debug("Subscriber registered for %s", pattern)
            return queue

    async def publish(self, event: BlackboardEvent) -> None:
        async with self._lock:
            deliveries = []
            for pattern, queues in self._subscribers.items():
                if fnmatch.fnmatch(event.key_path, pattern):
                    for queue in queues:
                        deliveries.append(queue.put(event))
            if deliveries:
                await asyncio.gather(*deliveries)
