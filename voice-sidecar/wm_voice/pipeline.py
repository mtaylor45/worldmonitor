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

import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol

from .phrasing import TEMPLATES, enforce, speakable

# SCOPE.md §5 P2. Measured from end-of-speech to the first audio sample.
LATENCY_BUDGET_S = 3.0


class SpeechToText(Protocol):
    async def transcribe(self, audio: bytes) -> str: ...


class LanguageModel(Protocol):
    async def answer(self, question: str) -> str: ...


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


@dataclass
class Turn:
    """One utterance, with the timing of every stage that produced it."""

    transcript: str = ""
    spoken: str = ""
    ok: bool = False
    drift: list[str] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)

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
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._audio = audio
        self._events = events
        self._clock = clock

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
            await self._events.state("thinking")

            async with _stage(turn, "llm", self._clock):
                candidate = await self._llm.answer(turn.transcript)

            # The phrasing layer sits between the model and the speaker, always.
            # A model drifts back toward chattiness over a long session, and the
            # register is most of what makes this read as the ship's computer.
            turn.spoken, verdict = enforce(candidate)
            turn.ok = verdict.ok
            turn.drift = verdict.reasons

            await self._events.response(turn.spoken)

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
