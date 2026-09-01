"""Tests for the phrasing layer.

Every case here is drawn from the canonical response table in
`docs/VOICE-CHARACTER.md`. The "never say" column is as much a specification as
the "say" column, so both are asserted.
"""

from __future__ import annotations

import unittest

from wm_voice.phrasing import (
    TEMPLATES,
    enforce,
    number_to_words,
    speakable,
    split_sentences,
    validate,
)


class InRegister(unittest.TestCase):
    """The "say" column. These must all pass untouched."""

    def test_canonical_responses_pass(self) -> None:
        for line in (
            "Working.",
            "Market composite is 61.4.",
            "Please specify.",
            "That information is not available.",
            "Unable to comply.",
            "Acknowledged.",
            "Affirmative.",
            "Negative.",
            "Alert. Instability index for Sudan has risen to eighty-seven.",
            "Three escalation signals detected. Sudan, Myanmar, Haiti.",
        ):
            with self.subTest(line=line):
                self.assertTrue(validate(line).ok, validate(line).reasons)

    def test_every_template_is_in_register(self) -> None:
        # A fallback that fails its own validator would be a trap: the layer
        # would reject a drifting model and then speak something equally wrong.
        for name, line in TEMPLATES.items():
            with self.subTest(template=name):
                self.assertTrue(validate(line).ok, validate(line).reasons)


class OutOfRegister(unittest.TestCase):
    """The "never say" column, one rule at a time."""

    def assert_rejected(self, text: str, needle: str) -> None:
        verdict = validate(text)
        self.assertFalse(verdict.ok, "should have been rejected: " + text)
        self.assertTrue(
            any(needle in r for r in verdict.reasons),
            "expected " + repr(needle) + " in " + repr(verdict.reasons),
        )

    def test_rejects_first_person_opening(self) -> None:
        self.assert_rejected("I am unable to find that.", "begins with 'I'")

    def test_rejects_apology(self) -> None:
        self.assert_rejected("Sorry, that region is unknown.", "sorry")

    def test_rejects_pleasantry(self) -> None:
        self.assert_rejected("Of course. The composite is 61.4.", "of course")

    def test_rejects_hedging(self) -> None:
        self.assert_rejected("It seems the composite is 61.4.", "it seems")
        self.assert_rejected("The composite is probably 61.4.", "probably")

    def test_rejects_trailing_offer(self) -> None:
        self.assert_rejected("Composite is 61.4. Would you like more.", "would you like")

    def test_rejects_exclamation(self) -> None:
        self.assert_rejected("Acknowledged!", "exclamation")

    def test_rejects_contractions(self) -> None:
        self.assert_rejected("That information isn't available.", "contraction")
        self.assert_rejected("It's sixty-one point four.", "contraction")

    def test_rejects_a_third_sentence(self) -> None:
        self.assert_rejected(
            "Composite is 61.4. Brent is up. Gold is down.", "3 sentences"
        )

    def test_rejects_questions_except_please_specify(self) -> None:
        self.assert_rejected("Which region did you mean?", "question mark")
        # The one permitted question.
        self.assertTrue(validate("Please specify.").ok)
        self.assertTrue(validate("Ambiguous. Please specify?").ok)

    def test_rejects_empty(self) -> None:
        self.assert_rejected("   ", "empty")

    def test_reports_every_violation_not_just_the_first(self) -> None:
        # A caller logging drift wants the whole picture, not the first trip.
        verdict = validate("I'm sorry! Would you like me to try again?")
        self.assertFalse(verdict.ok)
        self.assertGreaterEqual(len(verdict.reasons), 4)


class SentenceSplitting(unittest.TestCase):
    def test_a_decimal_is_not_a_sentence_boundary(self) -> None:
        # The failure this guards: "Market composite is 61.4." counted as two
        # sentences, so every numeric readout trips the two-sentence rule.
        self.assertEqual(len(split_sentences("Market composite is 61.4.")), 1)
        self.assertEqual(
            len(split_sentences("Composite is 61.4. Brent is up 1.8 percent.")), 2
        )


class Numerals(unittest.TestCase):
    def test_cardinals(self) -> None:
        cases = {
            "0": "zero",
            "7": "seven",
            "13": "thirteen",
            "20": "twenty",
            "87": "eighty-seven",
            "100": "one hundred",
            "342": "three hundred forty-two",
            "1000": "one thousand",
            "1,204": "one thousand two hundred four",
            "2600000": "two million six hundred thousand",
        }
        for raw, spoken in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(number_to_words(raw), spoken)

    def test_decimals_are_read_digit_by_digit_after_the_point(self) -> None:
        self.assertEqual(number_to_words("61.4"), "sixty-one point four")
        self.assertEqual(number_to_words("1.85"), "one point eight five")

    def test_negatives(self) -> None:
        self.assertEqual(number_to_words("-3"), "negative three")


class Speakable(unittest.TestCase):
    def test_numerals_become_words(self) -> None:
        self.assertEqual(
            speakable("Market composite is 61.4."),
            "Market composite is sixty-one point four.",
        )

    def test_percent_is_spoken(self) -> None:
        self.assertEqual(
            speakable("Brent is up 1.8%."),
            "Brent is up one point eight percent.",
        )

    def test_identifiers_keep_their_digits(self) -> None:
        # A callsign or panel key read as a cardinal is unrecognisable.
        self.assertEqual(speakable("Panel cii-2 is focused."), "Panel cii-2 is focused.")
        self.assertEqual(speakable("Contact SR71 acquired."), "Contact SR71 acquired.")


class Enforce(unittest.TestCase):
    def test_accepts_a_valid_candidate_unchanged(self) -> None:
        spoken, verdict = enforce("Acknowledged.")
        self.assertTrue(verdict.ok)
        self.assertEqual(spoken, "Acknowledged.")

    def test_substitutes_a_template_when_the_model_drifts(self) -> None:
        spoken, verdict = enforce("I'm sorry, I couldn't find that!")
        self.assertFalse(verdict.ok)
        self.assertEqual(spoken, TEMPLATES["unavailable"])
        # Whatever comes out is itself in register - that is the guarantee.
        self.assertTrue(validate(spoken).ok)

    def test_the_fallback_is_selectable(self) -> None:
        spoken, _ = enforce("Sorry!", fallback=TEMPLATES["refused"])
        self.assertEqual(spoken, "Unable to comply.")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
