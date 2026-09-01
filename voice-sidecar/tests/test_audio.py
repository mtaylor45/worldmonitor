"""Audio fan-out tests.

The device is never opened here - `stream_factory` replaces it - because what
is worth testing is not whether sounddevice works but whether two consumers can
share one stream without either starving the other. That is the property the
wake word depends on: the detector must keep scoring while capture records.
"""

from __future__ import annotations

import asyncio
import unittest

from wm_voice.audio import BLOCK_BYTES, AudioSource, rms


def frames(count: int) -> list[bytes]:
    """Distinguishable frames, so order and identity are both checkable."""
    return [bytes([index % 256]) * BLOCK_BYTES for index in range(count)]


async def drain(source: AudioSource, ticks: int = 40) -> None:
    """Lets the pump run. Each frame costs an executor round trip, so yielding
    once is not enough; this yields until the pump has clearly finished."""
    for _ in range(ticks):
        await asyncio.sleep(0)
    await asyncio.sleep(0.05)


class Fanout(unittest.TestCase):
    def test_every_subscriber_receives_every_frame(self) -> None:
        # One microphone, two consumers. The wake detector and capture both
        # want the device, and two components opening it independently is the
        # classic way to get "device busy" on an unattended panel.
        async def scenario() -> tuple[list[bytes], list[bytes]]:
            sent = frames(4)
            source = AudioSource(stream_factory=lambda: iter(sent))
            with source.subscribe() as a, source.subscribe() as b:
                await source.start()
                await drain(source)
                await source.stop()
                return _drain_queue(a), _drain_queue(b)

        got_a, got_b = asyncio.run(scenario())
        self.assertEqual(got_a, frames(4))
        self.assertEqual(got_b, frames(4))

    def test_a_stalled_consumer_drops_frames_rather_than_growing(self) -> None:
        # A wall panel runs for months. An unbounded queue behind a wedged
        # consumer is a leak with a very long fuse, so the bound is the point.
        async def scenario() -> tuple[int, int]:
            source = AudioSource(stream_factory=lambda: iter(frames(6)))
            with source.subscribe(maxsize=2) as slow, source.subscribe() as fast:
                await source.start()
                await drain(source)
                await source.stop()
                return slow.qsize(), fast.qsize()

        stalled, healthy = asyncio.run(scenario())
        self.assertEqual(stalled, 2)
        # And the drop is confined to the stalled subscriber: one slow consumer
        # must not stall the wake detector.
        self.assertEqual(healthy, 6)

    def test_unsubscribing_stops_delivery(self) -> None:
        async def scenario() -> int:
            source = AudioSource(stream_factory=lambda: iter(frames(4)))
            with source.subscribe() as queue:
                pass
            await source.start()
            await drain(source)
            await source.stop()
            return queue.qsize()

        self.assertEqual(asyncio.run(scenario()), 0)


class Preroll(unittest.TestCase):
    def test_recent_audio_is_kept_oldest_first(self) -> None:
        # Detection has latency: by the time the model fires, the speaker is
        # usually into the command. Without pre-roll "Computer, show the map"
        # reaches recognition as "ow the map".
        async def scenario() -> bytes:
            # 0.16 s at 80 ms a frame: two frames.
            source = AudioSource(preroll_s=0.16, stream_factory=lambda: iter(frames(5)))
            await source.start()
            await drain(source)
            await source.stop()
            return source.preroll()

        self.assertEqual(asyncio.run(scenario()), frames(5)[3] + frames(5)[4])

    def test_preroll_is_empty_before_any_audio(self) -> None:
        self.assertEqual(AudioSource().preroll(), b"")

    def test_the_buffer_never_rounds_down_to_nothing(self) -> None:
        # A pre-roll of zero would silently disable the feature; one frame is
        # the floor.
        async def scenario() -> int:
            source = AudioSource(preroll_s=0.0, stream_factory=lambda: iter(frames(3)))
            await source.start()
            await drain(source)
            await source.stop()
            return len(source.preroll())

        self.assertEqual(asyncio.run(scenario()), BLOCK_BYTES)


class Lifecycle(unittest.TestCase):
    def test_starting_twice_opens_one_stream(self) -> None:
        # `start()` is called from the server's own lifecycle; opening the
        # device twice is exactly the failure this module exists to prevent.
        opened: list[int] = []

        def factory():
            opened.append(1)
            return iter(frames(2))

        async def scenario() -> None:
            source = AudioSource(stream_factory=factory)
            await source.start()
            await source.start()
            await drain(source)
            await source.stop()

        asyncio.run(scenario())
        self.assertEqual(len(opened), 1)

    def test_stopping_without_starting_is_harmless(self) -> None:
        asyncio.run(AudioSource().stop())


class Rms(unittest.TestCase):
    def test_silence_and_signal(self) -> None:
        self.assertEqual(rms(b""), 0.0)
        self.assertEqual(rms(b"\x00\x00" * 10), 0.0)
        # 1000 as little-endian int16, ten times over.
        self.assertAlmostEqual(rms((1000).to_bytes(2, "little", signed=True) * 10), 1000.0)

    def test_negative_samples_count_toward_amplitude(self) -> None:
        # Mean *absolute* amplitude: a loud negative half-cycle is loud.
        self.assertAlmostEqual(rms((-1000).to_bytes(2, "little", signed=True) * 10), 1000.0)


def _drain_queue(queue: "asyncio.Queue[bytes]") -> list[bytes]:
    out: list[bytes] = []
    while not queue.empty():
        out.append(queue.get_nowait())
    return out


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
