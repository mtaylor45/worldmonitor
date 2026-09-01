"""Sidecar configuration, entirely from the environment.

Defaults target the NUC described in SCOPE.md §2. Every value is overridable so
the same image runs on a workstation during development.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip() or default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


@dataclass(frozen=True)
class Config:
    host: str = _env("WM_VOICE_HOST", "0.0.0.0")
    port: int = int(_env("WM_VOICE_PORT", "8765"))

    # openWakeWord. 0.5 is the library default; the field value is whatever
    # survives the 24-hour false-wake test in SCOPE.md §5 P2, which cannot be
    # run anywhere but the room the panel lives in.
    wake_model: str = _env("WM_WAKE_MODEL", "hey_jarvis")
    wake_threshold: float = _float("WM_WAKE_THRESHOLD", 0.5)

    # small.en over base.en: the accuracy gain on place names is worth the
    # latency on a 4-core Skylake, and place names are most of what gets asked.
    stt_model: str = _env("WM_STT_MODEL", "small.en")
    stt_compute: str = _env("WM_STT_COMPUTE", "int8")

    ollama_url: str = _env("WM_OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = _env("WM_OLLAMA_MODEL", "qwen2.5:7b-instruct")

    # Kokoro first, Piper if CPU latency disappoints (docs/VOICE-CHARACTER.md).
    tts_engine: str = _env("WM_TTS_ENGINE", "kokoro")
    tts_voice: str = _env("WM_TTS_VOICE", "af_sarah")

    # Post-TTS signal chain. Disable to audition a raw voice against a
    # processed one, which is the only way to hear what the chain is doing.
    signal_chain: bool = _env("WM_SIGNAL_CHAIN", "1") != "0"

    @property
    def endpoint(self) -> str:
        return f"ws://{self.host}:{self.port}/voice"


CONFIG = Config()
