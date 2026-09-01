"""Server tests.

Fake sockets, because the real ones need `websockets` and a port. What is worth
testing here is the fan-out behaviour and the turn guard - both of which have
failure modes that only show up with more than one client or more than one
press, which is exactly when nobody is watching a wall panel.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import unittest

from wm_voice.audio import BLOCK_BYTES, AudioSource
from wm_voice.config import Config
from wm_voice.server import Broadcast, Sidecar
from wm_voice.wake import WakeWatcher

LOUD = (4000).to_bytes(2, "little", signed=True) * 1280
QUIET = b"\x00\x00" * 1280


class FakeSocket:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[str] = []
        self.fail = fail

    async def send(self, frame: str) -> None:
        if self.fail:
            raise ConnectionResetError("client gone")
        self.sent.append(frame)

    def kinds(self) -> list[str]:
        return [json.loads(f)["type"] for f in self.sent]


class Fanout(unittest.TestCase):
    def test_every_client_receives_every_event(self) -> None:
        # The wall panel plus a laptop during development: state is broadcast,
        # never addressed to one viewer.
        events = Broadcast()
        a, b = FakeSocket(), FakeSocket()
        events.add(a)
        events.add(b)

        asyncio.run(events.state("listening"))
        asyncio.run(events.wake(0.9))

        self.assertEqual(a.kinds(), ["state", "wake"])
        self.assertEqual(b.kinds(), ["state", "wake"])

    def test_a_dropped_client_does_not_stop_the_others(self) -> None:
        # The bug this guards: iterating the live set while a send failure
        # mutates it loses every client after the one that dropped.
        events = Broadcast()
        dead, alive = FakeSocket(fail=True), FakeSocket()
        events.add(dead)
        events.add(alive)

        asyncio.run(events.state("idle"))

        self.assertEqual(alive.kinds(), ["state"])
        # And the dead one is forgotten rather than retried forever.
        asyncio.run(events.state("listening"))
        self.assertEqual(alive.kinds(), ["state", "state"])

    def test_discard_removes_a_client(self) -> None:
        events = Broadcast()
        socket = FakeSocket()
        events.add(socket)
        events.discard(socket)
        asyncio.run(events.state("idle"))
        self.assertEqual(socket.sent, [])


class ContextIntake(unittest.TestCase):
    def test_a_context_frame_updates_the_pipeline_snapshot(self) -> None:
        # The LLM reads this snapshot and never the DOM.
        seen: list[dict] = []

        class Recording:
            def update_snapshot(self, snapshot: dict) -> None:
                seen.append(snapshot)

        sidecar = Sidecar(Recording(), Broadcast())  # type: ignore[arg-type]
        snapshot = {"version": 1, "theme": "lcars", "actions": [], "panels": []}
        asyncio.run(sidecar._on_message({"type": "context", "snapshot": snapshot}))
        self.assertEqual(seen, [snapshot])

    def test_a_context_frame_without_a_snapshot_is_ignored(self) -> None:
        class Recording:
            def update_snapshot(self, snapshot: dict) -> None:
                raise AssertionError("should not be called")

        sidecar = Sidecar(Recording(), Broadcast())  # type: ignore[arg-type]
        asyncio.run(sidecar._on_message({"type": "context", "snapshot": "nope"}))


class ActionFanout(unittest.TestCase):
    def test_an_action_reaches_every_dashboard(self) -> None:
        events = Broadcast()
        socket = FakeSocket()
        events.add(socket)
        asyncio.run(events.action("panel.focus", "cii"))
        self.assertEqual(
            json.loads(socket.sent[0]),
            {"type": "action", "action": "panel.focus", "argument": "cii"},
        )

    def test_an_action_without_an_argument_omits_the_field(self) -> None:
        events = Broadcast()
        socket = FakeSocket()
        events.add(socket)
        asyncio.run(events.action("theme.cycle"))
        self.assertEqual(json.loads(socket.sent[0]), {"type": "action", "action": "theme.cycle"})


class TurnGuard(unittest.TestCase):
    def build(self) -> tuple[Sidecar, list[str], Broadcast]:
        started: list[str] = []
        events = Broadcast()

        class SlowPipeline:
            def update_snapshot(self, snapshot: dict) -> None:
                self.snapshot = snapshot

            async def run(self, audio: bytes) -> object:
                started.append("run")
                await asyncio.sleep(0.05)
                return object()

        sidecar = Sidecar(SlowPipeline(), events)  # type: ignore[arg-type]
        # Capture is the one part that genuinely needs a microphone.
        sidecar._capture = lambda **_: _immediate(b"audio")  # type: ignore[assignment]
        return sidecar, started, events

    def test_a_second_press_while_a_turn_runs_is_ignored(self) -> None:
        # On a wall panel a double-press is far more likely than a genuine
        # desire to interrupt, and two pipelines sharing one microphone produce
        # two wrong answers.
        async def scenario() -> list[str]:
            sidecar, started, _ = self.build()
            await sidecar.start_turn()
            await sidecar.start_turn()
            await asyncio.sleep(0.1)
            return started

        self.assertEqual(asyncio.run(scenario()), ["run"])

    def test_a_turn_can_start_once_the_previous_one_finished(self) -> None:
        async def scenario() -> list[str]:
            sidecar, started, _ = self.build()
            await sidecar.start_turn()
            await asyncio.sleep(0.1)
            await sidecar.start_turn()
            await asyncio.sleep(0.1)
            return started

        self.assertEqual(asyncio.run(scenario()), ["run", "run"])

    def test_cancel_returns_to_idle(self) -> None:
        async def scenario() -> list[str]:
            sidecar, _, events = self.build()
            socket = FakeSocket()
            events.add(socket)
            await sidecar.start_turn()
            await sidecar.cancel()
            return [json.loads(f)["state"] for f in socket.sent if "state" in json.loads(f)]

        # Whatever else happened, the indicator must not be left mid-utterance.
        self.assertEqual(asyncio.run(scenario())[-1], "idle")


class FakeAudio:
    """A pre-filled audio source.

    Only the two methods the sidecar actually uses. Deterministic where a real
    `AudioSource` is not: capture and the wake loop would otherwise race the
    pump for the same frames, and what is under test here is the sidecar's
    decisions, not the fan-out (`test_audio.py` covers that).
    """

    def __init__(self, frames: list[bytes], preroll: bytes = b"") -> None:
        self._frames = frames
        self._preroll = preroll

    @contextlib.contextmanager
    def subscribe(self, *, maxsize: int = 256):
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        for frame in self._frames:
            queue.put_nowait(frame)
        yield queue

    def preroll(self) -> bytes:
        return self._preroll


class Capture(unittest.TestCase):
    """Endpointing. This replaced a fixed six-second window, which spent twice
    the entire latency budget on silence after a two-word command."""

    def sidecar(self, audio: FakeAudio, **overrides: float) -> Sidecar:
        settings: dict[str, float] = {
            "vad_threshold": 350.0,
            "silence_tail_s": 0.16,
            "lead_in_s": 0.32,
            "wake_lead_in_s": 0.16,
            "max_utterance_s": 12.0,
        }
        settings.update(overrides)
        config = Config(**settings)  # type: ignore[arg-type]

        class Idle:
            def update_snapshot(self, snapshot: dict) -> None: ...

        return Sidecar(Idle(), Broadcast(), config, audio=audio)  # type: ignore[arg-type]

    def test_recording_stops_when_the_speaker_does(self) -> None:
        # Two frames of speech, then quiet: 0.16 s of tail ends it, and the
        # frames after that are never recorded.
        audio = FakeAudio([LOUD, LOUD] + [QUIET] * 6)
        got = asyncio.run(self.sidecar(audio)._capture())
        self.assertEqual(got, LOUD + LOUD + QUIET + QUIET)

    def test_the_lead_in_is_longer_before_speech_than_after_it(self) -> None:
        # A user who just pressed LISTEN is still drawing breath, so silence
        # before speech gets a longer grace than silence after it.
        audio = FakeAudio([QUIET] * 3 + [LOUD] * 2 + [QUIET] * 6)
        got = asyncio.run(self.sidecar(audio)._capture())
        self.assertEqual(len(got) // BLOCK_BYTES, 7)

    def test_a_wake_turn_gets_the_shorter_lead_in(self) -> None:
        # After the wake word the user is already talking: the word itself was
        # the run-up, so waiting 2.5 s for speech would be latency for nothing.
        audio = FakeAudio([QUIET] * 4)
        got = asyncio.run(self.sidecar(audio)._capture(from_wake=True))
        self.assertEqual(len(got) // BLOCK_BYTES, 2)

    def test_a_wake_turn_is_seeded_with_pre_roll(self) -> None:
        # Detection has latency. Without pre-roll "Computer, show the map"
        # reaches recognition as "ow the map".
        audio = FakeAudio([LOUD, LOUD] + [QUIET] * 4, preroll=LOUD)
        got = asyncio.run(self.sidecar(audio)._capture(from_wake=True))
        self.assertTrue(got.startswith(LOUD + LOUD + LOUD))

    def test_push_to_talk_is_not_seeded_with_pre_roll(self) -> None:
        # The user pressed a button; the second before it is not the command.
        audio = FakeAudio([LOUD, LOUD] + [QUIET] * 4, preroll=LOUD * 4)
        got = asyncio.run(self.sidecar(audio)._capture())
        self.assertEqual(got, LOUD + LOUD + QUIET + QUIET)

    def test_a_room_that_never_goes_quiet_still_ends_the_turn(self) -> None:
        audio = FakeAudio([LOUD] * 40)
        got = asyncio.run(self.sidecar(audio, max_utterance_s=0.4)._capture())
        self.assertEqual(len(got) // BLOCK_BYTES, 5)

    def test_a_stalled_stream_does_not_hang_the_turn(self) -> None:
        # Returning what we have beats hanging a turn forever on a panel
        # nobody is watching.
        got = asyncio.run(self.sidecar(FakeAudio([]))._capture())
        self.assertEqual(got, b"")

    def test_capture_without_an_audio_source_is_an_error_not_a_hang(self) -> None:
        class Idle:
            def update_snapshot(self, snapshot: dict) -> None: ...

        sidecar = Sidecar(Idle(), Broadcast())  # type: ignore[arg-type]
        with self.assertRaises(RuntimeError):
            asyncio.run(sidecar._capture())


class Scripted:
    def __init__(self, scores: list[float]) -> None:
        self._scores = list(scores)

    def score(self, frame: bytes) -> float:
        return self._scores.pop(0) if self._scores else 0.0

    @property
    def available(self) -> bool:
        return True


class WakeLoop(unittest.TestCase):
    def build(self, scores: list[float]) -> tuple[Sidecar, list[str]]:
        log: list[str] = []

        class Recording:
            def update_snapshot(self, snapshot: dict) -> None: ...

            async def on_wake(self, confidence: float | None = None) -> None:
                log.append("wake %.2f" % (confidence or 0.0))

            async def run(self, audio: bytes) -> object:
                log.append("run")
                await asyncio.sleep(0.05)
                return object()

        source = AudioSource(stream_factory=lambda: iter([QUIET] * len(scores)))
        watcher = WakeWatcher(Scripted(scores), threshold=0.7, consecutive=1)
        sidecar = Sidecar(Recording(), Broadcast(), audio=source, wake=watcher)  # type: ignore[arg-type]
        sidecar._capture = lambda **_: _immediate(b"audio")  # type: ignore[assignment]
        return sidecar, log

    def test_a_detection_chirps_before_it_records(self) -> None:
        # The chirp is the only latency the user actually perceives; everything
        # after it can take a second.
        async def scenario() -> list[str]:
            sidecar, log = self.build([0.9])
            await sidecar.start()
            await asyncio.sleep(0.2)
            await sidecar.stop()
            return log

        self.assertEqual(asyncio.run(scenario()), ["wake 0.90", "run"])

    def test_quiet_audio_never_starts_a_turn(self) -> None:
        async def scenario() -> list[str]:
            sidecar, log = self.build([0.1, 0.2, 0.0])
            await sidecar.start()
            await asyncio.sleep(0.2)
            await sidecar.stop()
            return log

        self.assertEqual(asyncio.run(scenario()), [])

    def test_a_detection_during_a_turn_does_not_start_a_second(self) -> None:
        # The loop deliberately keeps scoring during a turn - that is what the
        # AEC acceptance test measures - so the turn guard is what stops two
        # pipelines from sharing one microphone.
        async def scenario() -> list[str]:
            sidecar, log = self.build([0.9, 0.9, 0.9])
            await sidecar.start()
            await asyncio.sleep(0.2)
            await sidecar.stop()
            return log

        # Two wakes may be announced; only one turn may run.
        self.assertEqual([entry for entry in asyncio.run(scenario()) if entry == "run"], ["run"])

    def test_an_unavailable_wake_word_leaves_push_to_talk_working(self) -> None:
        # The expected first run: no "computer" model trained yet. The sidecar
        # starts, says so, and the LISTEN button still works.
        async def scenario() -> list[str]:
            sidecar, log = self.build([])
            sidecar._wake = WakeWatcher(_Unavailable())
            await sidecar.start()
            await asyncio.sleep(0.05)
            await sidecar.start_turn()
            await asyncio.sleep(0.1)
            await sidecar.stop()
            return log

        self.assertEqual(asyncio.run(scenario()), ["run"])

    def test_starting_with_no_audio_source_at_all_is_harmless(self) -> None:
        class Idle:
            def update_snapshot(self, snapshot: dict) -> None: ...

        async def scenario() -> None:
            sidecar = Sidecar(Idle(), Broadcast())  # type: ignore[arg-type]
            await sidecar.start()
            await sidecar.stop()

        asyncio.run(scenario())


class _Unavailable:
    def score(self, frame: bytes) -> float:
        return 0.0

    @property
    def available(self) -> bool:
        return False


async def _immediate(value: bytes) -> bytes:
    return value


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
