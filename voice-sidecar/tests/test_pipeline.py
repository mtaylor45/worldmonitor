"""Pipeline tests.

Fakes stand in for every adapter, because none of the real ones can run in CI:
openWakeWord wants a microphone, faster-whisper wants a model file, Ollama
wants a server. What is testable — and where the bugs actually live — is the
sequencing: which events fire in which order, that the chirp precedes
recognition, that the phrasing layer sits between the model and the speaker,
and that a failure anywhere still returns the assistant to idle.
"""

from __future__ import annotations

import asyncio
import unittest

from wm_voice.phrasing import TEMPLATES
from wm_voice.pipeline import LATENCY_BUDGET_S, Pipeline


class RecordingEvents:
    def __init__(self) -> None:
        self.log: list[tuple[str, object]] = []

    async def state(self, value: str) -> None:
        self.log.append(("state", value))

    async def wake(self, confidence: float | None = None) -> None:
        self.log.append(("wake", confidence))

    async def transcript(self, text: str, final: bool) -> None:
        self.log.append(("transcript", (text, final)))

    async def response(self, text: str) -> None:
        self.log.append(("response", text))

    async def error(self, message: str) -> None:
        self.log.append(("error", message))

    def kinds(self) -> list[str]:
        return [k for k, _ in self.log]

    def values(self, kind: str) -> list[object]:
        return [v for k, v in self.log if k == kind]


class FakeSTT:
    def __init__(self, text: str = "what is the market composite") -> None:
        self.text = text

    async def transcribe(self, audio: bytes) -> str:
        return self.text


class FakeLLM:
    def __init__(self, reply: str = "Market composite is 61.4.") -> None:
        self.reply = reply
        self.asked: list[str] = []

    async def answer(self, question: str) -> str:
        self.asked.append(question)
        return self.reply


class FakeTTS:
    def __init__(self) -> None:
        self.spoken: list[str] = []

    async def synthesize(self, text: str) -> bytes:
        self.spoken.append(text)
        return b"RIFF-fake-wav"


class FakeAudio:
    def __init__(self) -> None:
        self.played: list[bytes] = []

    async def play(self, wav: bytes) -> None:
        self.played.append(wav)


def build(stt=None, llm=None, tts=None, audio=None, events=None, clock=None):
    events = events or RecordingEvents()
    parts = {
        "stt": stt or FakeSTT(),
        "llm": llm or FakeLLM(),
        "tts": tts or FakeTTS(),
        "audio": audio or FakeAudio(),
        "events": events,
    }
    kwargs = {"clock": clock} if clock else {}
    return Pipeline(**parts, **kwargs), parts, events


class HappyPath(unittest.TestCase):
    def test_runs_the_stages_in_order_and_returns_to_idle(self) -> None:
        pipeline, parts, events = build()
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(turn.transcript, "what is the market composite")
        self.assertEqual(turn.spoken, "Market composite is 61.4.")
        self.assertTrue(turn.ok)
        self.assertEqual(
            events.kinds(), ["transcript", "state", "response", "state", "state"]
        )
        # thinking while the model runs, speaking while audio plays, then idle.
        self.assertEqual(events.values("state"), ["thinking", "speaking", "idle"])
        self.assertEqual(parts["audio"].played, [b"RIFF-fake-wav"])

    def test_numerals_reach_tts_as_words(self) -> None:
        # Engines disagree on how they read "61.4"; none of them agree with
        # each other, so the text handed to TTS carries words.
        pipeline, parts, _ = build()
        asyncio.run(pipeline.run(b"audio"))
        self.assertEqual(parts["tts"].spoken, ["Market composite is sixty-one point four."])

    def test_the_dashboard_is_told_the_response_before_it_is_spoken(self) -> None:
        # The response lands while TTS is still synthesising, so the panel
        # shows the answer at about the moment it starts being said - not after
        # the audio has already finished.
        pipeline, _, events = build()
        asyncio.run(pipeline.run(b"audio"))
        order = [f"{k}:{v}" if k == "state" else k for k, v in events.log]
        self.assertLess(order.index("response"), order.index("state:speaking"))


class WakeOrdering(unittest.TestCase):
    def test_the_chirp_event_precedes_any_recognition(self) -> None:
        # The whole point of the wake event: it fires on detection, before STT
        # has produced anything, so the chirp acknowledges within ~100ms. That
        # latency is the only latency the user actually perceives.
        pipeline, _, events = build()
        asyncio.run(pipeline.on_wake(0.91))
        self.assertEqual(events.kinds(), ["wake", "state"])
        self.assertEqual(events.values("wake"), [0.91])
        self.assertEqual(events.values("state"), ["listening"])


class Drift(unittest.TestCase):
    def test_a_chatty_model_is_replaced_by_a_template(self) -> None:
        pipeline, parts, events = build(
            llm=FakeLLM("I'm sorry! I couldn't find that. Would you like to retry?")
        )
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertFalse(turn.ok)
        self.assertEqual(turn.spoken, TEMPLATES["unavailable"])
        self.assertTrue(turn.drift, "drift reasons should be recorded for the log")
        # What actually reached the speaker is in register.
        self.assertEqual(parts["tts"].spoken, ["That information is not available."])
        self.assertEqual(events.values("response"), [TEMPLATES["unavailable"]])


class Silence(unittest.TestCase):
    def test_an_empty_transcript_says_nothing_at_all(self) -> None:
        # A spoken "no input detected" on every false trigger is how an
        # always-on assistant becomes something you switch off.
        pipeline, parts, events = build(stt=FakeSTT(""))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(turn.transcript, "")
        self.assertEqual(parts["tts"].spoken, [])
        self.assertEqual(parts["audio"].played, [])
        self.assertEqual(events.values("state"), ["idle"])
        self.assertNotIn("response", events.kinds())


class Failure(unittest.TestCase):
    def test_a_failing_stage_reports_and_still_returns_to_idle(self) -> None:
        class Exploding:
            async def answer(self, question: str) -> str:
                raise RuntimeError("ollama unreachable")

        pipeline, parts, events = build(llm=Exploding())
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertFalse(turn.ok)
        self.assertEqual(events.values("error"), ["ollama unreachable"])
        # The indicator must not be left on THINKING because a container died.
        self.assertEqual(events.values("state")[-1], "idle")
        self.assertEqual(parts["audio"].played, [])


class LatencyBudget(unittest.TestCase):
    def test_timings_are_recorded_per_stage(self) -> None:
        ticks = iter([0.0, 0.4, 0.4, 1.9, 1.9, 2.3, 2.3, 2.5])
        pipeline, _, _ = build(clock=lambda: next(ticks))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(
            {k: round(v, 2) for k, v in turn.timings.items()},
            {"stt": 0.4, "llm": 1.5, "tts": 0.4, "play": 0.2},
        )
        self.assertAlmostEqual(turn.total_s, 2.5, places=2)
        self.assertTrue(turn.within_budget)

    def test_a_slow_turn_is_reported_as_over_budget(self) -> None:
        ticks = iter([0.0, 1.0, 1.0, 4.5, 4.5, 5.0, 5.0, 5.2])
        pipeline, _, _ = build(clock=lambda: next(ticks))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertGreater(turn.total_s, LATENCY_BUDGET_S)
        self.assertFalse(turn.within_budget)
        # The point of per-stage timing: the regression names its own cause.
        self.assertEqual(max(turn.timings, key=turn.timings.__getitem__), "llm")

    def test_a_failing_stage_still_records_its_time(self) -> None:
        class Slow:
            async def answer(self, question: str) -> str:
                raise RuntimeError("timeout")

        ticks = iter([0.0, 0.5, 0.5, 9.0])
        pipeline, _, _ = build(llm=Slow(), clock=lambda: next(ticks))
        turn = asyncio.run(pipeline.run(b"audio"))
        self.assertAlmostEqual(turn.timings["llm"], 8.5, places=2)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
