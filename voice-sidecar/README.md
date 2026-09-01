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
| `WM_LLM_URL` | `http://127.0.0.1:8080/v1` | llama.cpp `llama-server`. Ollama works too: point at `:11434/v1` |
| `WM_LLM_MODEL` | `qwen3-8b-q4_k_m` | See the model note below |
| `WM_LLM_THINKING` | `0` | Qwen3 non-thinking mode. The biggest per-turn saving available |
| `WM_LLM_CONTEXT` | `8192` | Every unused token of context is prompt-processing time |
| `WM_LLM_THREADS` | `8` | Benchmark 6 against 8 — hyperthreads can cost more than they return |
| `WM_FAST_MODEL` | *(empty)* | Optional tier-1 model. Off by default; measure first |
| `WM_API_URL` | `http://127.0.0.1:3000` | Where the data tools fetch from |
| `WM_VAD_THRESHOLD` | `350` | RMS gate for endpointing |
| `WM_SILENCE_TAIL` | `0.8` | Quiet after speech that ends the utterance |
| `WM_LEAD_IN` | `2.5` | Grace before speech starts |
| `WM_MAX_UTTERANCE` | `12` | Backstop for a room that never goes quiet |
| `WM_TTS_ENGINE` | `kokoro` | Piper if CPU latency disappoints |
| `WM_TTS_VOICE` | `af_sarah` | Audition on the panel, not in headphones |
| `WM_SIGNAL_CHAIN` | `1` | `0` to hear a raw voice against a processed one |

## Layout

| File | Contents |
|---|---|
| `phrasing.py` | The register: validator, templates, numerals. **Layer 1** |
| `commands.py` | P3's boundary: the contract, the prompt, and the validator |
| `router.py` | Intent tiers. Tier 0 answers without a model at all |
| `tools.py` | Tool registry: UI tools dispatched, data tools fetched |
| `pipeline.py` | Turn orchestration and the latency budget |
| `protocol.py` | Wire protocol, mirrored in `src/voice/protocol.ts` |
| `server.py` | WebSocket fan-out, push-to-talk, turn guard |
| `adapters.py` | openWakeWord / faster-whisper / Ollama / Kokoro / PipeWire |
| `signal_chain.py` | Post-TTS ffmpeg chain. **Layer 4** |
| `config.py` | Environment configuration |

## The model, and the latency arithmetic

**Qwen3 8B Q4_K_M on llama.cpp**, non-thinking, with native tool calling.

Q4_K_M rather than a higher quant because CPU decode here is memory-bandwidth
bound. The NUC6i7KYK has ~34 GB/s; a Q4_K_M 8B is about 4.9 GB of weights, so
even at a generous 70% of theoretical bandwidth the decode ceiling is roughly
4–5 tok/s. Q8 moves twice the bytes per token for quality this workload does
not need.

That arithmetic has a consequence worth stating plainly:

> **An 8B cannot meet a three-second end-to-end budget on this CPU for a
> conversational answer.** At ~4 tok/s a forty-token reply is ~10 s of decode.
> A tool-calling turn is two model passes, so worse.

So the budget is split rather than pretended at:

| Tier | Handles | Model | Target |
|---|---|---|---|
| 0 · direct | "show the map", "focus markets", "change the theme" | **none** | **< 1 s** |
| 1 · fast | short conversational replies | 1.7B *(optional)* | < 3 s |
| 2 · full | questions, briefings, multi-step | 8B + tools | **8–12 s** |

Tier 0 is not a fallback for a broken model — it is the fast path for the
commands people actually repeat, and it is where the responsiveness comes from.
A wall panel gets "show the map" far more often than it gets a geopolitical
question, and none of those should wake an 8B.

Tier 1 is configured but **off by default**. A second resident model costs RAM
and another thing to keep loaded, and it only pays off once tier 0's coverage
stops growing. `WM_FAST_MODEL` enables it; measure before you do.

Tier 2 is where a briefing lives, and 8–12 s is acceptable there because the
user asked for a synthesis and the assistant says "Working." while it runs.
Pretending that fits in three seconds would just mean shipping something that
misses its own target on every interesting question.

## Tools, and both transports

```text
user speech -> router -> model -> tool or action -> validated -> dashboard
```

Two kinds of tool:

- **UI tools** (`focus_panel`, `focus_map`, `cycle_theme`) are *dispatched* to
  the dashboard, never executed here. The sidecar validates the name and
  argument; the dashboard validates them again before anything happens.
- **Data tools** (`get_region_status`, `get_country_risk`, `get_market_quotes`,
  `get_cyber_threats`, `get_region_brief`) call World Monitor's own HTTP API
  and return a trimmed result.

Every data tool is bound to an endpoint that exists. The paths were read out of
`proto/worldmonitor/**/service.proto` and their `sebuf.http.config`
annotations — the same discipline as "a rail button must name a panel upstream
actually renders". A tool that returns nothing is worse than an absent one,
because the model will keep choosing it.

**Native tool calling is used where the model has it, and it is not a reversal
of the JSON-contract design.** Both are transports for the same claim: the
model names a tool and its arguments, and the registry validates that claim
against a list it cannot influence. `interpret()` normalises a native call and
a JSON object into the same shape and applies the same checks, so the guarantee
does not depend on how the model was asked. A test asserts the two paths reach
identical verdicts.

**The dashboard state is not dumped into the prompt.** The snapshot carries the
*vocabulary* — which panels exist, which actions are available — and nothing
else. Readings come from tools. Pushing every panel's numbers into every turn
costs prompt-processing time for data the model usually does not need, and
grows without bound as panels are added.

## Capture: endpointing, not a fixed window

Recording stops when the speaker does. This replaced a fixed six-second window,
which was the single largest latency defect in the pipeline: every turn waited
six seconds before recognition could begin, spending twice the entire budget on
silence after a two-word command.

`WM_SILENCE_TAIL` ends the utterance; `WM_LEAD_IN` is a longer grace before
speech starts, because a user who just pressed LISTEN is still drawing breath.
The gate is RMS rather than a neural VAD — it costs nothing, and the microphone
here is a near-field conferencing unit. Swap in Silero if the room proves
noisier than the gate can handle.

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
