"""Protocol tests, including the cross-language contract.

The contract test parses the TypeScript twin and asserts the two agree on every
constant. Two implementations of one protocol in two languages drift silently:
adding a state on one side and forgetting the other produces a dashboard stuck
on a stale indicator, with nothing in either log to say why.
"""

from __future__ import annotations

import json
import pathlib
import re
import unittest

from wm_voice import protocol

TS = pathlib.Path(__file__).resolve().parents[2] / "src" / "voice" / "protocol.ts"


def ts_string_array(name: str) -> list[str]:
    """Extracts `export const NAME = ['a', 'b'] as const;` from the twin."""
    source = TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const " + name + r"\s*=\s*\[(.*?)\]\s*as const;", source, re.S
    )
    if not match:
        raise AssertionError("could not find " + name + " in " + str(TS))
    return re.findall(r"'([^']+)'", match.group(1))


class CrossLanguageContract(unittest.TestCase):
    def test_the_typescript_twin_exists(self) -> None:
        # If this moves, the rest of the contract silently stops being checked.
        self.assertTrue(TS.is_file(), "missing TypeScript protocol at " + str(TS))

    def test_voice_states_match(self) -> None:
        self.assertEqual(list(protocol.VOICE_STATES), ts_string_array("VOICE_STATES"))

    def test_server_messages_match(self) -> None:
        self.assertEqual(
            list(protocol.SERVER_MESSAGES), ts_string_array("SERVER_MESSAGES")
        )

    def test_client_messages_match(self) -> None:
        self.assertEqual(
            list(protocol.CLIENT_MESSAGES), ts_string_array("CLIENT_MESSAGES")
        )

    def test_protocol_version_matches(self) -> None:
        source = TS.read_text(encoding="utf-8")
        match = re.search(r"export const PROTOCOL_VERSION\s*=\s*(\d+)", source)
        assert match is not None
        self.assertEqual(protocol.PROTOCOL_VERSION, int(match.group(1)))

    def test_every_server_message_has_a_builder(self) -> None:
        # A message type in the list with no way to construct it is dead
        # protocol surface that the TypeScript side will still branch on.
        for name in protocol.SERVER_MESSAGES:
            with self.subTest(message=name):
                self.assertTrue(
                    callable(getattr(protocol, name, None)),
                    "no builder for server message " + repr(name),
                )


class Frames(unittest.TestCase):
    def test_state_frame(self) -> None:
        self.assertEqual(
            json.loads(protocol.state("listening")),
            {"type": "state", "state": "listening"},
        )

    def test_state_rejects_an_unknown_value(self) -> None:
        with self.assertRaises(ValueError):
            protocol.state("daydreaming")

    def test_wake_frame_omits_absent_confidence(self) -> None:
        self.assertEqual(json.loads(protocol.wake()), {"type": "wake"})
        self.assertEqual(
            json.loads(protocol.wake(0.82)), {"type": "wake", "confidence": 0.82}
        )

    def test_transcript_frame(self) -> None:
        self.assertEqual(
            json.loads(protocol.transcript("show me sudan", False)),
            {"type": "transcript", "text": "show me sudan", "final": False},
        )

    def test_response_and_error_frames(self) -> None:
        self.assertEqual(
            json.loads(protocol.response("Acknowledged.")),
            {"type": "response", "text": "Acknowledged."},
        )
        self.assertEqual(
            json.loads(protocol.error("stt unavailable")),
            {"type": "error", "message": "stt unavailable"},
        )


class ClientParsing(unittest.TestCase):
    def test_accepts_known_messages(self) -> None:
        self.assertEqual(
            protocol.parse_client_message('{"type":"ptt","pressed":true}'),
            {"type": "ptt", "pressed": True},
        )
        self.assertEqual(
            protocol.parse_client_message('{"type":"cancel"}'), {"type": "cancel"}
        )

    def test_drops_malformed_frames_rather_than_raising(self) -> None:
        # The sidecar runs unattended; one bad frame must not end the session.
        for raw in ('{"type":"ptt"}', '{"type":"nope"}', "not json", "[]", "null"):
            with self.subTest(raw=raw):
                self.assertIsNone(protocol.parse_client_message(raw))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
