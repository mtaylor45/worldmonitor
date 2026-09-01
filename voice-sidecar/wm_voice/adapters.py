"""Concrete adapters for the pipeline's protocols.

Every import of a heavy dependency is deferred into the constructor, so this
module imports cleanly on a machine with no models, no audio device and no
Ollama - which is what lets the pipeline tests run in CI at all.

None of these can be exercised without hardware. They are kept deliberately
thin for that reason: anything with real logic belongs in `pipeline.py` or
`phrasing.py`, where it can be tested.
"""

from __future__ import annotations

import asyncio
import json
import urllib.request
from typing import Any

from .commands import RESPONSE_SCHEMA, SYSTEM_PROMPT, build_prompt
from .config import Config

class WhisperSTT:
    """faster-whisper. `small.en` int8 per SCOPE.md §7.3."""

    def __init__(self, config: Config) -> None:
        from faster_whisper import WhisperModel  # noqa: PLC0415 - deferred on purpose

        self._model = WhisperModel(
            config.stt_model, device="cpu", compute_type=config.stt_compute
        )

    async def transcribe(self, audio: bytes) -> str:
        def _run() -> str:
            import io  # noqa: PLC0415

            segments, _ = self._model.transcribe(io.BytesIO(audio), language="en")
            return " ".join(s.text for s in segments).strip()

        # Whisper is synchronous and CPU-bound; a thread keeps the event loop
        # free to keep streaming state to the dashboard while it runs.
        return await asyncio.to_thread(_run)


class ChatLLM:
    """OpenAI-compatible chat completion, with native tool calling.

    Speaks to llama.cpp's `llama-server` or to Ollama's `/v1` - the API is the
    same, so the runtime is a deployment choice rather than a code one.

    Tool calling IS used here, and that is not a reversal of the JSON-contract
    design. Both are transports for the same claim: the model names a tool and
    its arguments, and `tools.py` plus `commands.py` validate that claim
    against a registry the model cannot influence. Native tool calling is the
    better transport when the model has it, because the shape is parsed by the
    server rather than by us. The boundary is unchanged.
    """

    def __init__(self, config: Config, registry: object | None = None) -> None:
        self._url = config.llm_url.rstrip("/") + "/chat/completions"
        self._model = config.llm_model
        self._thinking = config.llm_thinking
        self._registry = registry

    async def answer(self, question: str, snapshot: dict[str, object]) -> str:
        system = SYSTEM_PROMPT
        if not self._thinking:
            # Qwen3 reads this directive. A chain of thought the user never
            # hears is latency spent on nothing, and on this CPU it is the
            # single biggest per-turn saving available.
            system += "\n/no_think"

        payload: dict[str, Any] = {
            "model": self._model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "system", "content": build_prompt(snapshot)},
                {"role": "user", "content": question},
            ],
            "temperature": 0.2,
            # Two sentences plus a small envelope. Capping this is also the
            # cheapest latency control available on a CPU.
            "max_tokens": 160,
        }

        schemas = getattr(self._registry, "schemas", None)
        if callable(schemas):
            tools = schemas()
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = "auto"
        else:
            # No registry, or a model without tool calling: fall back to
            # constrained JSON. Same contract, same validator.
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "command", "schema": RESPONSE_SCHEMA},
            }

        def _run() -> str:
            request = urllib.request.Request(
                self._url,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=15) as handle:
                body = json.loads(handle.read())
            message = (body.get("choices") or [{}])[0].get("message", {})

            # A native tool call is normalised into the same JSON shape the
            # validator already reads, so downstream code never branches on
            # which transport produced it.
            calls = message.get("tool_calls") or []
            if calls:
                call = calls[0].get("function", {})
                raw_args = call.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except (ValueError, TypeError):
                    args = {}
                return json.dumps(
                    {
                        "tool": call.get("name"),
                        "arguments": args,
                        "speech": str(message.get("content") or "").strip(),
                    }
                )

            return str(message.get("content", "")).strip()

        try:
            return await asyncio.to_thread(_run)
        except Exception:
            # A dead model server is a failed turn, not a crashed sidecar.
            # Empty text makes `interpret` refuse, which speaks the
            # unavailable template - the honest answer.
            return ""


#: Back-compat alias. The name changed when the adapter stopped being
#: Ollama-specific; the behaviour did not.
OllamaLLM = ChatLLM


class KokoroTTS:
    """Kokoro 82M, with the signal chain applied after synthesis."""

    def __init__(self, config: Config) -> None:
        from kokoro import KPipeline  # noqa: PLC0415 - deferred on purpose

        self._pipeline = KPipeline(lang_code="a")
        self._voice = config.tts_voice
        self._chain = config.signal_chain

    async def synthesize(self, text: str) -> bytes:
        def _run() -> bytes:
            import io  # noqa: PLC0415
            import wave  # noqa: PLC0415

            chunks = [audio for _, _, audio in self._pipeline(text, voice=self._voice)]
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(24_000)
                for chunk in chunks:
                    handle.writeframes((chunk * 32767).astype("<i2").tobytes())
            return buffer.getvalue()

        wav = await asyncio.to_thread(_run)
        if not self._chain:
            return wav
        from . import signal_chain  # noqa: PLC0415

        try:
            return await signal_chain.process(wav)
        except Exception:
            # Unprocessed audio is still a working assistant; silence is not.
            return wav


class PipeAudio:
    """Plays a WAV through PipeWire, per SCOPE.md §9."""

    async def play(self, wav: bytes) -> None:
        proc = await asyncio.create_subprocess_exec(
            "pw-play", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.communicate(wav)
