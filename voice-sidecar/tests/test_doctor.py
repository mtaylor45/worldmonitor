"""Preflight tests.

The probes touch hardware and a network by design, so what is tested here is
everything around them: that a probe which explodes does not hide the probes
behind it, that WARN and FAIL mean different things to the exit code, and that
a reachable API with a moved schema is reported as a failure rather than as a
calm world.
"""

from __future__ import annotations

import unittest

from wm_voice.config import Config
from wm_voice.doctor import (
    FAIL,
    OK,
    WARN,
    Check,
    check_alert_rules,
    check_api,
    check_tts,
    check_wake,
    report,
    run,
)


def risk_scores(*rows: tuple[str, float], degraded: bool = False, stale: bool = False) -> dict:
    return {
        "ciiScores": [
            {"region": r, "combinedScore": s, "dynamicScore": 0.0} for r, s in rows
        ],
        "degraded": degraded,
        "stale": stale,
    }


class Probes(unittest.TestCase):
    def test_rules_that_parse_to_nothing_are_a_failure(self) -> None:
        # Alerts are the reason this panel is more than a screensaver.
        self.assertEqual(check_alert_rules(Config(alert_rules="nonsense")).status, FAIL)
        self.assertEqual(check_alert_rules(Config(alert_rules="*>85")).status, OK)

    def test_a_missing_wake_model_warns_rather_than_fails(self) -> None:
        # Push-to-talk still works. It is a documented state, not a fault, and
        # reporting it as a failure would train the operator to ignore the
        # failures that matter.
        check = check_wake(Config(wake_model=""))
        self.assertEqual(check.status, WARN)
        self.assertIn("push-to-talk", check.detail)

    def test_a_configured_wake_model_that_will_not_load_is_a_failure(self) -> None:
        # Here the operator asked for a wake word and is not getting one.
        with self.assertLogs("wm_voice.wake", level="WARNING"):
            check = check_wake(Config(wake_model="/nonexistent/computer.onnx"))
        self.assertEqual(check.status, FAIL)

    def test_an_unknown_speech_engine_is_caught_before_startup(self) -> None:
        check = check_tts(Config(tts_engine="festival"))
        self.assertEqual(check.status, FAIL)
        self.assertIn("kokoro", check.remedy)


class ApiProbe(unittest.TestCase):
    def test_a_healthy_api_reports_its_reading_count(self) -> None:
        check = check_api(Config(), fetch=lambda url: risk_scores(("Sudan", 87.0)))
        self.assertEqual(check.status, OK)
        self.assertIn("1 CII", check.detail)

    def test_a_moved_schema_is_a_failure_not_a_calm_world(self) -> None:
        # The important one. `readings_from_risk_scores` drops what it cannot
        # parse rather than false-alarming, so an upstream schema change turns
        # alerts off silently. This is the check that catches that.
        check = check_api(Config(), fetch=lambda url: {"scores": [{"country": "Sudan"}]})
        self.assertEqual(check.status, FAIL)
        self.assertIn("schema", check.remedy)

    def test_a_degraded_feed_warns_and_explains_whose_fault_it_is(self) -> None:
        check = check_api(
            Config(), fetch=lambda url: risk_scores(("Sudan", 87.0), degraded=True)
        )
        self.assertEqual(check.status, WARN)
        self.assertIn("upstream", check.remedy)

    def test_an_unreachable_api_names_the_url_it_tried(self) -> None:
        def boom(url: str) -> object:
            raise OSError("connection refused")

        check = check_api(Config(api_url="http://127.0.0.1:3000"), fetch=boom)
        self.assertEqual(check.status, FAIL)
        self.assertIn("get-risk-scores", check.detail)


class Reporting(unittest.TestCase):
    def test_a_probe_that_explodes_does_not_hide_the_ones_behind_it(self) -> None:
        # A preflight that crashes on the first problem reports one problem.
        def boom(config: Config) -> Check:
            raise RuntimeError("probe is broken")

        def fine(config: Config) -> Check:
            return Check("later check", OK, "reached")

        checks = run(Config(), probes=(boom, fine))
        self.assertEqual([c.status for c in checks], [FAIL, OK])
        self.assertIn("reached", checks[1].detail)

    def test_every_non_ok_check_carries_a_remedy(self) -> None:
        # A verdict without a remedy is a bug report. The operator is present
        # exactly once, at install, and absent forever afterwards.
        configs = [
            Config(alert_rules="nonsense"),
            Config(tts_engine="festival"),
            Config(wake_model=""),
        ]
        for config in configs:
            for probe in (check_alert_rules, check_tts, check_wake):
                check = probe(config)
                if check.status != OK:
                    with self.subTest(check=check.name):
                        self.assertTrue(check.remedy, f"{check.name} has no remedy")

    def test_warnings_alone_still_read_as_ready(self) -> None:
        self.assertIn("Ready, with", report([Check("a", WARN, "degraded", "do this")]))
        self.assertIn("Ready.", report([Check("a", OK, "fine")]))
        self.assertIn("failed", report([Check("a", FAIL, "broken", "fix it")]))

    def test_a_remedy_is_printed_for_a_problem_and_not_for_a_pass(self) -> None:
        self.assertIn("-> fix it", Check("a", FAIL, "broken", "fix it").line())
        self.assertNotIn("->", Check("a", OK, "fine", "irrelevant").line())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
