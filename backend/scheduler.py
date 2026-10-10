"""Distributed daily cadence: one article job per publish slot."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, time, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

logger = logging.getLogger("office.scheduler")


def _parse_hhmm(value: Any, default: Tuple[int, int] = (9, 0)) -> Tuple[int, int]:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return int(value), 0
    text = str(value).strip()
    if not text:
        return default
    if ":" in text:
        parts = text.split(":")
        try:
            return int(parts[0]), int(parts[1])
        except (TypeError, ValueError):
            return default
    try:
        return int(text), 0
    except (TypeError, ValueError):
        return default


def _minutes_since_midnight(hour: int, minute: int) -> int:
    return hour * 60 + minute


class DailyPublisher:
    """Kick off Rafa once per publish slot (spread across the local day).

    Config (office.yml → office:):
      articles_per_day: 3
      timezone: America/Sao_Paulo
      publish_slots: ["09:00", "13:00", "17:00"]   # preferred — one article each
      # OR evenly space articles_per_day between:
      schedule_window_start: "09:00"
      schedule_window_end: "17:00"
      # Legacy fallback for window start:
      daily_kickoff_hour / daily_kickoff_minute
    """

    def __init__(self, office: Any, config: Dict[str, Any]):
        self.office = office
        self.config = config
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        # slot keys already fired this process: "YYYY-MM-DD#0"
        self._fired_slots: set[str] = set()

    @property
    def enabled(self) -> bool:
        raw = os.getenv("OFFICE_SCHEDULER_ENABLED", "true").lower().strip()
        return raw not in {"0", "false", "no", "off"}

    @property
    def timezone(self) -> ZoneInfo:
        name = str(self.config.get("timezone") or "America/Sao_Paulo")
        try:
            return ZoneInfo(name)
        except Exception:
            return ZoneInfo("UTC")

    @property
    def articles_per_day(self) -> int:
        try:
            return max(1, int(self.config.get("articles_per_day") or 3))
        except (TypeError, ValueError):
            return 3

    @property
    def research_feeds(self) -> List[str]:
        feeds = self.config.get("research_feeds") or []
        return [str(item).strip() for item in feeds if str(item).strip()]

    def _now(self) -> datetime:
        return datetime.now(self.timezone)

    def publish_slots(self) -> List[Tuple[int, int]]:
        """Resolved (hour, minute) slots for today, length == articles_per_day."""
        n = self.articles_per_day
        raw_slots = self.config.get("publish_slots")
        if isinstance(raw_slots, list) and raw_slots:
            parsed = [_parse_hhmm(item) for item in raw_slots]
            # Trim or pad to articles_per_day
            if len(parsed) >= n:
                return parsed[:n]
            # Fewer slots than articles: repeat last spacing pattern by padding
            # with the last slot (still better than dumping all at once).
            while len(parsed) < n:
                parsed.append(parsed[-1])
            return parsed

        start_h, start_m = _parse_hhmm(
            self.config.get("schedule_window_start"),
            (
                int(self.config.get("daily_kickoff_hour", 9)),
                int(self.config.get("daily_kickoff_minute", 0)),
            ),
        )
        end_h, end_m = _parse_hhmm(self.config.get("schedule_window_end"), (17, 0))
        start_min = _minutes_since_midnight(start_h, start_m)
        end_min = _minutes_since_midnight(end_h, end_m)
        if end_min <= start_min:
            end_min = start_min + max(60, (n - 1) * 180)

        if n == 1:
            return [(start_h, start_m)]

        step = (end_min - start_min) / (n - 1)
        slots: List[Tuple[int, int]] = []
        for i in range(n):
            total = int(round(start_min + step * i))
            slots.append((total // 60, total % 60))
        return slots

    def _slot_key(self, day: str, index: int) -> str:
        return f"{day}#{index}"

    def _count_jobs_started_today(self) -> int:
        """Jobs opened today by Rafa / the scheduler."""
        today = self._now().date().isoformat()
        count = 0
        for _node_id, entry in list(self.office.board._node_registry.items()):
            if not isinstance(entry, dict):
                continue
            if entry.get("label") != "Job":
                continue
            props = entry.get("properties") or {}
            if props.get("archived"):
                continue
            author = str(props.get("author") or "")
            created = str(props.get("created_at") or props.get("opened_at") or "")
            title = str(props.get("title") or "")
            text = str(props.get("text") or "")
            blob = f"{author} {created} {title} {text}".lower()
            if today not in created and today not in blob:
                continue
            if (
                "rafa" in author.lower()
                or "scheduler" in author.lower()
                or "pauta do dia" in blob
                or "artigo do dia" in blob
                or "artigo #" in blob
            ):
                count += 1
        return count

    def _director_id(self) -> Optional[str]:
        for spec in self.office.agents.values():
            role = (spec.get("role") or "").lower()
            name = (spec.get("name") or "").lower()
            if name == "rafa" or "diretor" in role or "director" in role:
                return spec["id"]
        if self.office.agents:
            return next(iter(self.office.agents))
        return None

    def _brief(self, *, slot_index: int, slot_time: Tuple[int, int], total: int) -> str:
        feeds = self.research_feeds or ["https://news.ycombinator.com/"]
        feed_lines = "\n".join(f"- {url}" for url in feeds)
        hh, mm = slot_time
        template = str(self.config.get("kickoff_prompt") or "").strip()
        if not template:
            return (
                f"Daily slot {slot_index + 1}/{total} at {hh:02d}:{mm:02d} "
                f"({self._now().date().isoformat()}).\n"
                "Open exactly one new job for today's cadence and hand it to the "
                "appropriate teammate. Do not open multiple jobs for this slot.\n"
                f"Research feeds (if relevant):\n{feed_lines}"
            )
        return template.format(
            slot_index=slot_index + 1,
            total=total,
            hh=f"{hh:02d}",
            mm=f"{mm:02d}",
            feeds=feed_lines,
            date=self._now().date().isoformat(),
        )

    def due_slot(self, now: Optional[datetime] = None) -> Optional[int]:
        """Return the next slot index that should fire now, or None."""
        now = now or self._now()
        day = now.date().isoformat()
        already = self._count_jobs_started_today()
        slots = self.publish_slots()
        n = len(slots)
        if already >= n:
            return None

        now_hm = (now.hour, now.minute)
        # Fire the earliest unfired slot whose time has arrived.
        # Use job count as durable progress across restarts; in-memory set
        # avoids double-fire within the same process between ticks.
        for index, slot in enumerate(slots):
            if index < already:
                continue
            key = self._slot_key(day, index)
            if key in self._fired_slots:
                continue
            if now_hm >= slot:
                return index
            break
        return None

    def schedule_snapshot(self) -> Dict[str, Any]:
        slots = self.publish_slots()
        return {
            "enabled": self.enabled,
            "articles_per_day": self.articles_per_day,
            "timezone": str(self.config.get("timezone") or "America/Sao_Paulo"),
            "publish_slots": [f"{h:02d}:{m:02d}" for h, m in slots],
            "jobs_started_today": self._count_jobs_started_today(),
            "next_due_slot": self.due_slot(),
        }

    async def kickoff(
        self,
        *,
        force: bool = False,
        slot_index: Optional[int] = None,
    ) -> Dict[str, Any]:
        director_id = self._director_id()
        if not director_id:
            return {"ok": False, "error": "No director agent configured"}

        now = self._now()
        day = now.date().isoformat()
        slots = self.publish_slots()
        n = len(slots)
        already = self._count_jobs_started_today()

        if already >= n and not force:
            logger.info("Daily quota already met (%s/%s jobs)", already, n)
            return {"ok": True, "skipped": True, "already": already, "target": n}

        if slot_index is None:
            if force:
                slot_index = min(already, n - 1)
            else:
                slot_index = self.due_slot(now)
                if slot_index is None:
                    return {"ok": True, "skipped": True, "reason": "no_slot_due", "already": already}

        slot_index = max(0, min(int(slot_index), n - 1))
        slot_time = slots[slot_index]
        key = self._slot_key(day, slot_index)

        if key in self._fired_slots and not force:
            return {"ok": True, "skipped": True, "reason": "slot_already_fired", "slot": slot_index}

        prompt = self._brief(slot_index=slot_index, slot_time=slot_time, total=n)
        hh, mm = slot_time
        posted = await self.office.dispatch_task(
            director_id,
            prompt,
            author="Scheduler",
            title=f"Artigo #{slot_index + 1}/{n} · {hh:02d}:{mm:02d}",
            allow_duplicate=True,
        )
        self._fired_slots.add(key)
        logger.info(
            "Slot kickoff %s/%s (%02d:%02d) dispatched to %s (task=%s)",
            slot_index + 1,
            n,
            hh,
            mm,
            director_id,
            posted.get("id"),
        )
        return {
            "ok": True,
            "posted": posted,
            "slot": slot_index,
            "slot_time": f"{hh:02d}:{mm:02d}",
            "already": already,
            "target": n,
        }

    async def _loop(self) -> None:
        await asyncio.sleep(8)
        while not self._stop.is_set():
            try:
                due = self.due_slot()
                if due is not None:
                    await self.kickoff(slot_index=due)
            except Exception:
                logger.exception("Daily scheduler tick failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=45)
            except asyncio.TimeoutError:
                continue

    async def start(self) -> None:
        if not self.enabled:
            logger.info(
                "DailyPublisher disabled (OFFICE_SCHEDULER_ENABLED=false) — slots=%s",
                [f"{h:02d}:{m:02d}" for h, m in self.publish_slots()],
            )
            return
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())
        slots = [f"{h:02d}:{m:02d}" for h, m in self.publish_slots()]
        logger.info(
            "DailyPublisher started (articles_per_day=%s, slots=%s %s)",
            self.articles_per_day,
            slots,
            self.config.get("timezone") or "America/Sao_Paulo",
        )

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
