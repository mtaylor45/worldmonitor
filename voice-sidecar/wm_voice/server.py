"""WebSocket server and the wake/PTT loop.

Fans state out to every connected dashboard, and accepts push-to-talk from the
rail's LISTEN button. One sidecar, potentially several viewers - the wall panel
plus a laptop during development - so every event is broadcast rather than
addressed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from . import protocol
from .audio import BLOCK_SAMPLES, SAMPLE_RATE, AudioSource, rms
from .config import CONFIG, Config
from .pipeline import Pipeline
from .wake import WakeWatcher

log = logging.getLogger("wm_voice")


class Broadcast:
    """Implements the pipeline's `Events`, fanning out to every client."""

    def __init__(self) -> None:
        self._clients: set[object] = set()

    def add(self, socket: object) -> None:
        self._clients.add(socket)

    def discard(self, socket: object) -> None:
        self._clients.discard(socket)

    async def _send(self, frame: str) -> None:
        # Snapshot first: a send failure mutates the set, and iterating it
        # while that happens is how a broadcast loses the clients after the
        # one that dropped.
        for socket in list(self._clients):
            try:
                await socket.send(frame)  # type: ignore[attr-defined]
            except Exception:
                self._clients.discard(socket)

    async def state(self, value: str) -> None:
        await self._send(protocol.state(value))

    async def wake(self, confidence: float | None = None) -> None:
        await self._send(protocol.wake(confidence))

    async def transcript(self, text: str, final: bool) -> None:
        await self._send(protocol.transcript(text, final))

    async def response(self, text: str) -> None:
        await self._send(protocol.response(text))

    async def error(self, message: str) -> None:
        log.warning("turn failed: %s", message)
        await self._send(protocol.error(message))

    async def action(self, name: str, argument: str | None = None) -> None:
        # Logged at info: on a wall panel the action log is the only record of
        # what the assistant was asked to do and what it decided.
        log.info("action %s%s", name, " " + argument if argument else "")
        await self._send(protocol.action(name, argument))


class Sidecar:
    """Owns the pipeline, the microphone loop, and the socket server."""

    def __init__(
        self,
        pipeline: Pipeline,
        events: Broadcast,
        config: Config = CONFIG,
        *,
        audio: AudioSource | None = None,
        wake: WakeWatcher | None = None,
    ) -> None:
        self._config = config
        self._pipeline = pipeline
        self._events = events
        self._turn: asyncio.Task[object] | None = None
        self._audio = audio
        self._wake = wake
        self._wake_task: asyncio.Task[None] | None = None
        #: True while a turn is in flight, which is the window that contains
        #: playback. The wake detector needs to know, because hearing itself is
        #: the failure mode that decides whether the audio device is usable at
        #: all. Deliberately coarser than "audio is leaving the speaker right
        #: now": that would need the pipeline to report each stage back here,
        #: and the extra precision buys nothing - the only consumer is a gate
        #: that is off unless the hardware lacks echo cancellation, and on such
        #: hardware there is no reason to wake mid-turn either.
        self._speaking = False

    async def start(self) -> None:
        """Opens the microphone and arms the wake word, if one is configured."""
        if self._audio is None:
            return
        await self._audio.start()
        if self._wake is not None and self._wake.available:
            self._wake_task = asyncio.create_task(self._listen_for_wake())

    async def stop(self) -> None:
        if self._wake_task is not None:
            self._wake_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._wake_task
            self._wake_task = None
        if self._audio is not None:
            await self._audio.stop()

    async def _listen_for_wake(self) -> None:
        """Scores every frame, forever, and starts a turn when it fires.

        Runs for the life of the sidecar. Deliberately does NOT stop while a
        turn is in flight: the detector keeps scoring so the wake word can be
        heard over the assistant's own playback, which is the AEC acceptance
        test in SCOPE.md §5. `start_turn` refuses re-entry, so a detection
        during a turn costs a score and nothing else.
        """
        assert self._audio is not None and self._wake is not None
        with self._audio.subscribe() as frames:
            while True:
                frame = await frames.get()
                detection = self._wake.feed(frame, speaking=self._speaking)
                if detection is None:
                    continue
                log.info("wake word (%.2f)", detection.confidence)
                # Announced before any recognition has happened, so the chirp
                # sounds immediately. That acknowledgement is the only latency
                # the user actually perceives.
                await self._pipeline.on_wake(detection.confidence)
                await self.start_turn(from_wake=True)

    async def handle(self, socket: object) -> None:
        """One dashboard connection."""
        self._events.add(socket)
        try:
            # A newly connected panel needs to know the current state; without
            # this its indicator reads STANDING BY until the next utterance.
            await socket.send(protocol.state("idle"))  # type: ignore[attr-defined]
            async for raw in socket:  # type: ignore[attr-defined]
                message = protocol.parse_client_message(raw)
                if message is None:
                    continue
                await self._on_message(message)
        except Exception as exc:  # noqa: BLE001
            log.debug("client dropped: %s", exc)
        finally:
            self._events.discard(socket)

    async def _on_message(self, message: dict[str, object]) -> None:
        kind = message.get("type")
        if kind == "ptt" and message.get("pressed"):
            await self.start_turn()
        elif kind == "cancel":
            await self.cancel()
        elif kind == "context":
            snapshot = message.get("snapshot")
            if isinstance(snapshot, dict):
                # Last writer wins. Several dashboards may be connected - the
                # wall panel plus a laptop - but they render the same state, so
                # whichever published most recently is as good as any.
                self._pipeline.update_snapshot(snapshot)

    async def start_turn(self, *, from_wake: bool = False) -> None:
        """Records, then runs one turn.

        Refuses to start a second turn while one is running: on a wall panel a
        double-press is far more likely than a genuine desire to interrupt, and
        two pipelines sharing one microphone produce two wrong answers.
        """
        if self._turn and not self._turn.done():
            return
        if self._wake is not None:
            # Clear the streak so audio the user speaks as a command cannot
            # accumulate toward waking again mid-utterance.
            self._wake.reset()
        self._turn = asyncio.create_task(self._run(from_wake=from_wake))

    async def _run(self, *, from_wake: bool = False) -> None:
        if not from_wake:
            # A wake turn is already in `listening`; on_wake set it before the
            # chirp. Re-sending would blink the indicator for no reason.
            await self._events.state("listening")
        audio = await self._capture(from_wake=from_wake)
        try:
            self._speaking = True
            await self._pipeline.run(audio)
        finally:
            self._speaking = False

    async def cancel(self) -> None:
        if self._turn and not self._turn.done():
            self._turn.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._turn
        await self._events.state("idle")

    async def _capture(self, *, from_wake: bool = False) -> bytes:
        """Records until the speaker stops, from the shared audio source.

        Endpointing rather than a fixed window: a six-second recording spent
        twice the entire latency budget on silence after a two-word command.

        When the turn started from the wake word, the buffer is seeded with
        pre-roll. Detection has latency - the model only fires once it has
        heard the whole word - so by then the speaker is usually already into
        the command, and without pre-roll "Computer, show the map" reaches
        recognition as "ow the map".
        """
        if self._audio is None:
            raise RuntimeError("no audio source configured")

        config = self._config
        seconds_per_frame = BLOCK_SAMPLES / SAMPLE_RATE
        collected: list[bytes] = []

        if from_wake:
            preroll = self._audio.preroll()
            if preroll:
                collected.append(preroll)

        silence = 0.0
        speech_seen = False
        elapsed = 0.0

        with self._audio.subscribe() as frames:
            while elapsed < config.max_utterance_s:
                try:
                    frame = await asyncio.wait_for(frames.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    # The stream stalled. Returning what we have beats hanging
                    # a turn forever on a panel nobody is watching.
                    break

                collected.append(frame)
                elapsed += seconds_per_frame

                # RMS gate rather than a neural VAD: it costs nothing, and the
                # microphone here is a near-field conferencing unit, not a
                # far-field array. Swap in Silero if the room proves noisier.
                if rms(frame) > config.vad_threshold:
                    speech_seen = True
                    silence = 0.0
                else:
                    silence += seconds_per_frame

                # Two different silences: before speech we wait longer, because
                # a user who just pressed LISTEN is still drawing breath. After
                # a wake word they are already talking, so the lead-in is
                # shorter - the word itself was the run-up.
                if speech_seen:
                    limit = config.silence_tail_s
                elif from_wake:
                    limit = config.wake_lead_in_s
                else:
                    limit = config.lead_in_s
                if silence >= limit:
                    break

        return b"".join(collected)


async def serve(sidecar: Sidecar, config: Config = CONFIG) -> None:
    """Runs the WebSocket server until cancelled."""
    import websockets  # noqa: PLC0415 - deferred so tests import this module

    await sidecar.start()
    try:
        async with websockets.serve(sidecar.handle, config.host, config.port):
            log.info("voice sidecar listening on %s", config.endpoint)
            await asyncio.Future()
    finally:
        await sidecar.stop()
