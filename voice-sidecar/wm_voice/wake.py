"""Wake-word detection: "Computer".

Two things about this wake word shape everything below.

**openWakeWord ships no pretrained "computer" model.** Its bundled set is
`alexa`, `hey_jarvis`, `hey_mycroft`, `hey_rhasspy` and a couple of utilities.
"Computer" has to be trained — openWakeWord's own pipeline does this from
synthetic speech, no recording required, and `docs/VOICE-CHARACTER.md` carries
the procedure. Until that model exists on disk the detector reports itself
unavailable and says so loudly at startup, rather than sitting silent and
looking like a working system that never wakes.

**"Computer" is a single common word, which makes it a hard wake word.** Unlike
"hey jarvis" it occurs in ordinary speech — "my computer is slow", anything on
the news about computers — so the false-accept rate is the design problem, not
the miss rate. Three mitigations, all here:

  1. A higher default threshold than openWakeWord's 0.5.
  2. `consecutive` frames above threshold before firing, which rejects the
     single-frame spikes that most false accepts look like.
  3. A refractory period, so one utterance cannot fire twice.

The 24-hour false-wake acceptance test in SCOPE.md §5 exists to tune exactly
these, and it can only be run in the room the panel lives in.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, Protocol

log = logging.getLogger("wm_voice.wake")


@dataclass(frozen=True)
class Detection:
    """A wake word, heard."""

    confidence: float
    at: float


class Scorer(Protocol):
    """Anything that scores a frame for the wake word."""

    def score(self, frame: bytes) -> float: ...

    @property
    def available(self) -> bool: ...


class NullScorer:
    """Stands in when no model is configured.

    Scores nothing, and says so. The sidecar still runs — push-to-talk is
    unaffected — but `available` is False and the server logs a warning at
    startup, so "the wake word does nothing" is never a silent state.
    """

    def score(self, frame: bytes) -> float:
        return 0.0

    @property
    def available(self) -> bool:
        return False


class OpenWakeWord:
    """openWakeWord adapter.

    Loads a custom "Computer" model from `model_path`. The import is deferred
    so this module stays importable on a machine with no models and no audio
    stack — which is what lets everything below be tested in CI.
    """

    def __init__(self, model_path: str, *, inference_framework: str = "onnx") -> None:
        from openwakeword.model import Model  # noqa: PLC0415 - deferred on purpose

        self._model = Model(
            wakeword_models=[model_path], inference_framework=inference_framework
        )
        self._name = model_path

    def score(self, frame: bytes) -> float:
        import numpy  # noqa: PLC0415

        samples = numpy.frombuffer(frame, dtype=numpy.int16)
        predictions = self._model.predict(samples)
        # One model loaded, but predict() returns a dict keyed by model name;
        # taking the max keeps this correct if a second is ever added.
        return float(max(predictions.values())) if predictions else 0.0

    @property
    def available(self) -> bool:
        return True


class WakeWatcher:
    """Turns a stream of frame scores into wake events.

    All the judgement lives here rather than in the model wrapper, so it is
    testable without a model — and it is the part that actually decides whether
    the panel wakes when it should and stays quiet when it should not.
    """

    def __init__(
        self,
        scorer: Scorer,
        *,
        threshold: float = 0.7,
        consecutive: int = 2,
        refractory_s: float = 2.0,
        listen_during_playback: bool = True,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._scorer = scorer
        self._threshold = threshold
        self._consecutive = max(1, consecutive)
        self._refractory_s = refractory_s
        self._listen_during_playback = listen_during_playback
        self._clock = clock

        self._streak = 0
        self._last_fired = float("-inf")

    @property
    def available(self) -> bool:
        return self._scorer.available

    def reset(self) -> None:
        """Clears the streak. Called when a turn starts, so audio the user is
        speaking as a command cannot accumulate toward a second wake."""
        self._streak = 0

    def feed(self, frame: bytes, *, speaking: bool = False) -> Detection | None:
        """Scores one frame. Returns a Detection when the wake word fires."""
        if not self._scorer.available:
            # The server only arms the loop when a scorer is available, but the
            # guard belongs here too: a watcher with no model behind it must
            # never fire, whatever the threshold has been tuned to.
            return None

        if speaking and not self._listen_during_playback:
            # The device has no usable echo cancellation, so the assistant
            # would hear itself. Gating is the workaround; it also means the
            # user cannot interrupt, which is why it is not the default.
            self._streak = 0
            return None

        try:
            confidence = self._scorer.score(frame)
        except Exception as exc:  # noqa: BLE001
            # A model that throws mid-stream must not end the session. Failing
            # closed here means no wake, which is the safe direction.
            log.warning("wake scorer failed: %s", exc)
            self._streak = 0
            return None

        if confidence < self._threshold:
            self._streak = 0
            return None

        self._streak += 1
        if self._streak < self._consecutive:
            # Most false accepts on a single common word are one-frame spikes.
            # Requiring a run is the cheapest filter that removes them.
            return None

        now = self._clock()
        if now - self._last_fired < self._refractory_s:
            # One utterance, one wake. Without this, the tail of "Computer"
            # fires again while the user is still drawing breath.
            return None

        self._last_fired = now
        self._streak = 0
        return Detection(confidence=confidence, at=now)


def build_scorer(model_path: str, framework: str = "onnx") -> Scorer:
    """Loads the wake model, degrading to NullScorer with a clear reason.

    Never raises. A missing model is a configuration state the operator needs
    told about, not a crash that takes push-to-talk down with it.
    """
    if not model_path:
        log.warning(
            "no wake model configured (WM_WAKE_MODEL); wake word disabled, "
            "push-to-talk still works"
        )
        return NullScorer()

    try:
        scorer = OpenWakeWord(model_path, inference_framework=framework)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "wake model %r failed to load (%s); wake word disabled, "
            "push-to-talk still works. See docs/VOICE-CHARACTER.md for how to "
            "train the 'Computer' model.",
            model_path,
            exc,
        )
        return NullScorer()

    log.info("wake word armed: %s", model_path)
    return scorer
