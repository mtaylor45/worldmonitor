# Voice character spec

Target: the LCARS computer voice of the TNG era. Reproduced through delivery,
phrasing, and signal chain rather than by cloning anyone.

Referenced by SCOPE.md §7.3 and P2.

---

## Scope note

We are not cloning Majel Barrett. She died in 2008, her voice belongs to her
estate, and the only training data available would be ripped episode audio.
There is a licensed path — she reportedly recorded phoneme banks before her
death so the voice could continue — and it isn't available to us.

This is not a meaningful loss. Timbre is roughly a third of what makes that
voice recognizable. The rest is below, and all of it is ours to build.

If a distinctive custom voice is wanted later, Chatterbox-Turbo (MIT) does
zero-shot cloning from 5–10 s of a **consenting speaker**. That consent is the
condition under which this project will use cloning at all.

---

## Layer 1 — Phrasing (highest impact, zero cost)

The ship's computer is not a chatbot. It does not hedge, apologize, editorialize,
or make conversation. Enforce this in the system prompt **and** validate the
output before it reaches TTS — models drift back toward chattiness over long
sessions.

### Canonical responses

| Situation | Say | Never say |
|---|---|---|
| Processing | "Working." | "Let me look that up for you!" |
| Answer | "Market composite is 61.4." | "It looks like the composite is around 61.4." |
| Ambiguous request | "Please specify." | "Could you clarify what you mean?" |
| No data | "That information is not available." | "I'm sorry, I couldn't find that." |
| Refusal | "Unable to comply." | "I'm afraid I can't do that." |
| Command done | "Acknowledged." | "Done! Anything else?" |
| Yes / no | "Affirmative." / "Negative." | "Yep" / "Nope" |
| Alert | "Alert. Instability index for Sudan has risen to eighty-seven." | "Heads up! Sudan's numbers are climbing." |

### Rules

- One or two sentences. Never three.
- No contractions.
- No first-person opinion. No "I think", "I'd suggest", "it seems".
- No pleasantries at either end. No greeting, no offer of further help.
- Restate the unit with the number: "Brent is up one point eight percent."
- Never ask a follow-up question unless the request was genuinely ambiguous,
  and then only "Please specify."
- Numbers spoken naturally, not digit-by-digit, except identifiers.

### Validator

Post-process before TTS. Reject and regenerate on: any sentence beginning with
"I", question marks other than after "Please specify", exclamation marks, more
than two sentences, or any of {sorry, happy to, feel free, let me know, great
question}.

Cheap and deterministic. Do this rather than trusting the prompt alone. On a
second rejection, fall back to a fixed template — a fixed template in the right
register beats a fluent sentence in the wrong one.

---

## Layer 2 — Prosody

Conversational TTS is too fast, too varied, and too warm. Flatten it.

Targets: ~140 wpm (conversational is 160–180), minimal pitch range, no upward
inflection on statements, no audible breath intake.

### Piper

Piper exposes the VITS sampling parameters directly, which is the most useful
control surface of any CPU-viable engine:

```bash
piper --model en_US-lessac-medium.onnx \
      --length-scale 1.15 \   # >1 slows delivery
      --noise-scale  0.45 \   # default 0.667; lower = less pitch variation
      --noise-w      0.40 \   # default 0.8; lower = more metronomic timing
      --output-file out.wav
```

`--noise-w` is the one that matters most. It controls phoneme duration
variation, and dropping it is what takes a voice from "person reading" to
"machine speaking." Sweep it from 0.8 down to 0.3 and listen.

### Kokoro

No equivalent sampling knobs. Control pace by inserting explicit punctuation and
by post-processing with `atempo` if needed. Voice choice matters more here —
audition the full set rather than assuming.

### Breath removal

Some engines synthesize breath intake. The ship's computer does not breathe.
If present, gate it: `ffmpeg -af "agate=threshold=0.02:ratio=4:attack=1:release=40"`.

---

## The wake word — "Computer"

The chosen wake word is **"Computer"**, and it is the hardest one to do well.
Two facts decide everything about how it is implemented.

### There is no pretrained model for it

openWakeWord ships `alexa`, `hey_jarvis`, `hey_mycroft` and `hey_rhasspy`.
Nothing for "computer". It has to be trained, and until it is,
`WM_WAKE_MODEL` stays empty: the sidecar reports the detector unavailable at
startup and push-to-talk carries the whole feature. That is deliberate. A wake
word that silently never fires is indistinguishable from a broken panel, and a
wall display is exactly where nobody would notice.

Training needs no recordings of your own voice. openWakeWord's pipeline
generates synthetic speech, mixes it with room noise, and trains against it:

```bash
pip install openwakeword[training]
python -m openwakeword.train \
    --target_word "computer" \
    --model_name computer \
    --n_samples 30000 \
    --output_dir ./wake-models
```

Export ONNX (the default; `WM_WAKE_FRAMEWORK=tflite` if you export that
instead), drop the file into the sidecar's model volume, and point
`WM_WAKE_MODEL` at it. Nothing else changes — `build_scorer` loads it or logs
why it could not, and never raises either way.

Two things worth doing at training time, because they cost nothing then and a
retraining run later:

- **Include the negative set.** "Computer" appears in ordinary speech, so
  training against clips that contain it in running sentences is what teaches
  the model the difference between an address and a mention.
- **Record fifty positives in the actual room** and hold them back as a test
  set. Synthetic speech trains well and evaluates badly; the room's
  reverberation is the thing the panel actually hears.

### It is a single common word, so false accepts are the problem

Not misses. "Hey Jarvis" essentially never occurs by accident; "computer" turns
up in conversation, and on a display that listens all day the failure that
matters is the news saying the word and the dashboard starting a turn. Three
filters, in `voice-sidecar/wm_voice/wake.py`, all tunable:

| Control | Default | What it removes |
|---|---|---|
| `WM_WAKE_THRESHOLD` | `0.7` | Low-confidence matches. openWakeWord's own default is 0.5 |
| `WM_WAKE_CONSECUTIVE` | `2` | Single-frame spikes — what most false accepts look like |
| `WM_WAKE_REFRACTORY` | `2.0` | The tail of one word firing a second turn |

**Tune them with the 24-hour test and nothing else.** Raising the threshold
because a demo misfired once is how a wake word ends up at 0.95 and unusable.
Leave it running for a day in the room, count the wakes nobody asked for, and
move one number.

### Pre-roll, because detection is not instant

The model only fires once it has heard the whole word, by which point the
speaker is usually into the command. `WM_PREROLL` (1 s) keeps a ring buffer of
recent audio that is prepended to a wake turn, so "Computer, show the map"
reaches recognition whole rather than as "ow the map".

Its companion is `WM_WAKE_LEAD_IN` (1.2 s), shorter than the 2.5 s push-to-talk
lead-in: after a wake word the user is already talking, because the word itself
was the run-up. Waiting the full grace period would be latency spent on nothing.

### The detector keeps listening while the assistant speaks

That is what makes the AEC acceptance test below mean something. On hardware
with real full-duplex echo cancellation you can interrupt a long response;
`WM_WAKE_DURING_PLAYBACK=0` gates it for hardware that ducks instead, at the
cost of interruptibility, which is why it is not the default. A detection
during a turn is announced but starts nothing — the turn guard refuses
re-entry, because two pipelines sharing one microphone produce two wrong
answers.

---

## Layer 3 — The chirp

Beep first, then speak. This single pattern is more identifiably Trek than any
timbre choice, and we already have the assets from `louh/lcars`.

| Event | Sound | Slot |
|---|---|---|
| Wake word detected | `panel_beep_07.ogg` — fires *immediately*, before STT completes | `wake` |
| Command accepted | `panel_beep_14.ogg` | `accept` |
| Panel / theme change | `panel_beep_03.ogg` | `change` |
| Not understood, refused | `deny_beep_01.ogg` | `deny` |
| Alert | `panel_beep_08.ogg` | `alert` |

The wake chirp must fire on detection, not after the response is ready. It's an
acknowledgment that the computer is listening, and its latency is the only
latency the user actually perceives. Everything downstream can take a second.

Play at volume 0.15–0.2. The raw files are loud.

Slot names match the `sounds` map in `src/themes/lcars/index.ts`, so the theme
owns which file plays and the voice layer only names the event. Provenance
caveat for these files is in `docs/LCARS-ASSETS.md`.

---

## Layer 4 — Signal chain

The voice comes from a panel in a room, not from a studio. Band-limit it,
level it, and put it in a small space.

```bash
ffmpeg -i tts_raw.wav -af "
  highpass=f=180,
  lowpass=f=7000,
  equalizer=f=3000:t=q:w=1.2:g=3,
  acompressor=threshold=-18dB:ratio=3:attack=5:release=120,
  aecho=0.8:0.88:24:0.07,
  loudnorm=I=-16:TP=-1.5:LRA=7
" tts_out.wav
```

What each stage is for:

- **highpass 180 / lowpass 7k** — the whole trick. Removes chest resonance and
  air, which is what separates "voice in the room" from "voice from a speaker."
- **+3 dB at 3 kHz** — presence lift for intelligibility across a room. Matters
  more than it sounds like, given a conferencing speaker's small driver.
- **acompressor** — consistent level regardless of phrase length.
- **aecho** — a short slap standing in for a small room. Keep it subtle; if you
  can clearly hear it, it's too wet.
- **loudnorm** — stable perceived volume across every response.

Apply after TTS, before playback. On the NUC this runs far faster than
real-time, so it costs nothing perceptible. Better still, run it streaming so
playback can start on the first sentence.

---

## Engine selection

| Engine | License | Cloning | Notes |
|---|---|---|---|
| **Kokoro 82M** | Apache-2.0 | No, 54 preset voices | Current consensus default. CPU-viable, faster than real-time. **Start here.** |
| **Piper** | MIT / GPL-3.0 depending on fork | No | Fastest on CPU, best prosody control. Fall back here if Kokoro latency disappoints on the i7. |
| **Chatterbox-Turbo** | MIT | Yes, 5–10s reference | The clean route to a custom voice — record a consenting person. Wants a GPU. |

STT is faster-whisper `small.en` int8 (MIT); `small.en` over `base.en` because
the accuracy gain on place names is worth the latency on a 4-core Skylake. Wake
word is openWakeWord (Apache-2.0) with a custom "Computer" model. The LLM is
**Qwen3 8B Q4_K_M on llama.cpp, non-thinking** — see below.

### On the model, tool calling, and the latency budget

An early draft made native tool calling a hard requirement, then a later one
rejected it outright. Both were wrong in the same way: they treated a transport
as an architecture.

**Qwen3 8B Q4_K_M.** Q4_K_M because CPU decode on the NUC is memory-bandwidth
bound at ~34 GB/s — a Q4_K_M 8B is ~4.9 GB of weights, so the decode ceiling is
roughly 4–5 tok/s even at generous efficiency. Q8 would move twice the bytes per
token for quality this workload does not need.

**Non-thinking mode matters more than the quant.** A chain of thought the user
never hears is latency spent on nothing, and turning it off is the single
biggest per-turn saving available.

**Tool calling is used where the model has it, and validated regardless.** A
native call and a constrained-JSON object are normalised into the same shape and
checked against the same registry, so the boundary does not depend on how the
model was asked. That property is what matters, and it is why the earlier
"never use tool calling" position was overcorrecting.

**The three-second budget applies to tier 0, not to everything.** At ~4 tok/s an
8B spends about ten seconds on a forty-token reply, and a tool-calling turn is
two passes. Rather than pretend, the budget is split: pattern-matched commands
answer in under a second with no model at all; briefings take 8–12 s and say
"Working." while they run. `voice-sidecar/README.md` carries the table.

**Measure on CPU before making any GPU decision.**

### Audition protocol

Don't pick from descriptions. Generate the same six lines through every
candidate voice, run them through the full chain above, and play them back
**through the actual speaker on the actual kiosk, from across the room.** A
voice that sounds great in headphones can be unintelligible on a small driver at
three metres, and that's the only test that counts.

Suggested lines:

```
Working.
Market composite is sixty-one point four.
Unable to comply.
Three escalation signals detected. Sudan, Myanmar, Haiti.
Please specify.
Acknowledged.
```

Candidates worth trying first — Kokoro: `af_bella`, `af_nicole`, `af_sarah`,
`bf_emma`. Piper: `en_US-lessac-medium`, `en_US-hfc_female-medium`,
`en_GB-jenny_dioco`. The British voices often read as more formal, which suits
the register.

---

## Build order

1. Phrasing rules + validator. Test with any voice at all — if the *words* are
   right, it already reads as the computer.
2. Wake chirp. The detector is built; the "Computer" model is a training run.
3. Voice audition on hardware.
4. Prosody tuning.
5. Signal chain.

Steps 1 and 2 get most of the effect and can ship in P2. Steps 3–5 are polish.

---

## Acceptance

- End-of-speech to first audio under 3 s on CPU.
- **Wake word survives the assistant's own TTS playback.** This validates AEC
  and is the single test that decides whether the audio hardware is usable:
  play a long TTS response and say the wake word over the top. Responds = real
  full-duplex AEC. Ignores you until playback ends = ducking, and the device is
  the wrong category (SCOPE.md §8).
- No false wake in 24 h of normal room noise. Gated on the training run above,
  not on the code: `WM_WAKE_THRESHOLD`, `WM_WAKE_CONSECUTIVE` and
  `WM_WAKE_REFRACTORY` are the only three knobs this test is allowed to move.
