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
from .config import CONFIG, Config
from .pipeline import Pipeline

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

    def __init__(self, pipeline: Pipeline, events: Broadcast, config: Config = CONFIG) -> None:
        self._config = config
        self._pipeline = pipeline
        self._events = events
        self._config = config
        self._turn: asyncio.Task[object] | None = None

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

    async def start_turn(self) -> None:
        """Records, then runs one turn.

        Refuses to start a second turn while one is running: on a wall panel a
        double-press is far more likely than a genuine desire to interrupt, and
        two pipelines sharing one microphone produce two wrong answers.
        """
        if self._turn and not self._turn.done():
            return
        self._turn = asyncio.create_task(self._run())

    async def _run(self) -> None:
        await self._events.state("listening")
        audio = await self._capture()
        await self._pipeline.run(audio)

    async def cancel(self) -> None:
        if self._turn and not self._turn.done():
            self._turn.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._turn
        await self._events.state("idle")

    async def _capture(self) -> bytes:
        """Records until the speaker stops, using voice-activity endpointing.

        This replaces a fixed-duration recording, which was the single largest
        latency defect in the pipeline: a six-second window meant *every* turn
        waited six seconds before recognition could even begin, spending twice
        the entire budget on silence after a two-word command.

        Endpointing stops on `SILENCE_TAIL_S` of quiet, so "show the map" takes
        about a second of wall clock rather than six. `MAX_UTTERANCE_S` is a
        backstop for a room that never goes quiet, not a target.

        Deferred import and a hard failure mode: with no microphone this raises
        and the turn reports an error, rather than silently returning empty
        audio that looks like the user said nothing.
        """
        import numpy  # noqa: PLC0415
        import sounddevice  # noqa: PLC0415

        config = self._config
        rate = 16_000
        block = int(rate * 0.03)  # 30 ms, the frame size Silero and WebRTC use
        collected: list[bytes] = []

        def _record() -> bytes:
            silence = 0.0
            speech_seen = False
            elapsed = 0.0
            with sounddevice.InputStream(
                samplerate=rate, channels=1, dtype="int16", blocksize=block
            ) as stream:
                while elapsed < config.max_utterance_s:
                    frame, _ = stream.read(block)
                    collected.append(bytes(numpy.asarray(frame).tobytes()))
                    elapsed += 0.03

                    # RMS gate rather than a neural VAD: it costs nothing, and
                    # the microphone in this deployment is a near-field
                    # conferencing unit, not a far-field array. Swap in Silero
                    # here if the room proves noisier than the gate can handle.
                    level = float(numpy.abs(numpy.asarray(frame, dtype="float32")).mean())
                    if level > config.vad_threshold:
                        speech_seen = True
                        silence = 0.0
                    else:
                        silence += 0.03

                    # Two different silences: before speech we wait longer,
                    # because a user who pressed LISTEN is still drawing breath.
                    limit = config.silence_tail_s if speech_seen else config.lead_in_s
                    if silence >= limit:
                        break
            return b"".join(collected)

        return await asyncio.to_thread(_record)


async def serve(sidecar: Sidecar, config: Config = CONFIG) -> None:
    """Runs the WebSocket server until cancelled."""
    import websockets  # noqa: PLC0415 - deferred so tests import this module

    async with websockets.serve(sidecar.handle, config.host, config.port):
        log.info("voice sidecar listening on %s", config.endpoint)
        await asyncio.Future()
