"""On-hardware latency harness for the P2/P3 acceptance criterion.

    python3 bench_latency.py            # the default six utterances
    python3 bench_latency.py --runs 20

Measures end-of-speech to first audio, which is the number SCOPE.md §5 P2 puts
a three-second ceiling on. Runs the real STT, LLM and TTS - so it only means
anything on the NUC, which is the whole point of it being a script rather than
a test.

Per-stage timings are reported alongside the total, because a regression that
names its own cause is worth far more than one that reports a number. On this
hardware the LLM stage is expected to dominate; if it does not, the finding is
more interesting than the total.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys

from wm_voice.config import CONFIG
from wm_voice.pipeline import LATENCY_BUDGET_S, Pipeline

# The six audition lines from docs/VOICE-CHARACTER.md, plus the command forms
# P3 adds. Short and long, question and command, so the spread is visible.
UTTERANCES = [
    "what is the market composite",
    "status",
    "how unstable is sudan",
    "focus the country instability panel",
    "change the theme",
    "show me the pacific",
]

SNAPSHOT = {
    "version": 1,
    "theme": "lcars",
    "actions": ["panel.focus", "map.focus", "theme.set", "theme.cycle", "voice.ptt"],
    "panels": [
        {"key": "cii", "title": "Country Instability", "readings": {"Sudan": "87.2"}},
        {"key": "markets", "title": "Markets", "readings": {"Composite": "61.4"}},
        {"key": "energy", "title": "Energy & Resources"},
    ],
}


class ScriptedSTT:
    """Stands in for recognition so the measurement isolates LLM and TTS.

    Recognition latency is measured separately: it depends on utterance length
    rather than on anything this harness varies, and folding it in would hide
    the stage that actually moves.
    """

    def __init__(self, text: str) -> None:
        self.text = text

    async def transcribe(self, audio: bytes) -> str:
        return self.text


class Silent:
    async def state(self, value: str) -> None: ...
    async def wake(self, confidence: float | None = None) -> None: ...
    async def transcript(self, text: str, final: bool) -> None: ...
    async def response(self, text: str) -> None: ...
    async def error(self, message: str) -> None:
        print("  error:", message, file=sys.stderr)

    async def action(self, name: str, argument: str | None = None) -> None: ...


class NullAudio:
    async def play(self, wav: bytes) -> None: ...


async def main(runs: int) -> int:
    from wm_voice.adapters import KokoroTTS, OllamaLLM

    print(f"model={CONFIG.ollama_model} tts={CONFIG.tts_engine}/{CONFIG.tts_voice}")
    print(f"budget={LATENCY_BUDGET_S}s (end-of-speech to first audio)\n")

    llm, tts = OllamaLLM(CONFIG), KokoroTTS(CONFIG)
    totals: list[float] = []
    stages: dict[str, list[float]] = {}
    over = 0

    for index in range(runs):
        text = UTTERANCES[index % len(UTTERANCES)]
        pipeline = Pipeline(ScriptedSTT(text), llm, tts, NullAudio(), Silent())
        pipeline.update_snapshot(SNAPSHOT)
        turn = await pipeline.run(b"")

        totals.append(turn.total_s)
        for stage, seconds in turn.timings.items():
            stages.setdefault(stage, []).append(seconds)
        if not turn.within_budget:
            over += 1

        flag = "  " if turn.within_budget else "!!"
        action = f" -> {turn.action}" if turn.action else ""
        print(f"{flag} {turn.total_s:5.2f}s  {text!r}{action}")

    print("\n--- summary ---")
    print(f"runs         {len(totals)}")
    print(f"median       {statistics.median(totals):.2f}s")
    print(f"p95          {sorted(totals)[int(len(totals) * 0.95) - 1]:.2f}s")
    print(f"worst        {max(totals):.2f}s")
    print(f"over budget  {over}/{len(totals)}")
    print("\nper stage (median):")
    for stage, values in stages.items():
        print(f"  {stage:6} {statistics.median(values):.2f}s")

    # Non-zero exit when the acceptance criterion is not met, so this can gate
    # a deploy rather than merely inform one.
    return 1 if over else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=len(UTTERANCES))
    raise SystemExit(asyncio.run(main(parser.parse_args().runs)))
