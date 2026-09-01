"""Command interpretation tests.

This is the deterministic boundary P3 exists to create, so the cases that
matter are the adversarial ones: a model naming an action that does not exist,
a panel that is not on screen, or returning something that is not JSON at all.
Every one of those must refuse rather than dispatch.
"""

from __future__ import annotations

import json
import unittest

from wm_voice.commands import RESPONSE_SCHEMA, build_prompt, interpret
from wm_voice.phrasing import TEMPLATES, validate

SNAPSHOT = {
    "version": 1,
    "theme": "lcars",
    "actions": ["panel.focus", "map.focus", "theme.set", "theme.cycle", "voice.ptt"],
    "panels": [
        {"key": "cii", "title": "Country Instability", "readings": {"Sudan": "87.2"}},
        {"key": "markets", "title": "Markets"},
        {"key": "energy", "title": "Energy & Resources"},
    ],
}


def model(action=None, argument=None, speech="Acknowledged.") -> str:
    return json.dumps({"action": action, "argument": argument, "speech": speech})


class Accepts(unittest.TestCase):
    def test_a_valid_action_on_a_real_panel(self) -> None:
        command = interpret(model("panel.focus", "cii"), SNAPSHOT)
        self.assertTrue(command.performs)
        self.assertEqual((command.action, command.argument), ("panel.focus", "cii"))
        self.assertEqual(command.refusals, [])

    def test_an_action_with_no_argument(self) -> None:
        command = interpret(model("theme.cycle", None, "Acknowledged."), SNAPSHOT)
        self.assertEqual(command.action, "theme.cycle")
        self.assertIsNone(command.argument)

    def test_a_spoken_answer_with_no_action(self) -> None:
        command = interpret(model(None, None, "Sudan is eighty-seven point two."), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, "Sudan is eighty-seven point two.")

    def test_a_fenced_json_reply(self) -> None:
        # A model asked for JSON will sometimes wrap it in a fence anyway.
        raw = "```json\n" + model("map.focus") + "\n```"
        self.assertEqual(interpret(raw, SNAPSHOT).action, "map.focus")


class Refuses(unittest.TestCase):
    def test_an_action_not_in_the_registry(self) -> None:
        # The model inventing a plausible-sounding action is the failure this
        # whole boundary exists for.
        command = interpret(model("system.reboot"), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, TEMPLATES["refused"])
        self.assertIn("unknown action 'system.reboot'", command.refusals)

    def test_a_panel_that_is_not_on_the_dashboard(self) -> None:
        # A key the dashboard does not render would dispatch, do nothing, and
        # look exactly like a broken display.
        command = interpret(model("panel.focus", "warp-core"), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, TEMPLATES["unavailable"])
        self.assertIn("panel 'warp-core' is not on the dashboard", command.refusals)

    def test_panel_focus_without_a_panel(self) -> None:
        command = interpret(model("panel.focus", None), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, TEMPLATES["ambiguous"])

    def test_a_reply_that_is_not_json(self) -> None:
        # Free text cannot be told apart from a hallucinated action, so it is
        # refused wholesale rather than partially trusted.
        command = interpret("Sure! Focusing the market panel for you.", SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, TEMPLATES["unavailable"])
        self.assertEqual(command.refusals, ["response was not JSON"])

    def test_json_that_is_not_an_object(self) -> None:
        for raw in ("[1,2,3]", '"just a string"', "null", "42"):
            with self.subTest(raw=raw):
                self.assertFalse(interpret(raw, SNAPSHOT).performs)

    def test_an_empty_action_string(self) -> None:
        command = interpret(model("", None, "Working."), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, "Working.")

    def test_a_non_string_action(self) -> None:
        raw = json.dumps({"action": {"name": "panel.focus"}, "speech": "Acknowledged."})
        self.assertFalse(interpret(raw, SNAPSHOT).performs)

    def test_an_empty_snapshot_permits_no_actions_at_all(self) -> None:
        # Before the first snapshot arrives the model may request nothing. The
        # alternative - a default allow-list - is an assistant that acts on a
        # dashboard it has never seen.
        command = interpret(model("theme.cycle"), {"actions": [], "panels": []})
        self.assertFalse(command.performs)
        self.assertIn("unknown action 'theme.cycle'", command.refusals)


class Speech(unittest.TestCase):
    def test_a_missing_speech_field_falls_back_rather_than_saying_nothing(self) -> None:
        command = interpret(json.dumps({"action": "theme.cycle"}), SNAPSHOT)
        self.assertEqual(command.speech, TEMPLATES["acknowledged"])
        self.assertEqual(command.action, "theme.cycle")

    def test_every_refusal_speaks_in_register(self) -> None:
        # A refusal that fails the phrasing validator would be a trap: the
        # boundary rejects a bad action and then says something chatty.
        for raw in (
            model("system.reboot"),
            model("panel.focus", "warp-core"),
            model("panel.focus", None),
            "not json at all",
        ):
            with self.subTest(raw=raw[:40]):
                command = interpret(raw, SNAPSHOT)
                self.assertTrue(validate(command.speech).ok, command.speech)


class Prompt(unittest.TestCase):
    def test_lists_actions_and_panel_vocabulary(self) -> None:
        prompt = build_prompt(SNAPSHOT)
        self.assertIn("panel.focus", prompt)
        self.assertIn("cii (Country Instability)", prompt)
        self.assertIn("Current theme: lcars", prompt)

    def test_does_not_dump_panel_readings_into_the_prompt(self) -> None:
        # Pushing every panel's numbers into every prompt costs
        # prompt-processing time on a CPU for data the model usually does not
        # need, and grows without bound as panels are added. The model asks for
        # a reading with a tool; the prompt supplies only the vocabulary.
        prompt = build_prompt(SNAPSHOT)
        self.assertNotIn("87.2", prompt)
        self.assertNotIn("Sudan", prompt)

    def test_mentions_an_alert_state(self) -> None:
        self.assertIn("alert state", build_prompt({**SNAPSHOT, "alert": True}))
        self.assertNotIn("alert state", build_prompt(SNAPSHOT))

    def test_survives_an_empty_snapshot(self) -> None:
        self.assertIsInstance(build_prompt({}), str)


class Schema(unittest.TestCase):
    def test_the_constrained_decoding_schema_matches_what_interpret_reads(self) -> None:
        # Ollama's `format` makes the shape near-certain; if the two drift, the
        # model is constrained to a shape the validator does not accept.
        self.assertEqual(set(RESPONSE_SCHEMA["properties"]), {"action", "argument", "speech"})
        self.assertEqual(RESPONSE_SCHEMA["required"], ["speech"])



class NativeToolCalls(unittest.TestCase):
    """A tool call and a JSON contract must reach the same verdict.

    The guarantee is that the boundary does not depend on how the model was
    asked. If these two paths could diverge, a model with tool calling would
    be trusted more than one without - which is exactly backwards.
    """

    def call(self, tool: str, arguments: dict, speech: str = "Acknowledged.") -> str:
        return json.dumps({"tool": tool, "arguments": arguments, "speech": speech})

    def test_a_ui_tool_call_becomes_the_same_action(self) -> None:
        native = interpret(self.call("focus_panel", {"panel": "cii"}), SNAPSHOT)
        contract = interpret(model("panel.focus", "cii"), SNAPSHOT)
        self.assertEqual((native.action, native.argument), ("panel.focus", "cii"))
        self.assertEqual((native.action, native.argument), (contract.action, contract.argument))

    def test_a_tool_call_naming_an_unrendered_panel_is_refused(self) -> None:
        command = interpret(self.call("focus_panel", {"panel": "warp-core"}), SNAPSHOT)
        self.assertFalse(command.performs)
        self.assertEqual(command.speech, TEMPLATES["unavailable"])

    def test_an_argumentless_ui_tool(self) -> None:
        command = interpret(self.call("cycle_theme", {}), SNAPSHOT)
        self.assertEqual(command.action, "theme.cycle")
        self.assertIsNone(command.argument)

    def test_a_data_tool_is_reported_for_execution_not_dispatched(self) -> None:
        # Data tools are run by the sidecar; they are not dashboard actions,
        # and must never be dispatched as one.
        command = interpret(self.call("get_country_risk", {"country": "Sudan"}), SNAPSHOT)
        self.assertTrue(command.needs_tool)
        self.assertFalse(command.performs)
        self.assertEqual(command.tool, "get_country_risk")
        self.assertEqual(command.tool_arguments, {"country": "Sudan"})

    def test_malformed_tool_arguments_do_not_raise(self) -> None:
        raw = json.dumps({"tool": "focus_panel", "arguments": "not-an-object", "speech": "Ok."})
        command = interpret(raw, SNAPSHOT)
        # No panel argument survives, so it refuses rather than guessing.
        self.assertFalse(command.performs)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
