"""The voice sidecar wire protocol.

Mirrors `src/voice/protocol.ts`. A contract test in each language asserts the
two agree: two implementations of one protocol in two languages is exactly the
sort of thing that drifts silently and then fails on the one machine nobody is
sitting in front of.

JSON over a plain WebSocket. No framing library, no schema runtime - the
message set is small enough to read in one screen.
"""

from __future__ import annotations

import json
from typing import Any, Literal

# SCOPE.md §5 P2 names three states - idle, listening, speaking. "thinking" is a
# deliberate addition: there is up to three seconds between end-of-speech and
# first audio on this hardware, and showing LISTENING through it is a lie while
# showing nothing reads as a hang.
VOICE_STATES: tuple[str, ...] = ("idle", "listening", "thinking", "speaking")

SERVER_MESSAGES: tuple[str, ...] = ("state", "wake", "transcript", "response", "error")
CLIENT_MESSAGES: tuple[str, ...] = ("hello", "ptt", "cancel")

# Bumped when a message changes shape, never for additions.
PROTOCOL_VERSION = 1

VoiceState = Literal["idle", "listening", "thinking", "speaking"]


def state(value: str) -> str:
    """Frame: what the assistant is doing."""
    if value not in VOICE_STATES:
        raise ValueError("unknown voice state: " + value)
    return json.dumps({"type": "state", "state": value})


def wake(confidence: float | None = None) -> str:
    """Frame: wake word detected.

    Emitted the instant the detector fires, BEFORE recognition has produced
    anything, so the dashboard can sound the chirp immediately. That latency is
    the only latency the user actually perceives.
    """
    payload: dict[str, Any] = {"type": "wake"}
    if confidence is not None:
        payload["confidence"] = confidence
    return json.dumps(payload)


def transcript(text: str, final: bool) -> str:
    """Frame: recognised speech. `final` false for partial hypotheses."""
    return json.dumps({"type": "transcript", "text": text, "final": final})


def response(text: str) -> str:
    """Frame: what the assistant is about to say, post-phrasing-layer."""
    return json.dumps({"type": "response", "text": text})


def error(message: str) -> str:
    """Frame: something failed. The dashboard shows it and returns to idle."""
    return json.dumps({"type": "error", "message": message})


def parse_client_message(raw: str) -> dict[str, Any] | None:
    """Narrows an untrusted frame from the dashboard.

    A malformed frame is dropped rather than raised on: the sidecar runs
    unattended, and one bad message must not end the session.
    """
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(value, dict):
        return None

    kind = value.get("type")
    if kind not in CLIENT_MESSAGES:
        return None
    if kind == "ptt" and not isinstance(value.get("pressed"), bool):
        return None
    return value
