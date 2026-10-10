"""Blackboard events the desks subscribe to."""

from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class EventType(Enum):
    NODE_INSERTED = "node:inserted"
    NODE_UPDATED = "node:updated"
    EDGE_INSERTED = "edge:inserted"
    ERROR = "error"


@dataclass(frozen=True)
class LineageContext:
    triggering_event_id: str
    agent_name: str
    rationale: str
    sources_used: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class BlackboardEvent:
    event_type: EventType
    key_path: str
    payload: Dict[str, Any]
    epoch_version: int
    timestamp: datetime.datetime
    priority: int = 100
    event_id: str = field(default_factory=lambda: f"EV-{uuid.uuid4().hex[:8]}")
