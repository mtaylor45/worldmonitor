"""Router tests.

Tier 0 is where the latency budget is actually won, so the cases that matter
are: does a repeated command avoid the model entirely, and does a question
never get answered by a pattern.
"""

from __future__ import annotations

import unittest

from wm_voice.router import Tier, match_panel, normalise, route

SNAPSHOT = {
    "actions": ["panel.focus", "map.focus", "theme.cycle", "voice.ptt"],
    "panels": [
        {"key": "cii", "title": "Country Instability"},
        {"key": "markets", "title": "Markets"},
        {"key": "energy", "title": "Energy & Resources"},
        {"key": "live-news", "title": "Live News"},
    ],
}


class DirectTier(unittest.TestCase):
    """Tier 0: no model at all."""

    def test_fixed_commands_skip_the_model(self) -> None:
        for text, action in (
            ("change the theme", "theme.cycle"),
            ("next display", "theme.cycle"),
            ("show me the map", "map.focus"),
            ("show the globe", "map.focus"),
        ):
            with self.subTest(text=text):
                decision = route(text, SNAPSHOT)
                self.assertEqual(decision.tier, Tier.DIRECT, decision.reason)
                self.assertEqual(decision.action, action)
                self.assertEqual(decision.speech, "Acknowledged.")

    def test_a_panel_named_directly_skips_the_model(self) -> None:
        for text, key in (
            ("focus the markets panel", "markets"),
            ("show me country instability", "cii"),
            ("open energy", "energy"),
            ("take me to live news", "live-news"),
        ):
            with self.subTest(text=text):
                decision = route(text, SNAPSHOT)
                self.assertEqual(decision.tier, Tier.DIRECT, decision.reason)
                self.assertEqual((decision.action, decision.argument), ("panel.focus", key))

    def test_the_wake_word_is_stripped(self) -> None:
        decision = route("Computer, change the theme.", SNAPSHOT)
        self.assertEqual(decision.tier, Tier.DIRECT)
        self.assertEqual(decision.action, "theme.cycle")

    def test_an_action_the_dashboard_lacks_is_not_offered(self) -> None:
        # Nothing is dispatched that the dashboard did not publish, even when
        # the phrase matches perfectly.
        decision = route("change the theme", {"actions": [], "panels": []})
        self.assertNotEqual(decision.tier, Tier.DIRECT)


class FullTier(unittest.TestCase):
    """Anything needing data or reasoning."""

    def test_questions_always_reach_the_model(self) -> None:
        for text in (
            "what is happening in taiwan",
            "how unstable is sudan",
            "give me the latest brief",
            "anything concerning nearby",
            "summarise the markets",
            "what is the situation in the red sea",
        ):
            with self.subTest(text=text):
                self.assertEqual(route(text, SNAPSHOT).tier, Tier.FULL)

    def test_a_question_mentioning_a_panel_is_not_navigation(self) -> None:
        # "what is on the markets panel" contains a panel name but is a
        # question. Answering it by scrolling would be wrong.
        decision = route("what is on the markets panel", SNAPSHOT)
        self.assertEqual(decision.tier, Tier.FULL)
        self.assertIsNone(decision.action)

    def test_an_unknown_panel_goes_to_the_model_rather_than_guessing(self) -> None:
        # Guessing the nearest panel is exactly the silent wrong answer this
        # project keeps refusing to make.
        decision = route("focus the warp core panel", SNAPSHOT)
        self.assertNotEqual(decision.tier, Tier.DIRECT)

    def test_an_ambiguous_panel_name_goes_to_the_model(self) -> None:
        # Two substring candidates and no exact match is an ambiguity.
        panels = {"energy-complex": "Energy Complex", "energy-grid": "Energy Grid"}
        self.assertIsNone(match_panel("show energy", panels))

        snapshot = {
            "actions": ["panel.focus"],
            "panels": [
                {"key": "energy-complex", "title": "Energy Complex"},
                {"key": "energy-grid", "title": "Energy Grid"},
            ],
        }
        self.assertNotEqual(route("show energy", snapshot).tier, Tier.DIRECT)

    def test_an_exact_key_match_is_precise_not_ambiguous(self) -> None:
        # "energy" against keys {energy, energy-complex} is exact, and should
        # not be thrown to the model for the sake of a substring collision.
        panels = {"energy": "Energy & Resources", "energy-complex": "Energy Complex"}
        self.assertEqual(match_panel("show energy", panels), "energy")


class FastTier(unittest.TestCase):
    def test_the_fast_tier_is_only_used_when_configured(self) -> None:
        # A second resident model costs RAM; it is opt-in.
        text = "acknowledge"
        self.assertEqual(route(text, SNAPSHOT).tier, Tier.FULL)
        self.assertEqual(route(text, SNAPSHOT, fast_model=True).tier, Tier.FAST)


class Normalising(unittest.TestCase):
    def test_strips_wake_word_and_terminal_punctuation(self) -> None:
        self.assertEqual(normalise("Computer, show the map."), "show the map")
        self.assertEqual(normalise("  Hey computer  next theme?  "), "next theme")

    def test_empty_input_routes_nowhere(self) -> None:
        decision = route("   ", SNAPSHOT)
        self.assertEqual(decision.tier, Tier.DIRECT)
        self.assertIsNone(decision.action)
        self.assertIsNone(decision.speech)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
