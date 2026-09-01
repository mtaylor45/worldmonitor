"""Command interpretation: speech to a validated action.

P3's boundary. The model never touches application state - it emits a JSON
object naming an action, and everything after that is deterministic:

    user speech -> model -> JSON -> validated action -> wm:action -> dashboard

**This deliberately does not use Ollama's tool-calling API.** Two reasons, and
the second is the important one.

The practical reason: Gemma has no native tool calling in Ollama, and Gemma is
the right model for this hardware. A 7B at roughly 3-5 tok/s on a 4-core
Skylake spends four to seven seconds on a twenty-token reply, which fails the
three-second budget before the pipeline has done anything else. An E2B-class
model is several times faster and comfortably inside it.

The architectural reason: tool calling would hand the model a mechanism that
*looks* like it performs actions. What is wanted is a model that describes an
intention, checked against a registry it cannot influence. A JSON contract plus
this validator IS the deterministic boundary; the tool-calling API would be a
less legible way to reach the same place, with a hard model requirement
attached.

Constrained decoding (`format` as a JSON schema, supported by Ollama) makes the
shape reliable. This module assumes it can still be violated, because a
validator that trusts its input is not one.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .phrasing import TEMPLATES

# The response schema handed to Ollama's `format` parameter. Constrained
# decoding makes a well-formed object near-certain; `interpret()` still checks.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {"type": ["string", "null"]},
        "argument": {"type": ["string", "null"]},
        "speech": {"type": "string"},
    },
    "required": ["speech"],
}


@dataclass
class Command:
    """One interpreted utterance."""

    speech: str
    action: str | None = None
    argument: str | None = None
    #: Why an action the model asked for was refused. Empty when none was asked
    #: for, or when it was accepted.
    refusals: list[str] = field(default_factory=list)

    @property
    def performs(self) -> bool:
        return self.action is not None


def build_prompt(snapshot: dict[str, Any]) -> str:
    """Renders the dashboard snapshot and the action list for the model.

    Compact on purpose: every token here is paid for twice on a CPU, once in
    prompt processing and once in the latency budget.
    """
    lines: list[str] = []

    actions = snapshot.get("actions") or []
    if actions:
        lines.append("Actions you may request: " + ", ".join(sorted(actions)))

    panels = snapshot.get("panels") or []
    if panels:
        lines.append("Panels on the dashboard:")
        for panel in panels:
            key = panel.get("key", "")
            title = panel.get("title", key)
            readings = panel.get("readings") or {}
            rendered = "; ".join(f"{k} {v}" for k, v in readings.items())
            lines.append(f"- {key} ({title}){': ' + rendered if rendered else ''}")

    if snapshot.get("alert"):
        lines.append("The dashboard is in an alert state.")

    lines.append("Current theme: " + str(snapshot.get("theme", "default")))
    return "\n".join(lines)


SYSTEM_PROMPT = """You are the computer of a starship, controlling a \
situational-awareness dashboard.

Reply with a JSON object only. No prose outside it.

  action    the action to perform, exactly as listed, or null to only speak
  argument  the action's argument if it takes one, otherwise null
  speech    what you will say aloud

Rules for `speech`, without exception:
- One or two sentences. Never three.
- No contractions.
- Never begin a sentence with "I". You have no first person.
- No pleasantries, apologies, hedging, or offers of further help.
- State numbers with their units.
- If the request was ambiguous, set action to null and say exactly \
"Please specify."

Only use an action from the list. Only use a panel key from the dashboard. If \
the request names something not on the dashboard, set action to null and say \
exactly "That information is not available."
"""

# A model asked for JSON will sometimes wrap it in a fence anyway.
FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)


def _loads(raw: str) -> dict[str, Any] | None:
    candidate = raw.strip()
    fenced = FENCE.match(candidate)
    if fenced:
        candidate = fenced.group(1)
    try:
        value = json.loads(candidate)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def interpret(raw: str, snapshot: dict[str, Any]) -> Command:
    """Turns a model response into a Command, refusing anything unverifiable.

    Refusal is the default on every uncertain path. An assistant that guesses
    which panel you meant is worse than one that says "Please specify": the
    guess is silent and wrong, and on a wall panel nobody is watching closely
    enough to catch it.
    """
    parsed = _loads(raw)
    if parsed is None:
        # Not JSON at all. The model may still have said something useful, but
        # a free-text reply cannot be told apart from a hallucinated action, so
        # it is refused wholesale rather than partially trusted.
        return Command(speech=TEMPLATES["unavailable"], refusals=["response was not JSON"])

    speech = parsed.get("speech")
    speech = speech.strip() if isinstance(speech, str) and speech.strip() else TEMPLATES["acknowledged"]

    requested = parsed.get("action")
    if not isinstance(requested, str) or not requested:
        return Command(speech=speech)

    refusals: list[str] = []
    allowed = set(snapshot.get("actions") or [])
    if requested not in allowed:
        refusals.append(f"unknown action {requested!r}")
        return Command(speech=TEMPLATES["refused"], refusals=refusals)

    argument = parsed.get("argument")
    argument = argument.strip() if isinstance(argument, str) and argument.strip() else None

    # `panel.focus` is the one action whose argument names something that must
    # exist. A key the dashboard does not render would dispatch, do nothing,
    # and look exactly like a broken display.
    if requested == "panel.focus":
        keys = {p.get("key") for p in snapshot.get("panels") or []}
        if argument is None:
            refusals.append("panel.focus without a panel")
            return Command(speech=TEMPLATES["ambiguous"], refusals=refusals)
        if argument not in keys:
            refusals.append(f"panel {argument!r} is not on the dashboard")
            return Command(speech=TEMPLATES["unavailable"], refusals=refusals)

    return Command(speech=speech, action=requested, argument=argument)
