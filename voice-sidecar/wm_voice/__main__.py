"""Entry point. `python -m wm_voice`."""

from __future__ import annotations

import asyncio
import logging

from .adapters import ChatLLM, KokoroTTS, PipeAudio, WhisperSTT
from .config import CONFIG
from .pipeline import Pipeline
from .server import Broadcast, Sidecar, serve
from .tools import ToolRegistry, WorldMonitorApi


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    events = Broadcast()

    # Data tools call World Monitor's own HTTP API. The model asks for what it
    # needs rather than being handed the whole dashboard every turn.
    tools = ToolRegistry(WorldMonitorApi(CONFIG.api_url))

    pipeline = Pipeline(
        stt=WhisperSTT(CONFIG),
        llm=ChatLLM(CONFIG, tools),
        tts=KokoroTTS(CONFIG),
        audio=PipeAudio(),
        events=events,
        tools=tools,
        fast_model=bool(CONFIG.fast_model),
    )
    asyncio.run(serve(Sidecar(pipeline, events)))


if __name__ == "__main__":
    main()
