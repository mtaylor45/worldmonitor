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
import json
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

    async def action(self, name: str, argument: str | None = None) -> None:
        self.log.append(("action", (name, argument)))

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
    """Returns a raw model response - JSON, per the P3 contract."""

    def __init__(self, reply: str | None = None) -> None:
        self.reply = reply if reply is not None else json_reply(speech="Market composite is 61.4.")
        self.asked: list[tuple[str, dict]] = []

    async def answer(self, question: str, snapshot: dict) -> str:
        self.asked.append((question, snapshot))
        return self.reply


def json_reply(action=None, argument=None, speech="Acknowledged.") -> str:
    import json as _json

    return _json.dumps({"action": action, "argument": argument, "speech": speech})


SNAPSHOT = {
    "version": 1,
    "theme": "lcars",
    "actions": ["panel.focus", "map.focus", "theme.cycle"],
    "panels": [{"key": "cii", "title": "Country Instability"}],
}


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


def build(stt=None, llm=None, tts=None, audio=None, events=None, clock=None, snapshot=None):
    events = events or RecordingEvents()
    parts = {
        "stt": stt or FakeSTT(),
        "llm": llm or FakeLLM(),
        "tts": tts or FakeTTS(),
        "audio": audio or FakeAudio(),
        "events": events,
    }
    kwargs = {"clock": clock} if clock else {}
    pipeline = Pipeline(**parts, **kwargs)
    pipeline.update_snapshot(SNAPSHOT if snapshot is None else snapshot)
    return pipeline, parts, events


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
        # A pure answer dispatches nothing.
        self.assertNotIn("action", events.kinds())
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
            llm=FakeLLM(json_reply(speech="I'm sorry! I couldn't find that. Would you like to retry?"))
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
            async def answer(self, question: str, snapshot: dict) -> str:
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
            async def answer(self, question: str, snapshot: dict) -> str:
                raise RuntimeError("timeout")

        ticks = iter([0.0, 0.5, 0.5, 9.0])
        pipeline, _, _ = build(llm=Slow(), clock=lambda: next(ticks))
        turn = asyncio.run(pipeline.run(b"audio"))
        self.assertAlmostEqual(turn.timings["llm"], 8.5, places=2)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


class Commands(unittest.TestCase):
    """P3: speech to a validated action."""

    def test_a_valid_command_is_dispatched(self) -> None:
        pipeline, _, events = build(llm=FakeLLM(json_reply("panel.focus", "cii")))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual((turn.action, turn.argument), ("panel.focus", "cii"))
        self.assertEqual(events.values("action"), [("panel.focus", "cii")])

    def test_the_action_is_dispatched_before_the_audio_plays(self) -> None:
        # The panel should move as the assistant starts speaking, not after it
        # has finished - the delay reads as the command having been ignored.
        pipeline, _, events = build(llm=FakeLLM(json_reply("panel.focus", "cii")))
        asyncio.run(pipeline.run(b"audio"))
        order = [f"{k}:{v}" if k == "state" else k for k, v in events.log]
        self.assertLess(order.index("action"), order.index("state:speaking"))

    def test_an_invented_action_is_refused_and_never_dispatched(self) -> None:
        # The failure this whole boundary exists for.
        pipeline, _, events = build(llm=FakeLLM(json_reply("system.reboot")))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertIsNone(turn.action)
        self.assertEqual(events.values("action"), [])
        self.assertTrue(turn.refusals)
        self.assertEqual(turn.spoken, "Unable to comply.")

    def test_a_panel_not_on_the_dashboard_is_refused(self) -> None:
        pipeline, _, events = build(llm=FakeLLM(json_reply("panel.focus", "warp-core")))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertIsNone(turn.action)
        self.assertEqual(events.values("action"), [])
        self.assertEqual(turn.spoken, "That information is not available.")

    def test_free_text_from_the_model_dispatches_nothing(self) -> None:
        pipeline, _, events = build(llm=FakeLLM("Sure, focusing that panel!"))
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertIsNone(turn.action)
        self.assertEqual(events.values("action"), [])

    def test_the_snapshot_reaches_the_model(self) -> None:
        # The LLM reads the structured snapshot, never the DOM.
        pipeline, parts, _ = build()
        asyncio.run(pipeline.run(b"audio"))
        _, snapshot = parts["llm"].asked[0]
        self.assertEqual(snapshot["theme"], "lcars")
        self.assertIn("panel.focus", snapshot["actions"])

    def test_no_snapshot_means_no_action_is_permitted(self) -> None:
        # Before the dashboard has sent one, acting is worse than refusing.
        pipeline, _, events = build(
            llm=FakeLLM(json_reply("theme.cycle")), snapshot={"actions": [], "panels": []}
        )
        turn = asyncio.run(pipeline.run(b"audio"))
        self.assertIsNone(turn.action)
        self.assertEqual(events.values("action"), [])


class Tiers(unittest.TestCase):
    """The latency win: a repeated command must not reach the model."""

    def test_a_direct_command_never_calls_the_model(self) -> None:
        llm = FakeLLM()
        pipeline, parts, events = build(
            stt=FakeSTT("focus the country instability panel"), llm=llm
        )
        turn = asyncio.run(pipeline.run(b"audio"))

        # The whole point: on this CPU the model IS the latency budget.
        self.assertEqual(llm.asked, [])
        self.assertEqual(turn.tier, "direct")
        self.assertEqual((turn.action, turn.argument), ("panel.focus", "cii"))
        self.assertEqual(events.values("action"), [("panel.focus", "cii")])
        # And it still speaks and returns to idle like any other turn.
        self.assertEqual(parts["audio"].played, [b"RIFF-fake-wav"])
        self.assertEqual(events.values("state")[-1], "idle")

    def test_a_question_still_reaches_the_model(self) -> None:
        llm = FakeLLM()
        pipeline, _, _ = build(stt=FakeSTT("what is happening in taiwan"), llm=llm)
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(len(llm.asked), 1)
        self.assertEqual(turn.tier, "full")

    def test_the_direct_tier_records_no_model_time(self) -> None:
        # A turn that skipped the model should show it in the timings, so the
        # latency harness attributes the saving rather than hiding it.
        pipeline, _, _ = build(stt=FakeSTT("change the theme"))
        turn = asyncio.run(pipeline.run(b"audio"))
        self.assertNotIn("llm", turn.timings)
        self.assertIn("tts", turn.timings)


class DataToolLoop(unittest.TestCase):
    def test_a_data_tool_runs_and_the_model_is_asked_again(self) -> None:
        from wm_voice.tools import ToolRegistry

        class StubApi:
            async def get(self, path, params=None):
                return {"country": "Sudan", "risk": 87}

        registry = ToolRegistry(StubApi())  # type: ignore[arg-type]
        registry.update(SNAPSHOT)

        replies = iter([
            json.dumps({"tool": "get_country_risk", "arguments": {"country": "Sudan"}}),
            json_reply(speech="Sudan risk is eighty-seven."),
        ])

        class TwoStep:
            def __init__(self) -> None:
                self.asked: list[str] = []

            async def answer(self, question: str, snapshot: dict) -> str:
                self.asked.append(question)
                return next(replies)

        llm = TwoStep()
        events = RecordingEvents()
        pipeline = Pipeline(
            stt=FakeSTT("how risky is sudan"),
            llm=llm,  # type: ignore[arg-type]
            tts=FakeTTS(),
            audio=FakeAudio(),
            events=events,
            tools=registry,
        )
        pipeline.update_snapshot(SNAPSHOT)
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(turn.tool, "get_country_risk")
        self.assertEqual(turn.spoken, "Sudan risk is eighty-seven.")
        # The tool result reached the second call.
        self.assertIn("Tool result", llm.asked[1])
        # And the loop runs once: a second round would double the model cost,
        # which on this hardware is the difference between a pause and a hang.
        self.assertEqual(len(llm.asked), 2)
        self.assertIn("tool", turn.timings)

    def test_a_failing_tool_speaks_the_unavailable_template(self) -> None:
        from wm_voice.tools import ToolRegistry

        class DeadApi:
            async def get(self, path, params=None):
                raise ConnectionError("api down")

        registry = ToolRegistry(DeadApi())  # type: ignore[arg-type]
        registry.update(SNAPSHOT)

        pipeline, _, _ = build(
            stt=FakeSTT("how risky is sudan"),
            llm=FakeLLM(json.dumps({"tool": "get_country_risk", "arguments": {"country": "Sudan"}})),
        )
        pipeline._tools = registry  # type: ignore[attr-defined]
        turn = asyncio.run(pipeline.run(b"audio"))

        self.assertEqual(turn.spoken, TEMPLATES["unavailable"])
        self.assertTrue(any("failed" in r for r in turn.refusals))
