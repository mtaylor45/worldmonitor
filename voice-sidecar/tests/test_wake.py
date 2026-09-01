"""Wake-word tests.

No model runs here. What is tested is the judgement around it - threshold,
streak, refractory, playback gating, and what happens when the model throws -
because that judgement is what decides whether the panel wakes when it should
and, more importantly for a wake word as common as "Computer", stays quiet when
it should not.
"""

from __future__ import annotations

import unittest

from wm_voice.wake import NullScorer, WakeWatcher, build_scorer

FRAME = b"\x00\x00" * 1280


class Scripted:
    """A scorer that returns a prepared sequence, then zeroes."""

    def __init__(self, scores: list[float]) -> None:
        self._scores = list(scores)

    def score(self, frame: bytes) -> float:
        return self._scores.pop(0) if self._scores else 0.0

    @property
    def available(self) -> bool:
        return True


class Exploding:
    def score(self, frame: bytes) -> float:
        raise RuntimeError("model died mid-stream")

    @property
    def available(self) -> bool:
        return True


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def watcher(scores: list[float], **kwargs: object) -> tuple[WakeWatcher, Clock]:
    clock = Clock()
    return WakeWatcher(Scripted(scores), clock=clock, **kwargs), clock  # type: ignore[arg-type]


class Threshold(unittest.TestCase):
    def test_below_threshold_never_fires(self) -> None:
        watch, _ = watcher([0.69, 0.5, 0.69], threshold=0.7, consecutive=1)
        self.assertEqual([watch.feed(FRAME) for _ in range(3)], [None, None, None])

    def test_a_confident_run_fires_and_reports_confidence(self) -> None:
        watch, _ = watcher([0.8, 0.9], threshold=0.7, consecutive=2)
        self.assertIsNone(watch.feed(FRAME))
        detection = watch.feed(FRAME)
        assert detection is not None
        self.assertEqual(detection.confidence, 0.9)


class Streak(unittest.TestCase):
    def test_a_single_frame_spike_is_rejected(self) -> None:
        # Most false accepts on a single common word look like exactly this:
        # one frame over the line, surrounded by nothing.
        watch, _ = watcher([0.95, 0.1, 0.95], threshold=0.7, consecutive=2)
        self.assertEqual([watch.feed(FRAME) for _ in range(3)], [None, None, None])

    def test_the_streak_must_be_consecutive(self) -> None:
        watch, _ = watcher([0.9, 0.2, 0.9, 0.9], threshold=0.7, consecutive=3)
        self.assertEqual([watch.feed(FRAME) for _ in range(4)], [None, None, None, None])

    def test_reset_clears_a_run_in_progress(self) -> None:
        # Called when a turn starts, so audio the user speaks as a command
        # cannot accumulate toward waking again mid-utterance.
        watch, _ = watcher([0.9, 0.9], threshold=0.7, consecutive=2)
        watch.feed(FRAME)
        watch.reset()
        self.assertIsNone(watch.feed(FRAME))

    def test_a_consecutive_count_below_one_still_requires_a_frame(self) -> None:
        watch, _ = watcher([0.9], threshold=0.7, consecutive=0)
        self.assertIsNotNone(watch.feed(FRAME))


class Refractory(unittest.TestCase):
    def test_one_utterance_fires_once(self) -> None:
        # Without this the tail of "Computer" fires again while the user is
        # still drawing breath, and the panel starts two turns for one word.
        watch, clock = watcher([0.9] * 6, threshold=0.7, consecutive=1, refractory_s=2.0)
        self.assertIsNotNone(watch.feed(FRAME))
        clock.now = 0.5
        self.assertIsNone(watch.feed(FRAME))
        clock.now = 1.9
        self.assertIsNone(watch.feed(FRAME))

    def test_the_next_utterance_is_heard_once_the_period_passes(self) -> None:
        watch, clock = watcher([0.9] * 4, threshold=0.7, consecutive=1, refractory_s=2.0)
        watch.feed(FRAME)
        clock.now = 2.5
        self.assertIsNotNone(watch.feed(FRAME))


class Playback(unittest.TestCase):
    def test_the_wake_word_is_heard_over_playback_by_default(self) -> None:
        # This is the AEC acceptance test in SCOPE.md §5: on hardware with real
        # full-duplex echo cancellation the user can interrupt a long response.
        watch, _ = watcher([0.9], threshold=0.7, consecutive=1)
        self.assertIsNotNone(watch.feed(FRAME, speaking=True))

    def test_gating_can_be_turned_on_for_a_device_without_aec(self) -> None:
        # The workaround for hardware that ducks rather than cancels: the
        # assistant would otherwise hear itself. It costs interruptibility,
        # which is why it is not the default.
        watch, _ = watcher(
            [0.9, 0.9], threshold=0.7, consecutive=1, listen_during_playback=False
        )
        self.assertIsNone(watch.feed(FRAME, speaking=True))
        self.assertIsNotNone(watch.feed(FRAME, speaking=False))

    def test_gating_also_clears_the_streak(self) -> None:
        # Half a streak from before playback must not combine with half from
        # after it into a wake nobody spoke.
        watch, _ = watcher(
            [0.9, 0.9, 0.9], threshold=0.7, consecutive=2, listen_during_playback=False
        )
        self.assertIsNone(watch.feed(FRAME))
        self.assertIsNone(watch.feed(FRAME, speaking=True))
        self.assertIsNone(watch.feed(FRAME))


class Degradation(unittest.TestCase):
    def test_a_scorer_that_throws_fails_closed(self) -> None:
        # No wake is the safe direction, and a model that throws mid-stream
        # must not end the session on a panel nobody is watching.
        watch = WakeWatcher(Exploding(), threshold=0.7, consecutive=1)
        with self.assertLogs("wm_voice.wake", level="WARNING"):
            self.assertIsNone(watch.feed(FRAME))

    def test_no_model_configured_is_a_reported_state_not_a_crash(self) -> None:
        # Push-to-talk still works; the operator is told the wake word does
        # not, rather than left with a system that looks like it is listening.
        with self.assertLogs("wm_voice.wake", level="WARNING"):
            scorer = build_scorer("")
        self.assertFalse(scorer.available)

    def test_a_model_that_will_not_load_degrades_the_same_way(self) -> None:
        # openWakeWord ships no pretrained "computer" model, so a fresh install
        # pointed at a path that does not exist is the expected first run.
        with self.assertLogs("wm_voice.wake", level="WARNING"):
            scorer = build_scorer("/nonexistent/computer.onnx")
        self.assertFalse(scorer.available)

    def test_an_unavailable_scorer_makes_the_watcher_unavailable(self) -> None:
        # The server reads this to decide whether to arm the loop at all.
        self.assertFalse(WakeWatcher(NullScorer()).available)
        self.assertTrue(WakeWatcher(Scripted([])).available)

    def test_the_null_scorer_never_fires(self) -> None:
        watch = WakeWatcher(NullScorer(), threshold=0.0, consecutive=1)
        # Threshold 0.0 is the pathological case: even then, a scorer that
        # reports nothing must not wake the panel on silence.
        self.assertIsNone(watch.feed(FRAME))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
