"""Proactive alert tests.

The failure mode this feature has is not "it did not fire". It is "it fires
often enough that you stop looking", and every case below is about one of the
four guards that prevent that: hysteresis, the spoken-alert interval, quiet
hours, and refusing to alert on a reading the API itself says is stale.
"""

from __future__ import annotations

import unittest
from datetime import datetime, time as clock_time

from wm_voice.alerts import (
    LEVEL,
    RISE,
    Alert,
    AlertWatcher,
    Reading,
    Rule,
    in_window,
    parse_rules,
    parse_window,
    readings_from_risk_scores,
    speech,
)
from wm_voice.phrasing import enforce, speakable


class Clock:
    def __init__(self, now: float = 0.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def watcher(spec: str = "*>85", **kwargs: object) -> AlertWatcher:
    kwargs.setdefault("clock", Clock())
    return AlertWatcher(parse_rules(spec), **kwargs)  # type: ignore[arg-type]


class Rules(unittest.TestCase):
    def test_levels_and_rises_both_parse(self) -> None:
        rules = parse_rules("*>85, Sudan>75, Taiwan+12")
        self.assertEqual(
            rules,
            [
                Rule("*", LEVEL, 85.0),
                Rule("Sudan", LEVEL, 75.0),
                Rule("Taiwan", RISE, 12.0),
            ],
        )

    def test_a_malformed_rule_is_skipped_not_fatal(self) -> None:
        # Turning a typo in an environment variable into a panel that will not
        # start is strictly worse than running the rules that parsed.
        with self.assertLogs("wm_voice.alerts", level="WARNING"):
            rules = parse_rules("*>85, nonsense, Sudan>75")
        self.assertEqual([r.region for r in rules], ["*", "Sudan"])

    def test_an_empty_spec_disables_the_feature(self) -> None:
        self.assertEqual(parse_rules(""), [])
        self.assertFalse(watcher("").enabled)

    def test_whitespace_and_newlines_are_tolerated(self) -> None:
        self.assertEqual(len(parse_rules("  *>85 ,\n Sudan > 75 \n")), 2)

    def test_a_named_region_beats_the_catch_all(self) -> None:
        # "*>85, Sudan>75" has to mean what it reads like.
        watch = watcher("*>85, Sudan>75")
        rule = watch.rule_for(Reading("Sudan", 78.0))
        assert rule is not None
        self.assertEqual((rule.region, rule.value), ("Sudan", 75.0))

    def test_a_region_with_no_rule_at_all_is_ignored(self) -> None:
        watch = watcher("Sudan>75")
        self.assertIsNone(watch.rule_for(Reading("Norway", 99.0)))
        self.assertEqual(watch.evaluate([Reading("Norway", 99.0)]), [])


class Crossing(unittest.TestCase):
    def test_crossing_the_line_raises_once(self) -> None:
        watch = watcher("*>85")
        raised = watch.evaluate([Reading("Sudan", 87.0)])
        self.assertEqual([(a.region, a.score) for a in raised], [("Sudan", 87.0)])
        self.assertTrue(watch.active)

        # Still above, but already raised: one crossing is one alert.
        self.assertEqual(watch.evaluate([Reading("Sudan", 88.0)]), [])

    def test_below_the_line_never_raises(self) -> None:
        watch = watcher("*>85")
        self.assertEqual(watch.evaluate([Reading("Sudan", 84.9)]), [])
        self.assertFalse(watch.active)

    def test_a_rise_fires_below_any_level_threshold(self) -> None:
        # A jump from 40 to 55 is news even though 55 clears no level line.
        # This is the "escalation signal" half of SCOPE.md P4-1.
        watch = watcher("Taiwan+12")
        raised = watch.evaluate([Reading("Taiwan", 55.0, delta=14.0)])
        self.assertEqual([a.kind for a in raised], [RISE])

    def test_a_fall_is_not_an_escalation(self) -> None:
        watch = watcher("Taiwan+12")
        self.assertEqual(watch.evaluate([Reading("Taiwan", 55.0, delta=-14.0)]), [])

    def test_several_regions_can_be_firing_at_once(self) -> None:
        watch = watcher("*>85")
        raised = watch.evaluate([Reading("Sudan", 87.0), Reading("Yemen", 91.0)])
        self.assertEqual(len(raised), 2)
        self.assertEqual(watch.firing_regions, ["Sudan", "Yemen"])


class Hysteresis(unittest.TestCase):
    def test_a_reading_hovering_on_the_line_does_not_flap(self) -> None:
        # The single most important case here. Without the margin, a score
        # oscillating around 85 fires, clears, fires and clears - and an alert
        # that does that is one you learn to ignore.
        watch = watcher("*>85", clear_margin=5.0)
        self.assertEqual(len(watch.evaluate([Reading("Sudan", 85.1)])), 1)
        for score in (84.9, 85.2, 84.8, 85.0):
            self.assertEqual(watch.evaluate([Reading("Sudan", score)]), [])
        self.assertTrue(watch.active)

    def test_it_clears_once_the_score_falls_a_margin_below(self) -> None:
        watch = watcher("*>85", clear_margin=5.0)
        watch.evaluate([Reading("Sudan", 87.0)])
        watch.evaluate([Reading("Sudan", 79.9)])
        self.assertFalse(watch.active)

    def test_and_can_then_fire_again(self) -> None:
        watch = watcher("*>85", clear_margin=5.0)
        watch.evaluate([Reading("Sudan", 87.0)])
        watch.evaluate([Reading("Sudan", 70.0)])
        self.assertEqual(len(watch.evaluate([Reading("Sudan", 90.0)])), 1)

    def test_a_rise_alert_clears_on_the_delta_not_the_score(self) -> None:
        # A region that rose 14 points and has stopped rising is no longer
        # escalating, whatever its absolute score happens to be.
        watch = watcher("Taiwan+12", clear_margin=5.0)
        watch.evaluate([Reading("Taiwan", 55.0, delta=14.0)])
        self.assertTrue(watch.active)
        watch.evaluate([Reading("Taiwan", 56.0, delta=6.0)])
        self.assertFalse(watch.active)


class Trustworthiness(unittest.TestCase):
    def test_a_degraded_reading_never_raises(self) -> None:
        # An alert is a claim about the world. A degraded response is a claim
        # about the cache, and speaking one as the other is a correctness bug
        # in a situational-awareness display.
        watch = watcher("*>85")
        self.assertEqual(watch.evaluate([Reading("Sudan", 99.0)], trustworthy=False), [])
        self.assertFalse(watch.active)

    def test_a_stale_feed_does_not_clear_a_live_alert_either(self) -> None:
        # Clearing on stale data would silently drop a real alert because the
        # upstream cache hiccuped - which is the failure a monitor exists to
        # prevent, not one it should introduce.
        watch = watcher("*>85")
        watch.evaluate([Reading("Sudan", 87.0)])
        watch.evaluate([Reading("Sudan", 10.0)], trustworthy=False)
        self.assertTrue(watch.active)


class Speaking(unittest.TestCase):
    def alert(self, score: float = 87.0) -> Alert:
        return Alert("Sudan", score, 4.0, LEVEL, 85.0)

    def test_the_loudest_of_several_is_the_one_spoken(self) -> None:
        # The display carries every crossing. A queue of spoken alerts is how
        # an always-on assistant becomes something you switch off.
        watch = watcher("*>85")
        raised = watch.evaluate([Reading("Sudan", 87.0), Reading("Yemen", 93.0)])
        chosen = watch.to_announce(raised)
        assert chosen is not None
        self.assertEqual(chosen.region, "Yemen")

    def test_a_second_alert_inside_the_interval_is_not_spoken(self) -> None:
        clock = Clock()
        watch = watcher("*>85", min_interval_s=900.0, clock=clock)
        self.assertIsNotNone(watch.to_announce([self.alert()]))
        clock.now = 899.0
        with self.assertLogs("wm_voice.alerts", level="INFO"):
            self.assertIsNone(watch.to_announce([self.alert()]))

    def test_and_is_spoken_once_the_interval_passes(self) -> None:
        clock = Clock()
        watch = watcher("*>85", min_interval_s=900.0, clock=clock)
        watch.to_announce([self.alert()])
        clock.now = 901.0
        self.assertIsNotNone(watch.to_announce([self.alert()]))

    def test_nothing_raised_means_nothing_spoken(self) -> None:
        self.assertIsNone(watcher("*>85").to_announce([]))

    def test_speech_can_be_disabled_entirely(self) -> None:
        # A display-only alert state is a legitimate configuration for a panel
        # in a bedroom.
        watch = watcher("*>85", speak=False)
        self.assertIsNone(watch.to_announce([self.alert()]))


class QuietHours(unittest.TestCase):
    def at(self, hour: int, minute: int = 0):
        return lambda: datetime(2026, 3, 1, hour, minute)

    def test_a_window_wrapping_midnight_covers_both_sides(self) -> None:
        window = parse_window("22:00-07:00")
        self.assertTrue(in_window(clock_time(23, 30), window))
        self.assertTrue(in_window(clock_time(3, 0), window))
        self.assertFalse(in_window(clock_time(12, 0), window))
        # Half-open: the window starts at 22:00 and ends at 07:00.
        self.assertTrue(in_window(clock_time(22, 0), window))
        self.assertFalse(in_window(clock_time(7, 0), window))

    def test_a_window_inside_one_day_works_too(self) -> None:
        window = parse_window("09:00-17:00")
        self.assertTrue(in_window(clock_time(12, 0), window))
        self.assertFalse(in_window(clock_time(20, 0), window))

    def test_an_empty_or_malformed_window_means_never_quiet(self) -> None:
        self.assertIsNone(parse_window(""))
        with self.assertLogs("wm_voice.alerts", level="WARNING"):
            self.assertIsNone(parse_window("bedtime"))
        with self.assertLogs("wm_voice.alerts", level="WARNING"):
            self.assertIsNone(parse_window("25:00-07:00"))
        self.assertFalse(in_window(clock_time(3, 0), None))

    def test_quiet_hours_silence_the_voice(self) -> None:
        watch = watcher(
            "*>85", quiet_hours=parse_window("22:00-07:00"), wall_clock=self.at(3)
        )
        with self.assertLogs("wm_voice.alerts", level="INFO"):
            self.assertIsNone(watch.to_announce([Alert("Sudan", 87.0, 4.0, LEVEL, 85.0)]))

    def test_but_never_the_display(self) -> None:
        # The point of a quiet window is not waking the house, not hiding the
        # situation. An alert raised at 3am is still on the panel at 3am.
        watch = watcher(
            "*>85", quiet_hours=parse_window("22:00-07:00"), wall_clock=self.at(3)
        )
        raised = watch.evaluate([Reading("Sudan", 87.0)])
        self.assertEqual(len(raised), 1)
        self.assertTrue(watch.active)

    def test_outside_the_window_it_speaks(self) -> None:
        watch = watcher(
            "*>85", quiet_hours=parse_window("22:00-07:00"), wall_clock=self.at(12)
        )
        self.assertIsNotNone(watch.to_announce([Alert("Sudan", 87.0, 4.0, LEVEL, 85.0)]))


class Wording(unittest.TestCase):
    def test_it_says_what_the_scope_says_it_says(self) -> None:
        # SCOPE.md §6 P4-1, verbatim.
        spoken = speakable(speech(Alert("Sudan", 87.0, 4.0, LEVEL, 85.0)))
        self.assertEqual(spoken, "Alert. Instability index for Sudan has risen to eighty-seven.")

    def test_a_rise_names_the_movement(self) -> None:
        text = speech(Alert("Taiwan", 55.0, 14.0, RISE, 12.0))
        self.assertIn("risen 14 points to 55", text)

    def test_every_alert_passes_the_phrasing_validator(self) -> None:
        # The register is most of what makes this read as the ship's computer,
        # and an alert is where it matters most.
        for alert in (
            Alert("Sudan", 87.0, 4.0, LEVEL, 85.0),
            Alert("Taiwan", 55.5, 14.2, RISE, 12.0),
            Alert("Democratic Republic of the Congo", 91.0, 0.0, LEVEL, 85.0),
        ):
            with self.subTest(region=alert.region):
                _, verdict = enforce(speech(alert))
                self.assertTrue(verdict.ok, verdict.reasons)

    def test_a_whole_number_is_not_spoken_with_a_decimal(self) -> None:
        # "eighty-seven point zero" is not how the computer says eighty-seven.
        self.assertIn("to 87.", speech(Alert("Sudan", 87.0, 0.0, LEVEL, 85.0)))
        self.assertIn("to 87.4.", speech(Alert("Sudan", 87.4, 0.0, LEVEL, 85.0)))


class ApiShape(unittest.TestCase):
    """The one place that knows the shape of an upstream API response."""

    def payload(self, **overrides: object) -> dict:
        base = {
            "ciiScores": [
                {"region": "Sudan", "combinedScore": 87.2, "dynamicScore": 4.1},
                {"region": "Yemen", "combinedScore": 91.0, "dynamicScore": -2.0},
            ],
            "degraded": False,
            "stale": False,
        }
        base.update(overrides)
        return base

    def test_it_reads_the_generated_client_field_names(self) -> None:
        readings, trustworthy = readings_from_risk_scores(self.payload())
        self.assertTrue(trustworthy)
        self.assertEqual(
            [(r.region, r.score, r.delta) for r in readings],
            [("Sudan", 87.2, 4.1), ("Yemen", 91.0, -2.0)],
        )

    def test_degraded_and_stale_are_both_disqualifying(self) -> None:
        self.assertFalse(readings_from_risk_scores(self.payload(degraded=True))[1])
        self.assertFalse(readings_from_risk_scores(self.payload(stale=True))[1])

    def test_a_missing_delta_is_zero_not_a_crash(self) -> None:
        payload = {"ciiScores": [{"region": "Sudan", "combinedScore": 87.0}]}
        readings, _ = readings_from_risk_scores(payload)
        self.assertEqual(readings[0].delta, 0.0)

    def test_junk_entries_are_dropped_rather_than_alerted_on(self) -> None:
        # An upstream schema change must not become a false alarm.
        payload = {
            "ciiScores": [
                {"region": "Sudan", "combinedScore": "very high"},
                {"combinedScore": 90.0},
                {"region": "", "combinedScore": 90.0},
                {"region": "Yemen", "combinedScore": True},
                "not a dict",
                {"region": "Chad", "combinedScore": 88.0},
            ]
        }
        readings, _ = readings_from_risk_scores(payload)
        self.assertEqual([r.region for r in readings], ["Chad"])

    def test_a_response_that_is_not_a_dict_is_survivable(self) -> None:
        self.assertEqual(readings_from_risk_scores(None), ([], False))
        self.assertEqual(readings_from_risk_scores("<html>502</html>"), ([], False))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
