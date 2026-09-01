"""Proactive alerts: the dashboard asserting itself.

SCOPE.md §6 P4-1. When the Composite Instability Index crosses a threshold the
panel stops being something you have to look at and becomes something that
tells you. That is the feature that changes what the product is — and it is
also the feature most easily ruined, in exactly one way: **an alert that fires
too often stops being an alert.** Everything in this file is about that.

Four guards, and none of them is optional.

**Hysteresis, not a bare threshold.** A score oscillating around 85 against a
threshold of 85 fires, clears, fires and clears. It has to fall a margin below
the line before it can fire again, so one crossing is one alert.

**A minimum interval between spoken alerts.** Several regions can cross at
once. The visual state carries all of them; the voice speaks the most severe
and stays quiet about the rest.

**Quiet hours silence the voice, never the display.** The point of a quiet
window is not waking the house, not hiding the situation. An alert raised at
3am is still on the panel at 3am; it simply does not announce itself.

**A degraded or stale reading never raises an alert.** `GetRiskScores` reports
both. An alert is a claim about the world; a stale cache is a claim about the
cache, and speaking one as the other is a correctness bug in a situational-
awareness display rather than a matter of taste.

The speech is templated here rather than generated. The scope's own example -
"Alert. Instability index for Sudan has risen to eighty-seven." - is a
template, and a model would cost eight to twelve seconds on this CPU, drift out
of register over a long session, and occasionally get the number wrong. The
same argument as tier 0 in `router.py`: the most valuable thing this path does
is not use a model.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, time as clock_time
from typing import Any, Callable, Iterable

log = logging.getLogger("wm_voice.alerts")

#: Rule kinds. `level` is "at or above this score"; `rise` is "moved up by at
#: least this much in 24 hours". Both are needed: a jump from 40 to 55 is news
#: even though 55 clears no level threshold, and a region parked at 90 is news
#: even though it moved by nothing.
LEVEL = "level"
RISE = "rise"

#: Matches one rule: `Sudan>75`, `*>85`, `Taiwan+12`.
RULE = re.compile(r"^\s*(?P<region>[^>+]+?)\s*(?P<op>[>+])\s*(?P<value>-?\d+(?:\.\d+)?)\s*$")

#: `22:00-07:00`, wrapping midnight.
WINDOW = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$")


@dataclass(frozen=True)
class Rule:
    """One user-editable threshold."""

    region: str
    kind: str
    value: float

    @property
    def is_catch_all(self) -> bool:
        return self.region == "*"

    def matches(self, region: str) -> bool:
        return self.is_catch_all or self.region.lower() == region.lower()

    def fires(self, reading: "Reading") -> bool:
        if self.kind == LEVEL:
            return reading.score >= self.value
        return reading.delta >= self.value

    def clears(self, reading: "Reading", margin: float) -> bool:
        """The other side of the hysteresis band.

        Deliberately not `not fires()`: a reading sitting exactly on the line
        would then alternate between the two on every poll.
        """
        if self.kind == LEVEL:
            return reading.score <= self.value - margin
        return reading.delta <= self.value - margin


@dataclass(frozen=True)
class Reading:
    """One region's current standing, as the watcher sees it."""

    region: str
    score: float
    #: Approximate 24-hour movement. Positive means rising.
    delta: float = 0.0


@dataclass(frozen=True)
class Alert:
    """A threshold crossing, ready to be spoken and displayed."""

    region: str
    score: float
    delta: float
    kind: str
    threshold: float


@dataclass
class _State:
    """What the watcher remembers about one region."""

    firing: bool = False
    rule: Rule | None = None


def parse_rules(spec: str) -> list[Rule]:
    """Parses `WM_ALERT_RULES`. Never raises.

    A malformed rule is logged and skipped rather than taking the sidecar down.
    The alternative - refusing to start because one entry has a typo - turns a
    misconfigured threshold into a dead panel, which is strictly worse than a
    panel running the rules it could understand.
    """
    rules: list[Rule] = []
    for chunk in spec.replace("\n", ",").split(","):
        if not chunk.strip():
            continue
        match = RULE.match(chunk)
        if not match:
            log.warning("ignoring malformed alert rule: %r", chunk.strip())
            continue
        rules.append(
            Rule(
                region=match.group("region").strip(),
                kind=LEVEL if match.group("op") == ">" else RISE,
                value=float(match.group("value")),
            )
        )
    return rules


def parse_window(spec: str) -> tuple[clock_time, clock_time] | None:
    """Parses `WM_ALERT_QUIET_HOURS`. Empty or malformed means no quiet window."""
    if not spec.strip():
        return None
    match = WINDOW.match(spec)
    if not match:
        log.warning("ignoring malformed quiet-hours window: %r", spec)
        return None
    start_h, start_m, end_h, end_m = (int(g) for g in match.groups())
    if not (0 <= start_h < 24 and 0 <= end_h < 24 and start_m < 60 and end_m < 60):
        log.warning("quiet-hours window out of range: %r", spec)
        return None
    return clock_time(start_h, start_m), clock_time(end_h, end_m)


def in_window(now: clock_time, window: tuple[clock_time, clock_time] | None) -> bool:
    """True inside the window, which may wrap midnight (22:00-07:00 usually does)."""
    if window is None:
        return False
    start, end = window
    if start <= end:
        return start <= now < end
    return now >= start or now < end


def readings_from_risk_scores(payload: Any) -> tuple[list[Reading], bool]:
    """Maps `GetRiskScoresResponse` to readings, plus whether it is trustworthy.

    Field names come from the generated client
    (`src/generated/client/worldmonitor/intelligence/v1/service_client.ts`),
    not from guesswork: `ciiScores[].combinedScore`, `.dynamicScore`, and the
    response-level `degraded` / `stale` flags.

    COUPLING: this is the one place that knows the shape of an upstream API
    response. If the schema moves, it moves here.
    """
    if not isinstance(payload, dict):
        return [], False

    trustworthy = not payload.get("degraded") and not payload.get("stale")

    readings: list[Reading] = []
    for entry in payload.get("ciiScores") or []:
        if not isinstance(entry, dict):
            continue
        region = entry.get("region")
        score = entry.get("combinedScore")
        if not isinstance(region, str) or not region:
            continue
        if not isinstance(score, (int, float)) or isinstance(score, bool):
            continue
        delta = entry.get("dynamicScore")
        readings.append(
            Reading(
                region=region,
                score=float(score),
                delta=float(delta) if isinstance(delta, (int, float)) and not isinstance(delta, bool) else 0.0,
            )
        )
    return readings, trustworthy


class AlertWatcher:
    """Decides what is worth interrupting someone for.

    Pure apart from the two injected clocks, which is the point: the judgement
    here is the whole feature, and it has to be testable without waiting a day
    for a quiet-hours window to arrive.
    """

    def __init__(
        self,
        rules: Iterable[Rule],
        *,
        clear_margin: float = 5.0,
        min_interval_s: float = 900.0,
        quiet_hours: tuple[clock_time, clock_time] | None = None,
        speak: bool = True,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._rules = list(rules)
        self._clear_margin = clear_margin
        self._min_interval_s = min_interval_s
        self._quiet_hours = quiet_hours
        self._speak = speak
        self._clock = clock
        self._wall_clock = wall_clock

        self._states: dict[str, _State] = {}
        self._last_spoke: float | None = None

    @property
    def enabled(self) -> bool:
        """False when no rules parsed. The loop does not run at all then."""
        return bool(self._rules)

    @property
    def active(self) -> bool:
        """True while any region is above its line. Drives `data-wm-alert`."""
        return any(state.firing for state in self._states.values())

    @property
    def firing_regions(self) -> list[str]:
        return sorted(region for region, state in self._states.items() if state.firing)

    def rule_for(self, reading: Reading) -> Rule | None:
        """The rule that applies, most specific first.

        A named region beats the catch-all, so `*>85, Sudan>75` means what it
        reads like. Among equally specific rules the lowest threshold wins,
        because a user who writes two is asking for the more sensitive one.
        """
        named = [r for r in self._rules if not r.is_catch_all and r.matches(reading.region)]
        candidates = named or [r for r in self._rules if r.is_catch_all]
        firing = [r for r in candidates if r.fires(reading)]
        if firing:
            return min(firing, key=lambda r: r.value)
        return min(candidates, key=lambda r: r.value) if candidates else None

    def evaluate(self, readings: Iterable[Reading], *, trustworthy: bool = True) -> list[Alert]:
        """Folds one poll into the alert state and returns what is newly raised.

        An untrustworthy reading changes nothing at all — it neither raises an
        alert nor clears one. Clearing on a stale feed would silently drop a
        live alert because the upstream cache hiccuped, which is the failure
        mode a monitor exists to prevent.
        """
        if not trustworthy:
            log.debug("risk scores degraded or stale; alert state held")
            return []

        raised: list[Alert] = []
        for reading in readings:
            rule = self.rule_for(reading)
            if rule is None:
                continue
            state = self._states.setdefault(reading.region, _State())

            if not state.firing and rule.fires(reading):
                state.firing = True
                state.rule = rule
                raised.append(
                    Alert(
                        region=reading.region,
                        score=reading.score,
                        delta=reading.delta,
                        kind=rule.kind,
                        threshold=rule.value,
                    )
                )
            elif state.firing and (state.rule or rule).clears(reading, self._clear_margin):
                state.firing = False
                state.rule = None

        return raised

    def to_announce(self, raised: list[Alert]) -> Alert | None:
        """Picks the one alert worth speaking, or none.

        Only one: several regions crossing together is common, and a queue of
        spoken alerts is how an always-on assistant becomes something you
        switch off. The display carries the rest.
        """
        if not raised or not self._speak:
            return None

        if in_window(self._wall_clock().time(), self._quiet_hours):
            # Silenced, not suppressed: the visual alert still asserts, and the
            # log records that someone would otherwise have been told.
            log.info("alert during quiet hours, not spoken: %s", raised[0].region)
            return None

        now = self._clock()
        if self._last_spoke is not None and now - self._last_spoke < self._min_interval_s:
            log.info("alert within the minimum interval, not spoken: %s", raised[0].region)
            return None

        self._last_spoke = now
        return max(raised, key=lambda a: a.score)


def speech(alert: Alert) -> str:
    """The spoken form. Two sentences, in register, with the number intact.

    `phrasing.speakable` turns the numeral into words at synthesis time, so the
    figure travels as a figure and is spoken as one — no rounding, and nothing
    for a model to get wrong on the way.
    """
    score = _plain(alert.score)
    if alert.kind == RISE:
        return f"Alert. Instability index for {alert.region} has risen {_plain(alert.delta)} points to {score}."
    return f"Alert. Instability index for {alert.region} has risen to {score}."


def _plain(value: float) -> str:
    """Whole numbers without a trailing `.0`.

    "eighty-seven point zero" is not how the computer says eighty-seven.
    """
    rounded = round(value, 1)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)
