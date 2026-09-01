"""Command interpretation: speech to a validated action.

P3's boundary. The model never touches application state - it names an action
or a tool, and everything after that is deterministic:

    user speech -> model -> validated action -> wm:action -> dashboard

**Two transports, one boundary.** A model with native tool calling returns a
structured call; one without returns constrained JSON. `interpret` normalises
both into the same shape and applies the same checks, so the guarantee does not
depend on how the model was asked. That matters more than which transport is
used: tool calling is the better mechanism when the model has it, because the
server parses the shape rather than us - but it is a transport, not a licence
to skip validation.

What is validated: the action must be one the dashboard published, and a panel
must be one it is actually rendering. Refusal is the default on every uncertain
path, because an assistant that guesses which panel you meant is worse than one
that says "Please specify" - the guess is silent and wrong, and nobody watches a
wall panel closely enough to catch it.

The dashboard then validates again before dispatching. One validation would be
a single point of trust in a language model's output.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .phrasing import TEMPLATES

# Response schema for constrained decoding, used when the model has no native
# tool calling. Constrained decoding makes a well-formed object near-certain;
# `interpret()` still checks, because a validator that trusts its input is not
# a validator.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {"type": ["string", "null"]},
        "argument": {"type": ["string", "null"]},
        "speech": {"type": "string"},
    },
    "required": ["speech"],
}

#: Tool names a native tool call may use, mapped to the action they dispatch.
#: Generated from the registry at call time; this is only the UI half, because
#: data tools are executed by the sidecar rather than dispatched.
UI_TOOL_ACTIONS = {
    "focus_panel": ("panel.focus", "panel"),
    "focus_map": ("map.focus", None),
    "cycle_theme": ("theme.cycle", None),
}


@dataclass
class Command:
    """One interpreted utterance."""

    speech: str
    action: str | None = None
    argument: str | None = None
    #: A data tool the sidecar should execute before answering, if any.
    tool: str | None = None
    tool_arguments: dict[str, Any] = field(default_factory=dict)
    #: Why an action the model asked for was refused. Empty when none was asked
    #: for, or when it was accepted.
    refusals: list[str] = field(default_factory=list)

    @property
    def performs(self) -> bool:
        return self.action is not None

    @property
    def needs_tool(self) -> bool:
        return self.tool is not None


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
        # Keys and titles only - deliberately NOT the readings.
        #
        # Pushing every panel's numbers into every prompt is the trap this
        # design avoids: it costs prompt-processing time on a CPU for data the
        # model usually does not need, and it grows without bound as panels are
        # added. The model asks for a reading with a tool when it wants one.
        # What it needs here is the vocabulary - which panels exist, so it can
        # name one - not their contents.
        lines.append("Panels on the dashboard:")
        for panel in panels:
            key = panel.get("key", "")
            lines.append("- " + str(key) + " (" + str(panel.get("title", key)) + ")")

    if snapshot.get("alert"):
        lines.append("The dashboard is in an alert state.")

    lines.append("Current theme: " + str(snapshot.get("theme", "default")))
    return "\n".join(lines)


SYSTEM_PROMPT = """You are the World Monitor intelligence interface, a \
computer controlling a situational-awareness dashboard by voice.

Use a tool whenever current information is required. Never invent current \
events: if a tool did not return it, it is not available. When a tool returns \
structured data, summarise it naturally rather than reading it out. When the \
user asks for the display to change, call the tool rather than explaining how.

Without native tool calling, reply with a JSON object only, no prose outside it:

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

    # A native tool call arrives as {"tool": ..., "arguments": {...}}. It is
    # normalised into the same shape as the JSON contract so that the checks
    # below apply identically regardless of which transport produced it - the
    # boundary must not depend on how the model was asked.
    tool_name = parsed.get("tool")
    if isinstance(tool_name, str) and tool_name:
        arguments = parsed.get("arguments")
        arguments = arguments if isinstance(arguments, dict) else {}

        mapping = UI_TOOL_ACTIONS.get(tool_name)
        if mapping is None:
            # Not a UI tool. It may be a data tool, which the caller executes
            # and then asks again with the result; validation of the tool name
            # itself belongs to the registry, not here.
            return Command(speech=speech, tool=tool_name, tool_arguments=arguments)

        action_name, argument_key = mapping
        parsed = dict(parsed)
        parsed["action"] = action_name
        parsed["argument"] = arguments.get(argument_key) if argument_key else None

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
