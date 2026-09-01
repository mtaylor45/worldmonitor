"""Server tests.

Fake sockets, because the real ones need `websockets` and a port. What is worth
testing here is the fan-out behaviour and the turn guard - both of which have
failure modes that only show up with more than one client or more than one
press, which is exactly when nobody is watching a wall panel.
"""

from __future__ import annotations

import asyncio
import json
import unittest

from wm_voice.server import Broadcast, Sidecar


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


class TurnGuard(unittest.TestCase):
    def build(self) -> tuple[Sidecar, list[str], Broadcast]:
        started: list[str] = []
        events = Broadcast()

        class SlowPipeline:
            async def run(self, audio: bytes) -> object:
                started.append("run")
                await asyncio.sleep(0.05)
                return object()

        sidecar = Sidecar(SlowPipeline(), events)  # type: ignore[arg-type]
        # Capture is the one part that genuinely needs a microphone.
        sidecar._capture = lambda seconds: _immediate(b"audio")  # type: ignore[assignment]
        return sidecar, started, events

    def test_a_second_press_while_a_turn_runs_is_ignored(self) -> None:
        # On a wall panel a double-press is far more likely than a genuine
        # desire to interrupt, and two pipelines sharing one microphone produce
        # two wrong answers.
        async def scenario() -> list[str]:
            sidecar, started, _ = self.build()
            await sidecar.start_turn(capture_seconds=0.0)
            await sidecar.start_turn(capture_seconds=0.0)
            await asyncio.sleep(0.1)
            return started

        self.assertEqual(asyncio.run(scenario()), ["run"])

    def test_a_turn_can_start_once_the_previous_one_finished(self) -> None:
        async def scenario() -> list[str]:
            sidecar, started, _ = self.build()
            await sidecar.start_turn(capture_seconds=0.0)
            await asyncio.sleep(0.1)
            await sidecar.start_turn(capture_seconds=0.0)
            await asyncio.sleep(0.1)
            return started

        self.assertEqual(asyncio.run(scenario()), ["run", "run"])

    def test_cancel_returns_to_idle(self) -> None:
        async def scenario() -> list[str]:
            sidecar, _, events = self.build()
            socket = FakeSocket()
            events.add(socket)
            await sidecar.start_turn(capture_seconds=0.0)
            await sidecar.cancel()
            return [json.loads(f)["state"] for f in socket.sent if "state" in json.loads(f)]

        # Whatever else happened, the indicator must not be left mid-utterance.
        self.assertEqual(asyncio.run(scenario())[-1], "idle")


async def _immediate(value: bytes) -> bytes:
    return value


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
