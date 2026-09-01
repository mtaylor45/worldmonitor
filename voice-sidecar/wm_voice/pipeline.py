"""Turn orchestration: wake or push-to-talk, through to spoken audio.

The adapters (wake word, STT, LLM, TTS, audio out) are injected as protocols
rather than imported, for one practical reason: none of them can run in CI.
openWakeWord wants a microphone, faster-whisper wants a model file, Ollama
wants a server. The *sequencing* is where the bugs live — state transitions,
the chirp firing before recognition, the phrasing layer sitting between the
model and the speaker, the latency budget - and all of that is testable with
fakes.

The three-second acceptance target (SCOPE.md §5 P2, end-of-speech to first
audio) is measured here rather than inferred: `Turn.timings` records each
stage, so a regression names the stage that caused it instead of a total.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol

from .commands import Command, interpret
from .phrasing import TEMPLATES, enforce, speakable
from .router import Tier, route
from .tools import ToolRegistry

# SCOPE.md §5 P2. Measured from end-of-speech to the first audio sample.
LATENCY_BUDGET_S = 3.0


class SpeechToText(Protocol):
    async def transcribe(self, audio: bytes) -> str: ...


class LanguageModel(Protocol):
    async def answer(self, question: str, snapshot: dict[str, object]) -> str: ...


class TextToSpeech(Protocol):
    async def synthesize(self, text: str) -> bytes: ...


class AudioSink(Protocol):
    async def play(self, wav: bytes) -> None: ...


class Events(Protocol):
    """Everything the dashboard is told. Implemented by the WebSocket server."""

    async def state(self, value: str) -> None: ...
    async def wake(self, confidence: float | None = None) -> None: ...
    async def transcript(self, text: str, final: bool) -> None: ...
    async def response(self, text: str) -> None: ...
    async def error(self, message: str) -> None: ...
    async def action(self, name: str, argument: str | None = None) -> None: ...
    async def alert(
        self, active: bool, region: str | None = None, score: float | None = None
    ) -> None: ...


@dataclass
class Turn:
    """One utterance, with the timing of every stage that produced it."""

    transcript: str = ""
    spoken: str = ""
    ok: bool = False
    drift: list[str] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)
    #: The action dispatched, if any. P3.
    action: str | None = None
    argument: str | None = None
    #: Which tier handled this turn: direct, fast or full.
    tier: str = "full"
    #: A data tool that ran, if any.
    tool: str | None = None
    #: Why an action the model asked for was refused.
    refusals: list[str] = field(default_factory=list)

    @property
    def total_s(self) -> float:
        """End-of-speech to first audio. The number the budget is about."""
        return sum(self.timings.values())

    @property
    def within_budget(self) -> bool:
        return self.total_s <= LATENCY_BUDGET_S


class Pipeline:
    """Sequences one turn and reports state as it goes."""

    def __init__(
        self,
        stt: SpeechToText,
        llm: LanguageModel,
        tts: TextToSpeech,
        audio: AudioSink,
        events: Events,
        *,
        clock: Callable[[], float] = time.monotonic,
        tools: ToolRegistry | None = None,
        fast_model: bool = False,
    ) -> None:
        self._tools = tools
        self._fast_model = fast_model
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._audio = audio
        self._events = events
        self._clock = clock
        #: Latest dashboard snapshot. Empty until the dashboard sends one,
        #: which means the model may request no actions at all until then -
        #: deliberately, since acting on a dashboard it has never seen is
        #: worse than refusing.
        self._snapshot: dict[str, object] = {}

    def update_snapshot(self, snapshot: dict[str, object]) -> None:
        """Replaces the dashboard context the model reasons over."""
        self._snapshot = snapshot
        if self._tools is not None:
            self._tools.update(snapshot)

    async def on_wake(self, confidence: float | None = None) -> None:
        """Wake word fired.

        Announced immediately, before any recognition has happened, so the
        dashboard can sound the chirp. That acknowledgement is the only latency
        the user actually perceives; everything after it can take a second.
        """
        await self._events.wake(confidence)
        await self._events.state("listening")

    async def run(self, audio: bytes) -> Turn:
        """Runs one utterance end to end. Never raises."""
        turn = Turn()

        try:
            async with _stage(turn, "stt", self._clock):
                turn.transcript = (await self._stt.transcribe(audio)).strip()

            if not turn.transcript:
                # Silence, or the wake word with nothing after it. Say nothing:
                # a spoken "no input detected" on every false trigger is how an
                # always-on assistant becomes something you switch off.
                #
                # No state event here - `finally` emits idle on every path, and
                # emitting it twice makes the dashboard's state log misleading
                # about how many turns actually ran.
                return turn

            await self._events.transcript(turn.transcript, True)

            # Tier 0: a command the router recognises outright. No model, no
            # network - and on this CPU the model IS the latency budget, so
            # the most valuable thing the pipeline does is skip it. A wall
            # panel gets "show the map" far more often than it gets a
            # geopolitical question.
            decision = route(turn.transcript, self._snapshot, fast_model=self._fast_model)
            turn.tier = decision.tier.name.lower()
            if decision.tier is Tier.DIRECT:
                if decision.action:
                    turn.action, turn.argument = decision.action, decision.argument
                    await self._events.response(decision.speech or TEMPLATES["acknowledged"])
                    await self._events.action(decision.action, decision.argument)
                    turn.spoken = decision.speech or TEMPLATES["acknowledged"]
                    turn.ok = True
                    await self._speak(turn)
                return turn

            await self._events.state("thinking")

            async with _stage(turn, "llm", self._clock):
                candidate = await self._llm.answer(turn.transcript, self._snapshot)

            # A data tool: run it, then ask again with the result. One round
            # only - a second would double the model cost, and on this hardware
            # that is the difference between a pause and a hang.
            probe = interpret(candidate, self._snapshot)
            if probe.needs_tool and self._tools is not None:
                async with _stage(turn, "tool", self._clock):
                    ok, result = await self._tools.call(probe.tool or "", probe.tool_arguments)
                turn.tool = probe.tool
                if ok:
                    async with _stage(turn, "llm2", self._clock):
                        candidate = await self._llm.answer(
                            turn.transcript + "\n\nTool result: " + json.dumps(result),
                            self._snapshot,
                        )
                else:
                    turn.refusals.append("tool " + str(probe.tool) + " failed: " + str(result))
                    candidate = json.dumps({"speech": TEMPLATES["unavailable"]})

            # The deterministic boundary. The model produces JSON naming an
            # action; `interpret` checks it against the registry and the panel
            # list, and refuses anything it cannot verify. Nothing downstream
            # sees the model's raw output.
            command: Command = interpret(candidate, self._snapshot)
            turn.action = command.action
            turn.argument = command.argument
            # Extended, not replaced: a tool failure recorded above is the
            # reason this turn went the way it did, and assigning over it would
            # leave the log saying only that the model declined to act.
            turn.refusals.extend(command.refusals)

            # The phrasing layer sits between the model and the speaker, always.
            # A model drifts back toward chattiness over a long session, and the
            # register is most of what makes this read as the ship's computer.
            turn.spoken, verdict = enforce(command.speech)
            turn.ok = verdict.ok
            turn.drift = verdict.reasons

            await self._events.response(turn.spoken)

            # Dispatched BEFORE the audio plays. The panel should move as the
            # assistant starts speaking, not after it has finished - the delay
            # would read as the command having been ignored.
            if command.performs and command.action:
                await self._events.action(command.action, command.argument)

            async with _stage(turn, "tts", self._clock):
                wav = await self._tts.synthesize(speakable(turn.spoken))

            await self._events.state("speaking")
            async with _stage(turn, "play", self._clock):
                await self._audio.play(wav)

        except Exception as exc:  # noqa: BLE001 - the sidecar must not die
            # A failed turn is one bad answer, not the end of the session. The
            # panel runs unattended; an unhandled exception here would mean
            # voice silently stops working until someone notices.
            await self._events.error(str(exc) or exc.__class__.__name__)
            turn.spoken = TEMPLATES["unavailable"]
            turn.ok = False
        finally:
            await self._events.state("idle")

        return turn


    async def announce(self, text: str) -> Turn:
        """Speaks something nobody asked for. Never raises.

        The proactive-alert path (SCOPE.md §6 P4-1). It shares the phrasing
        layer and the synthesis stages with a normal turn and skips everything
        else - no recognition, no router, no model. The text arrives already
        templated by `alerts.speech`, because an eight-to-twelve second model
        pass to say a sentence that was always going to be one of two shapes is
        latency spent on nothing, and a model asked to read a number back is a
        model that will eventually read a different one.

        The phrasing layer still runs. It is the one thing every spoken line
        goes through, and an alert is exactly where the register matters most.
        """
        turn = Turn(tier="alert")
        try:
            turn.spoken, verdict = enforce(text)
            turn.ok = verdict.ok
            turn.drift = verdict.reasons
            await self._events.response(turn.spoken)
            await self._speak(turn)
        except Exception as exc:  # noqa: BLE001 - the sidecar must not die
            await self._events.error(str(exc) or exc.__class__.__name__)
            turn.ok = False
        finally:
            await self._events.state("idle")
        return turn

    async def _speak(self, turn: "Turn") -> None:
        """Synthesises and plays a turn's response. Used by the tier-0 path."""
        async with _stage(turn, "tts", self._clock):
            wav = await self._tts.synthesize(speakable(turn.spoken))
        await self._events.state("speaking")
        async with _stage(turn, "play", self._clock):
            await self._audio.play(wav)


class _stage:
    """Async context manager that records how long a stage took."""

    def __init__(self, turn: Turn, name: str, clock: Callable[[], float]) -> None:
        self._turn = turn
        self._name = name
        self._clock = clock
        self._start = 0.0

    async def __aenter__(self) -> "_stage":
        self._start = self._clock()
        return self

    async def __aexit__(self, *exc: object) -> None:
        # Recorded even when the stage raised: a turn that blew the budget by
        # timing out is exactly the one whose timings you want to read.
        self._turn.timings[self._name] = self._clock() - self._start


AsyncBytes = Callable[[], Awaitable[bytes]]
