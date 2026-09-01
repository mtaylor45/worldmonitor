"""One microphone, several consumers.

The wake detector must listen continuously; capture must record on demand. Both
want the same device, and two components independently opening an input stream
is the classic way to get an unhelpful "device busy" on the one machine nobody
is sitting in front of.

So the stream is opened once, here, and frames are fanned out. Consumers
subscribe and unsubscribe; the device is untouched by either.

The other thing this file exists for is **pre-roll**. Wake-word detection has
latency — the model only fires once it has heard the whole word, by which point
the speaker is often already into the command. A short ring buffer of recent
audio means "Computer, show the map" does not arrive at recognition as
"ow the map".
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import deque
from typing import Callable, Iterator

#: 16 kHz mono int16. openWakeWord and faster-whisper both expect this rate, and
#: resampling on a 4-core Skylake is latency for nothing.
SAMPLE_RATE = 16_000

#: 80 ms. openWakeWord's frame size is 1280 samples at 16 kHz; matching it means
#: the detector never has to buffer or split what it is handed.
BLOCK_SAMPLES = 1280

#: Bytes per frame: int16 mono.
BLOCK_BYTES = BLOCK_SAMPLES * 2


class AudioSource:
    """Owns the input stream and fans frames out to subscribers.

    `stream_factory` is injectable so the whole pump is testable without a
    microphone — which matters, because nothing else in this file's behaviour
    depends on real audio.
    """

    def __init__(
        self,
        *,
        preroll_s: float = 1.0,
        stream_factory: Callable[[], Iterator[bytes]] | None = None,
    ) -> None:
        self._factory = stream_factory
        self._subscribers: set[asyncio.Queue[bytes]] = set()
        self._task: asyncio.Task[None] | None = None
        self._running = False

        frames = max(1, int(preroll_s * SAMPLE_RATE / BLOCK_SAMPLES))
        #: Recent audio, for pre-roll. Bounded, so it cannot grow while idle.
        self._recent: deque[bytes] = deque(maxlen=frames)

    # ------------------------------------------------------------- lifecycle

    async def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._pump())

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    # ------------------------------------------------------------ consumers

    @contextlib.contextmanager
    def subscribe(self, *, maxsize: int = 256) -> Iterator[asyncio.Queue[bytes]]:
        """Yields a queue of frames for as long as the block runs.

        Bounded on purpose: a consumer that stalls drops frames rather than
        growing a queue until the sidecar is killed for memory. On a panel that
        runs for months, an unbounded queue behind a wedged consumer is a leak
        with a very long fuse.
        """
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=maxsize)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    def preroll(self) -> bytes:
        """The last second or so of audio, oldest first."""
        return b"".join(self._recent)

    # ------------------------------------------------------------------ pump

    async def _pump(self) -> None:
        loop = asyncio.get_running_loop()
        stream = self._factory() if self._factory else _device_frames()

        def _next() -> bytes | None:
            try:
                return next(stream)
            except StopIteration:
                return None

        while self._running:
            # The read is blocking; a thread keeps the event loop free to go on
            # streaming state to the dashboard while audio arrives.
            frame = await loop.run_in_executor(None, _next)
            if frame is None:
                break
            self._recent.append(frame)
            for queue in list(self._subscribers):
                try:
                    queue.put_nowait(frame)
                except asyncio.QueueFull:
                    # Drop for the stalled consumer only. One slow subscriber
                    # must not stall the wake detector.
                    pass


def _device_frames() -> Iterator[bytes]:
    """Frames from the default input device.

    Deferred import and a hard failure: with no microphone this raises rather
    than yielding silence forever, because silence that looks like a working
    system is the worst outcome on an unattended panel.
    """
    import numpy  # noqa: PLC0415
    import sounddevice  # noqa: PLC0415

    with sounddevice.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=BLOCK_SAMPLES
    ) as stream:
        while True:
            frame, _overflowed = stream.read(BLOCK_SAMPLES)
            yield bytes(numpy.asarray(frame).tobytes())


def rms(frame: bytes) -> float:
    """Mean absolute amplitude of an int16 frame.

    Used by the capture endpointer. Pure stdlib so the audio path does not need
    numpy for the one arithmetic operation it performs per frame.
    """
    if not frame:
        return 0.0
    total = 0
    for index in range(0, len(frame) - 1, 2):
        sample = int.from_bytes(frame[index : index + 2], "little", signed=True)
        total += abs(sample)
    return total / (len(frame) / 2)
