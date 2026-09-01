"""Entry point. `python -m wm_voice`."""

from __future__ import annotations

import asyncio
import logging

from .adapters import ChatLLM, KokoroTTS, PipeAudio, WhisperSTT
from .alerts import AlertWatcher, parse_rules, parse_window
from .audio import AudioSource
from .config import CONFIG
from .pipeline import Pipeline
from .server import RISK_SCORES_PATH, Broadcast, Sidecar, serve
from .tools import ToolRegistry, WorldMonitorApi
from .wake import WakeWatcher, build_scorer


log = logging.getLogger("wm_voice")


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

    # Proactive alerts (P4-1). The thresholds are the user's; everything that
    # decides whether a crossing is worth interrupting someone for - hysteresis,
    # the minimum interval, quiet hours - is in the watcher.
    alerts = AlertWatcher(
        parse_rules(CONFIG.alert_rules),
        clear_margin=CONFIG.alert_clear_margin,
        min_interval_s=CONFIG.alert_min_interval_s,
        quiet_hours=parse_window(CONFIG.alert_quiet_hours),
        speak=CONFIG.alert_speak,
    )
    if not alerts.enabled:
        log.warning("no alert rules parsed from WM_ALERT_RULES; proactive alerts disabled")

    # The same API client the data tools use. One endpoint returns every
    # tracked region, so a poll is one request rather than one per country.
    watch_api = WorldMonitorApi(CONFIG.api_url)

    asyncio.run(
        serve(
            Sidecar(
                pipeline,
                events,
                CONFIG,
                audio=audio,
                wake=wake,
                alerts=alerts,
                fetch_risk_scores=lambda: watch_api.get(RISK_SCORES_PATH),
            )
        )
    )


if __name__ == "__main__":
    main()
