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


class OllamaLLM:
    """Ollama chat completion over HTTP, with constrained JSON decoding.

    Uses urllib rather than a client library: one POST to localhost does not
    justify a dependency on a kiosk image that has to stay small.

    `format` carries the response schema, so the model is constrained to emit a
    well-formed object rather than asked nicely to. That is what makes this
    work on a model with no native tool calling - see `commands.py` for why
    that is the deliberate design rather than a workaround.
    """

    def __init__(self, config: Config) -> None:
        self._url = config.ollama_url.rstrip("/") + "/api/chat"
        self._model = config.ollama_model

    async def answer(self, question: str, snapshot: dict[str, object]) -> str:
        payload = {
            "model": self._model,
            "stream": False,
            "format": RESPONSE_SCHEMA,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "system", "content": build_prompt(snapshot)},
                {"role": "user", "content": question},
            ],
            "options": {
                # Low temperature: the register and the action list are
                # constraints, not style choices, and a creative model is one
                # that drifts out of them faster.
                "temperature": 0.2,
                # Two sentences plus a small JSON envelope. Capping this is
                # also the cheapest latency control there is on a CPU.
                "num_predict": 120,
            },
        }

        def _run() -> str:
            request = urllib.request.Request(
                self._url,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=10) as handle:
                body = json.loads(handle.read())
            return str(body.get("message", {}).get("content", "")).strip()

        try:
            return await asyncio.to_thread(_run)
        except Exception:
            # A dead model server is a failed turn, not a crashed sidecar.
            # Returning empty text makes `interpret` refuse, which speaks the
            # unavailable template - the honest answer.
            return ""


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
