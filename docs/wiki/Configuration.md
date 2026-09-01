# Configuration

Every runtime knob, in one place. The sidecar is configured entirely by
environment variables; defaults target the NUC6i7KYK described in `SCOPE.md` §2,
and every value is overridable so the same image runs on a workstation.

Set them in `voice-sidecar/docker-compose.yml`, or export them before
`python -m wm_voice`.

---

## Server

| Variable | Default | Notes |
|---|---|---|
| `WM_VOICE_HOST` | `0.0.0.0` | |
| `WM_VOICE_PORT` | `8765` | The dashboard connects to `ws://<host>:8765/voice` |

## Wake word

See [Wake Word](Wake-Word) for what these actually do and how to tune them.

| Variable | Default | Notes |
|---|---|---|
| `WM_WAKE_MODEL` | *(empty)* | Path to a trained "Computer" model. **Empty means push-to-talk only** — openWakeWord ships no model for this word |
| `WM_WAKE_FRAMEWORK` | `onnx` | `tflite` if you exported that instead |
| `WM_WAKE_THRESHOLD` | `0.7` | Higher than openWakeWord's 0.5, because "computer" occurs in ordinary speech |
| `WM_WAKE_CONSECUTIVE` | `2` | Frames above threshold before firing. Kills single-frame spikes |
| `WM_WAKE_REFRACTORY` | `2.0` | Seconds. One utterance, one wake |
| `WM_WAKE_DURING_PLAYBACK` | `1` | `0` only on hardware with no echo cancellation — costs interruptibility |
| `WM_WAKE_LEAD_IN` | `1.2` | Seconds of grace before speech, after a wake word |
| `WM_PREROLL` | `1.0` | Seconds of recent audio replayed into a wake turn |

## Recognition

| Variable | Default | Notes |
|---|---|---|
| `WM_STT_MODEL` | `small.en` | `small.en` over `base.en`: the accuracy gain on place names is worth the latency, and place names are most of what gets asked |
| `WM_STT_COMPUTE` | `int8` | |

## Capture

Endpointing, not a fixed window. A fixed six-second recording spent twice the
entire latency budget on silence after a two-word command.

| Variable | Default | Notes |
|---|---|---|
| `WM_VAD_THRESHOLD` | `350` | RMS gate. Cheap; swap in Silero if the room proves noisier |
| `WM_SILENCE_TAIL` | `0.8` | Seconds of quiet after speech that ends the utterance |
| `WM_LEAD_IN` | `2.5` | Grace before speech starts — a user who just pressed LISTEN is still drawing breath |
| `WM_MAX_UTTERANCE` | `12` | Backstop for a room that never goes quiet. Not a target |

## Language model

| Variable | Default | Notes |
|---|---|---|
| `WM_LLM_URL` | `http://127.0.0.1:8080/v1` | llama.cpp `llama-server`. Ollama works — point at `:11434/v1` |
| `WM_LLM_MODEL` | `qwen3-8b-q4_k_m` | Q4_K_M because CPU decode here is memory-bandwidth bound |
| `WM_LLM_THINKING` | `0` | Qwen3 non-thinking mode. **The biggest per-turn saving available** |
| `WM_LLM_CONTEXT` | `8192` | Every unused token of context is prompt-processing time |
| `WM_LLM_THREADS` | `8` | Benchmark 6 against 8 — the NUC has 4 physical cores |
| `WM_FAST_MODEL` | *(empty)* | Optional tier-1 model. Off by default; measure first |
| `WM_API_URL` | `http://127.0.0.1:3000` | Where the data tools and the alert poller fetch from |

## Proactive alerts

See [Proactive Alerts](Proactive-Alerts) for the reasoning behind each guard.

| Variable | Default | Notes |
|---|---|---|
| `WM_ALERT_RULES` | `*>85` | `Region>score` for a level, `Region+points` for a 24-hour rise, `*` catch-all. Comma-separated |
| `WM_ALERT_CLEAR_MARGIN` | `5.0` | Hysteresis. How far below the line before it can fire again |
| `WM_ALERT_POLL` | `300` | Seconds between risk-score polls |
| `WM_ALERT_MIN_INTERVAL` | `900` | Seconds between **spoken** alerts. The display is unaffected |
| `WM_ALERT_QUIET_HOURS` | `22:00-07:00` | Local time, may wrap midnight. Silences the voice, never the display. Empty disables |
| `WM_ALERT_SPEAK` | `1` | `0` for a display-only alert state |

## Speech

| Variable | Default | Notes |
|---|---|---|
| `WM_TTS_ENGINE` | `kokoro` | Piper if CPU latency disappoints |
| `WM_TTS_VOICE` | `af_sarah` | Audition on the panel, not in headphones |
| `WM_SIGNAL_CHAIN` | `1` | `0` to hear a raw voice against a processed one |

---

## Dashboard-side selection

The theme is not an environment variable — it is chosen in the browser and
persisted:

| Method | Example |
|---|---|
| URL pin | `?wm-theme=lcars`, `?wm-theme=lcars-bright`, `?wm-theme=default` |
| Rail button | Cycles through registered themes |
| Voice | "Computer, change the theme" |

A URL pin overrides storage **without becoming sticky**, which is what makes it
usable for a one-off comparison on the panel. There is a test for that.
