"""Adapter selection.

The adapters themselves need hardware and are not tested here. What is tested
is the one piece of real logic among them: choosing an engine from a string a
human typed into an environment variable.
"""

from __future__ import annotations

import unittest

from wm_voice.adapters import TTS_ENGINES, KokoroTTS, PiperTTS, build_tts
from wm_voice.config import Config


class EngineSelection(unittest.TestCase):
    def test_both_documented_engines_are_reachable(self) -> None:
        # `WM_TTS_ENGINE` was read and never consumed, so Piper - the
        # documented hedge for Kokoro's CPU latency - could not be selected at
        # all. It was dead in exactly the situation it exists for.
        self.assertEqual(TTS_ENGINES, {"kokoro": KokoroTTS, "piper": PiperTTS})

    def test_an_unknown_engine_names_the_ones_that_exist(self) -> None:
        # Loud rather than degrading, uniquely in this codebase: the operator
        # is present at startup and absent forever afterwards, and a panel
        # speaking in a voice nobody chose is worse than one that will not
        # start and says why.
        with self.assertRaises(ValueError) as caught:
            build_tts(Config(tts_engine="festival"))
        message = str(caught.exception)
        self.assertIn("festival", message)
        self.assertIn("kokoro", message)
        self.assertIn("piper", message)

    def test_piper_is_built_without_importing_a_speech_stack(self) -> None:
        # Constructing it must not need the binary present - only calling it.
        # That is what lets an unknown-engine typo fail differently from a
        # missing install, and what lets this run in CI.
        engine = build_tts(Config(tts_engine="piper", tts_voice="/models/en_GB.onnx"))
        self.assertIsInstance(engine, PiperTTS)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
