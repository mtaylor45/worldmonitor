"""Entry point. `python -m wm_voice`."""

from __future__ import annotations

import asyncio
import logging

from .adapters import ChatLLM, KokoroTTS, PipeAudio, WhisperSTT
from .audio import AudioSource
from .config import CONFIG
from .pipeline import Pipeline
from .server import Broadcast, Sidecar, serve
from .tools import ToolRegistry, WorldMonitorApi
from .wake import WakeWatcher, build_scorer


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
    # One microphone, two consumers: the wake detector listens continuously
    # while capture records on demand. Opening the device twice is how you get
    # an unhelpful "device busy" on the one machine nobody is sitting at.
    audio = AudioSource(preroll_s=CONFIG.preroll_s)

    # `build_scorer` never raises. With no "computer" model on disk - the
    # expected first run, since openWakeWord ships none - it logs why and
    # returns an unavailable scorer, leaving push-to-talk working.
    wake = WakeWatcher(
        build_scorer(CONFIG.wake_model, CONFIG.wake_framework),
        threshold=CONFIG.wake_threshold,
        consecutive=CONFIG.wake_consecutive,
        refractory_s=CONFIG.wake_refractory_s,
        listen_during_playback=CONFIG.wake_during_playback,
    )

    asyncio.run(serve(Sidecar(pipeline, events, CONFIG, audio=audio, wake=wake)))


if __name__ == "__main__":
    main()
