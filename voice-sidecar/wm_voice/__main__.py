"""Entry point. `python -m wm_voice`."""

from __future__ import annotations

import asyncio
import logging

from .adapters import KokoroTTS, OllamaLLM, PipeAudio, WhisperSTT
from .config import CONFIG
from .pipeline import Pipeline
from .server import Broadcast, Sidecar, serve


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    events = Broadcast()
    pipeline = Pipeline(
        stt=WhisperSTT(CONFIG),
        llm=OllamaLLM(CONFIG),
        tts=KokoroTTS(CONFIG),
        audio=PipeAudio(),
        events=events,
    )
    asyncio.run(serve(Sidecar(pipeline, events)))


if __name__ == "__main__":
    main()
