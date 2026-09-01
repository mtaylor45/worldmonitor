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

    # ---- wake word -------------------------------------------------------
    #
    # The wake word is "Computer". openWakeWord ships NO pretrained model for
    # it - the bundled set is alexa / hey_jarvis / hey_mycroft / hey_rhasspy -
    # so this must point at a custom model trained from synthetic speech. See
    # docs/VOICE-CHARACTER.md. Empty means the wake word is disabled and only
    # push-to-talk works; the sidecar says so at startup rather than sitting
    # silent and looking like it is listening.
    wake_model: str = _env("WM_WAKE_MODEL", "")
    wake_framework: str = _env("WM_WAKE_FRAMEWORK", "onnx")

    # 0.7 rather than openWakeWord's 0.5 default. "Computer" is a single common
    # word that occurs in ordinary speech, so the false-accept rate is the
    # design problem here, not the miss rate.
    wake_threshold: float = _float("WM_WAKE_THRESHOLD", 0.7)

    # Frames above threshold before firing. Most false accepts on a common word
    # are single-frame spikes; requiring a run is the cheapest filter for them.
    wake_consecutive: int = int(_env("WM_WAKE_CONSECUTIVE", "2"))

    # One utterance, one wake. Without this the tail of the word fires again
    # while the user is still drawing breath.
    wake_refractory_s: float = _float("WM_WAKE_REFRACTORY", 2.0)

    # Keep scoring while the assistant speaks. This is what makes the AEC
    # acceptance test meaningful: say the wake word over a long response and
    # see whether it is heard. Set to 0 on a device with no echo cancellation,
    # where the assistant would otherwise hear itself - at the cost of not
    # being interruptible.
    wake_during_playback: bool = _env("WM_WAKE_DURING_PLAYBACK", "1") != "0"

    # Shorter than `lead_in_s`: after a wake word the user is already talking,
    # because the word itself was the run-up.
    wake_lead_in_s: float = _float("WM_WAKE_LEAD_IN", 1.2)

    # How much recent audio is kept for pre-roll. Detection has latency, so by
    # the time the model fires the speaker is usually into the command.
    preroll_s: float = _float("WM_PREROLL", 1.0)

    # small.en over base.en: the accuracy gain on place names is worth the
    # latency on a 4-core Skylake, and place names are most of what gets asked.
    stt_model: str = _env("WM_STT_MODEL", "small.en")
    stt_compute: str = _env("WM_STT_COMPUTE", "int8")

    # ---- language model -------------------------------------------------
    #
    # llama.cpp's OpenAI-compatible server rather than Ollama: it exposes
    # native tool-call parsing for Qwen, takes an explicit thread count, and
    # AVX2 builds matter on a Skylake part. Ollama still works - point
    # `WM_LLM_URL` at :11434/v1 and it speaks the same API.
    llm_url: str = _env("WM_LLM_URL", "http://127.0.0.1:8080/v1")

    # Qwen3 8B Q4_K_M. Q4_K_M rather than a higher quant because CPU decode on
    # this box is memory-bandwidth bound at ~34 GB/s: an 8-bit 8B moves roughly
    # twice the bytes per token for quality this workload does not need.
    llm_model: str = _env("WM_LLM_MODEL", "qwen3-8b-q4_k_m")

    # Qwen3 has thinking and non-thinking modes. Voice turns run non-thinking:
    # a chain of thought the user never hears is latency spent on nothing, and
    # this is the single biggest per-turn saving available.
    llm_thinking: bool = _env("WM_LLM_THINKING", "0") != "0"

    # Optional tier-1 model for short conversational replies. Off by default:
    # a second resident model costs RAM and another thing to keep loaded, and
    # the pattern tier already covers the commands people repeat. Measure
    # before enabling. Suggested: qwen3-1.7b-q4_k_m.
    fast_model: str = _env("WM_FAST_MODEL", "")

    # 8K is enough for the tool schemas plus a short turn, and every unused
    # token of context is prompt-processing time on a CPU.
    llm_context: int = int(_env("WM_LLM_CONTEXT", "8192"))

    # Benchmark 6 against 8: the NUC has 4 physical cores, and on some
    # workloads hyperthreads cost more in contention than they return.
    llm_threads: int = int(_env("WM_LLM_THREADS", "8"))

    # Where the dashboard's own HTTP API lives, for the data tools.
    api_url: str = _env("WM_API_URL", "http://127.0.0.1:3000")

    # ---- capture ---------------------------------------------------------
    #
    # Voice-activity endpointing. A fixed-length recording spends the whole
    # latency budget on silence after a two-word command; these stop as soon as
    # the speaker does.
    vad_threshold: float = _float("WM_VAD_THRESHOLD", 350.0)
    #: Quiet after speech that ends the utterance.
    silence_tail_s: float = _float("WM_SILENCE_TAIL", 0.8)
    #: Longer grace before speech starts - the user is still drawing breath.
    lead_in_s: float = _float("WM_LEAD_IN", 2.5)
    #: Backstop for a room that never goes quiet. Not a target.
    max_utterance_s: float = _float("WM_MAX_UTTERANCE", 12.0)

    # Kokoro first, Piper if CPU latency disappoints (docs/VOICE-CHARACTER.md).
    tts_engine: str = _env("WM_TTS_ENGINE", "kokoro")
    tts_voice: str = _env("WM_TTS_VOICE", "af_sarah")

    # Post-TTS signal chain. Disable to audition a raw voice against a
    # processed one, which is the only way to hear what the chain is doing.
    signal_chain: bool = _env("WM_SIGNAL_CHAIN", "1") != "0"

    @property
    def ollama_url(self) -> str:
        """Back-compat alias. The adapter speaks the OpenAI-compatible API."""
        return self.llm_url

    @property
    def ollama_model(self) -> str:
        return self.llm_model

    @property
    def endpoint(self) -> str:
        return f"ws://{self.host}:{self.port}/voice"


CONFIG = Config()
