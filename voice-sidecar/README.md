# Voice sidecar

The local voice assistant for LCARS World Monitor. Runs as a container beside
the dashboard on the kiosk, never remotely.

```text
Microphone → openWakeWord → faster-whisper → Ollama → phrasing → TTS → signal chain → speaker
                    │                                     │
                    └──────────── WebSocket ──────────────┴──→ dashboard
```

No cloud service is in the runtime path.

## Why the browser does not own the audio

Microphone capture, wake-word detection, recognition and synthesis all live
here rather than in the page. Kiosk Chromium makes microphone permissions
painful, the browser adds nothing to that path, and a sidecar keeps voice
working across a dashboard reload. The frontend receives state over WebSocket
and renders it — nothing more.

## Run it

```bash
docker compose -f voice-sidecar/docker-compose.yml up -d
```

`--device /dev/snd` and host networking are both load-bearing: the container
needs real audio devices, and Ollama and the dashboard are on localhost.

Locally, without containers:

```bash
cd voice-sidecar
pip install -r requirements.txt
python -m wm_voice
```

## Configuration

Everything is environment variables; defaults target the NUC in `SCOPE.md` §2.

| Variable | Default | Notes |
|---|---|---|
| `WM_VOICE_PORT` | `8765` | The dashboard connects to `ws://<host>:8765/voice` |
| `WM_WAKE_MODEL` | `hey_jarvis` | Replace with a custom "Computer" model |
| `WM_WAKE_THRESHOLD` | `0.5` | Tune against the 24-hour false-wake test |
| `WM_STT_MODEL` | `small.en` | `small.en` over `base.en`: the accuracy gain on place names is worth the latency, and place names are most of what gets asked |
| `WM_STT_COMPUTE` | `int8` | |
| `WM_OLLAMA_MODEL` | `gemma3n:e2b` | Tool calling **not** required — see below |
| `WM_TTS_ENGINE` | `kokoro` | Piper if CPU latency disappoints |
| `WM_TTS_VOICE` | `af_sarah` | Audition on the panel, not in headphones |
| `WM_SIGNAL_CHAIN` | `1` | `0` to hear a raw voice against a processed one |

## Layout

| File | Contents |
|---|---|
| `phrasing.py` | The register: validator, templates, numerals. **Layer 1** |
| `commands.py` | P3's boundary: the JSON contract, the prompt, and the validator |
| `pipeline.py` | Turn orchestration and the latency budget |
| `protocol.py` | Wire protocol, mirrored in `src/voice/protocol.ts` |
| `server.py` | WebSocket fan-out, push-to-talk, turn guard |
| `adapters.py` | openWakeWord / faster-whisper / Ollama / Kokoro / PipeWire |
| `signal_chain.py` | Post-TTS ffmpeg chain. **Layer 4** |
| `config.py` | Environment configuration |

## Commands, and why not tool calling

P3 turns speech into a validated action:

```text
user speech -> model -> JSON -> validated action -> wm:action -> dashboard
```

The model emits a JSON object naming an action; `commands.py` checks it against
the registry and the panel list and refuses anything it cannot verify; the
dashboard checks it **again** before dispatching. Two independent validations,
because the thing being validated is a language model's output.

Ollama's tool-calling API is deliberately unused, for two reasons.

The practical one: tool-calling models start around 7B, and on the NUC's
i7-6770HQ a 7B at roughly 3–5 tok/s spends four to seven seconds on a
twenty-token reply — over the three-second budget before anything else has run.
Gemma 3n E2B is several times faster, and has no native tool calling.

The architectural one, which matters more: tool calling hands the model a
mechanism that *looks* like it performs actions. What is wanted is a model that
describes an intention, checked against a registry it cannot influence. A JSON
contract plus a validator is that boundary stated plainly, and it works on any
model rather than a shortlist.

Constrained decoding (`format` given `RESPONSE_SCHEMA`) makes the shape
reliable. The validator assumes it can still be violated, because one that
trusts its input is not a validator.

If command interpretation disappoints, try **E4B** before reaching for a 7B.
Latency headroom is what makes the assistant feel responsive, and a larger
model spends it first.

## Measuring latency on hardware

```bash
cd voice-sidecar && python3 bench_latency.py --runs 20
```

Runs the real LLM and TTS against scripted transcripts and reports median, p95,
worst and per-stage medians, exiting non-zero if any turn misses the budget —
so it can gate a deploy rather than merely inform one. Recognition is scripted
out: it varies with utterance length rather than with anything the harness
changes, and folding it in would hide the stage that actually moves.

Expect the LLM stage to dominate. If it does not, that finding is more
interesting than the total.

## Tests

```bash
cd voice-sidecar && python3 -m unittest discover -s tests -t .
```

Standard library only — no pytest, no fixtures to install on a kiosk.

The adapters are injected as protocols rather than imported, because none of
the real ones run in CI: openWakeWord wants a microphone, faster-whisper wants
a model file, Ollama wants a server. What *is* tested is where the bugs live —
the register, the sequencing, the fan-out, and the turn guard.

One test reaches across languages: `test_protocol.py` parses
`src/voice/protocol.ts` and asserts the two implementations agree on every
constant. Two implementations of one protocol drift silently, and the symptom
is a dashboard stuck on a stale indicator with nothing in either log.

## What cannot be verified here

Three of P2's acceptance criteria are hardware measurements, and no amount of
test coverage substitutes:

- **Under 3 seconds** from end-of-speech to first audio, on CPU. The pipeline
  records per-stage timings (`Turn.timings`) so a regression names the stage
  that caused it rather than a total, but the numbers only mean something on
  the NUC.
- **Wake word survives the assistant's own TTS playback.** This is the AEC
  test, and it decides whether the audio hardware is usable at all: play a long
  response and say the wake word over the top. Responds = real full-duplex AEC.
  Ignores you until playback ends = ducking, and the device is the wrong
  category (`SCOPE.md` §8).
- **No false wake in 24 hours** of normal room noise. `WM_WAKE_THRESHOLD`
  exists to be tuned by this test and nothing else.

## Build order

From `docs/VOICE-CHARACTER.md`, and worth following:

1. **Phrasing rules and validator** — done. Test with any voice at all; if the
   words are right it already reads as the computer.
2. **Wake chirp** — done. Fires on detection, before recognition completes.
3. **Voice audition on hardware** — pending a panel and a speaker.
4. **Prosody tuning** — pending.
5. **Signal chain** — written, unverified by ear.

Steps 1 and 2 get most of the effect. Steps 3–5 are polish, and all three need
the room the panel will live in.
