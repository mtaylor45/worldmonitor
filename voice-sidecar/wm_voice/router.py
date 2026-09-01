"""Intent routing: decide how much model a turn actually needs.

Three tiers, cheapest first. On a 4-core Skylake the model is the whole latency
budget, so the most valuable thing this file does is avoid using one.

    "zoom out"                    -> tier 0, no model at all
    "focus the markets panel"     -> tier 0, no model at all
    "what is happening in taiwan" -> tier 2, the full model plus tools

**Tier 0 is not a fallback for a broken model — it is the fast path for the
commands people actually repeat.** A wall panel gets "louder", "next", "show
the map" far more often than it gets a geopolitical question, and none of those
should wake an 8B.

Tier 1 (a small model for short conversational replies) is configured but
optional: a second resident model costs RAM and adds a second thing to keep
loaded, and it only pays off once tier 0's coverage stops growing. Measure
before enabling it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class Tier(Enum):
    """Which engine handles this utterance."""

    #: Pattern match. No model, no network, sub-millisecond.
    DIRECT = 0
    #: Small model. Short conversational replies with no tool use.
    FAST = 1
    #: Full model with tools. Anything needing data or several steps.
    FULL = 2


@dataclass
class Route:
    tier: Tier
    #: For DIRECT, the action to dispatch and its argument.
    action: str | None = None
    argument: str | None = None
    #: What to say. DIRECT routes speak a fixed acknowledgement.
    speech: str | None = None
    reason: str = ""


# Fixed commands, matched before any model runs. Deliberately small: every
# entry is a phrase a user repeats, and anything ambiguous belongs to the model
# rather than to a regex that will eventually guess wrong.
DIRECT_PATTERNS: list[tuple[re.Pattern[str], str, str | None, str]] = [
    (re.compile(r"\b(next|change|cycle) (the )?(theme|display|colou?rs?)\b"),
     "theme.cycle", None, "Acknowledged."),
    (re.compile(r"\bshow (me )?(the )?(map|globe)\b"), "map.focus", None, "Acknowledged."),
    (re.compile(r"\b(focus|show) (the )?map\b"), "map.focus", None, "Acknowledged."),
]

# "focus the markets panel" / "show me country instability" - the panel name is
# resolved against the live panel list rather than a pattern, so a panel the
# dashboard is not rendering never matches.
PANEL_INTENT = re.compile(
    r"\b(?:focus|show|open|go to|take me to)\b(?: me)?(?: the)?\s+(?P<name>[a-z0-9 &/-]{3,40}?)"
    r"(?:\s+panel)?\s*$",
    re.IGNORECASE,
)

# An utterance that OPENS with a navigation verb is a command, even when it
# also contains a topic word. "take me to live news" names the Live News panel;
# it is not a request for news. Anchored to the start so "what is on the
# markets panel" - a question - does not match.
NAV_OPENER = re.compile(
    r"^\s*(?:focus|show|open|go to|take me to|switch to|display)\b", re.IGNORECASE
)

# Utterances that clearly need data or reasoning. Checked after navigation so a
# question never gets a pattern's guess at current events.
NEEDS_DATA = re.compile(
    r"\b(what|why|how|when|where|who|which|status|situation|happening|latest|brief|"
    r"summar|report|risk|threat|market|conflict|news|compare|anything)\b",
    re.IGNORECASE,
)


def normalise(text: str) -> str:
    text = text.lower().strip()
    # The wake word survives recognition often enough to matter.
    text = re.sub(r"^(computer|hey computer)[,\s]+", "", text)
    return re.sub(r"[.?!]+$", "", text).strip()


def match_panel(text: str, panels: dict[str, str]) -> str | None:
    """Resolves a spoken panel name against the dashboard's real panel list.

    `panels` maps key -> title. Matching is on either, because a user says
    "country instability" and the key is "cii". A name that matches nothing
    returns None and the utterance goes to the model, which is the right
    outcome - guessing the nearest panel is exactly the silent wrong answer
    this project keeps refusing to make.
    """
    match = PANEL_INTENT.search(text)
    if not match:
        return None
    name = match.group("name").strip().lower()
    if not name:
        return None

    for key, title in panels.items():
        if name == key.lower() or name == title.lower():
            return key
    # Substring, but only when exactly one panel matches - two candidates is an
    # ambiguity, and the model handles those.
    hits = [k for k, t in panels.items() if name in t.lower() or name in k.lower()]
    return hits[0] if len(hits) == 1 else None


def route(text: str, snapshot: dict[str, object], *, fast_model: bool = False) -> Route:
    """Chooses a tier for one utterance."""
    normalised = normalise(text)
    if not normalised:
        return Route(Tier.DIRECT, speech=None, reason="empty")

    actions = set(snapshot.get("actions") or [])  # type: ignore[arg-type]
    panels = {
        str(p.get("key")): str(p.get("title") or p.get("key"))
        for p in (snapshot.get("panels") or [])  # type: ignore[union-attr]
        if p.get("key")
    }

    for pattern, action, argument, speech in DIRECT_PATTERNS:
        if pattern.search(normalised) and action in actions:
            return Route(Tier.DIRECT, action=action, argument=argument,
                         speech=speech, reason="fixed command")

    # Navigation before the data check. An utterance opening with a navigation
    # verb that resolves to a real panel is a command, even when it contains a
    # topic word - "take me to live news" names a panel, it does not ask for
    # news. A panel that does not resolve falls through to the model rather
    # than being guessed at.
    if NAV_OPENER.search(normalised) and "panel.focus" in actions:
        panel = match_panel(normalised, panels)
        if panel:
            return Route(Tier.DIRECT, action="panel.focus", argument=panel,
                         speech="Acknowledged.", reason="panel named directly")

    # A question about the world always goes to the full model. "what is on the
    # markets panel" contains a panel name but is not navigation, and answering
    # it by scrolling would be wrong.
    if NEEDS_DATA.search(normalised):
        return Route(Tier.FULL, reason="needs data or reasoning")

    if fast_model:
        return Route(Tier.FAST, reason="short utterance, no data needed")
    return Route(Tier.FULL, reason="no fast path available")
