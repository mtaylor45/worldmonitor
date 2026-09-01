# Voice character

Why the assistant sounds like the ship's computer, and how to get there without
cloning anyone's voice.

Referenced by SCOPE.md §7.3 and P2.

---

## The claim this document rests on

Timbre is roughly a third of what makes the TNG computer recognizable. The rest
is **phrasing, prosody, the acknowledgement chirp, and the signal chain** — and
all four are ours to build with off-the-shelf voices.

The practical consequence, and the single most important instruction here:

> **Build the phrasing layer first and test it with any default voice.** If the
> words are right it reads as the ship's computer before any audio tuning at
> all. If the words are wrong, no amount of timbre matching rescues it.

This is also why there are no cloned voices in this project. A clone is the
expensive, legally fraught path to the least important third of the effect.

---

## Phrasing

The register is **terse, declarative, and never conversational**. It states,
confirms, or refuses. It does not chat, hedge, apologise, or offer follow-ups.

| Situation | Say | Never |
|---|---|---|
| Answering a query | "Instability index for Sudan is eighty-seven." | "It looks like Sudan's instability index is currently around 87." |
| No data | "No data for that region." | "I'm sorry, I couldn't find any data for that region." |
| Command accepted | "Acknowledged." | "Sure! I've gone ahead and done that for you." |
| Not understood | "Unable to comply." | "Sorry, I didn't quite catch that — could you rephrase?" |
| Out of scope | "That information is not available." | "I don't have access to that, but you could try..." |
| Alert | "Alert. Instability index for Sudan has risen to eighty-seven." | "Heads up! Sudan's numbers are climbing." |
| Working | *(silence, plus the chirp)* | "Let me look that up for you..." |

Rules that hold across all of it:

1. **No first person.** The computer has no "I". "Unable to comply", never "I
   can't do that". This one change does more work than any other on the list.
2. **No pleasantries.** No "sure", "of course", "happy to help", "great
   question".
3. **No hedging.** A number is stated, not approximated. If confidence is low,
   say the confidence as a fact: "Estimate. Confidence low."
4. **Numbers are spoken as words** by the TTS layer, not digits. "Eighty-seven",
   not "87" — and this has to be done in the text, because engines disagree on
   how they read numerals.
5. **Units and names get said in full** on first use, abbreviated after.
6. **Sentences are short.** One clause. A second clause is usually a second
   sentence.

### Validation

The phrasing layer ships with a validator rather than a style guide nobody
re-reads. It rejects a generated response containing:

- first-person pronouns (`I`, `I'm`, `I'll`, `my`)
- apology tokens (`sorry`, `apologies`, `unfortunately`)
- pleasantry openers (`sure`, `of course`, `certainly`, `happy to`)
- hedges (`I think`, `it seems`, `probably`, `might be`, `around`)
- trailing offers (`would you like`, `let me know`, `feel free`)

On rejection: re-prompt once, then fall back to a fixed template. A fixed
template in the right register beats a fluent sentence in the wrong one.

---

## Prosody

Kokoro 82M (Apache-2.0, 54 preset voices) is the default. Pick a preset that is
**level and unhurried** — the failure mode of every modern TTS is sounding
warm and helpful, which is precisely wrong here.

| Parameter | Target | Why |
|---|---|---|
| Rate | ~0.95x | Slightly slow reads as deliberate, not sluggish. |
| Pitch variance | Reduced | Flat delivery is the whole effect. Expressive prosody destroys it. |
| Sentence-final pitch | Falling, always | A rising terminal turns a statement into a question. |
| Pause before a number | ~120 ms | The computer "retrieves". Cheap, and very effective. |
| Pause between sentences | ~350 ms | Longer than conversational. |

---

## The chirp

**The chirp fires on wake-word detection, before STT completes.** This is a
latency trick and it is worth more than any model upgrade: the user gets
feedback in ~100 ms, so a 2.5 s round trip feels like a considered response
rather than a hang.

| Event | Sound | Volume |
|---|---|---|
| Wake word detected | `panel_beep_07.ogg` | 0.15 |
| Command accepted | `panel_beep_14.ogg` | 0.15 |
| Panel / theme change | `panel_beep_03.ogg` | 0.15 |
| Not understood, refused | `deny_beep_01.ogg` | 0.2 |
| Alert | `panel_beep_08.ogg` | 0.2 |

Mapping and provenance caveat in `docs/LCARS-ASSETS.md`.

---

## Signal chain

Applied to the TTS output before playback. This is the last third of the
effect, and it is a handful of ffmpeg filters — not a model.

```
highpass=f=180, lowpass=f=7000   # band-limit: speaker, not studio
compand=...:-25/-25:...          # flatten dynamics
aecho=0.8:0.7:12:0.15            # very short room reflection
volume=0.9
```

The band-limit is doing most of the work. Full-bandwidth speech sounds like a
podcast; rolling off below 180 Hz and above 7 kHz sounds like something coming
out of a panel.

Keep the echo short (12 ms). Anything longer reads as a cathedral rather than
a room.

---

## Engine comparison

| Layer | Choice | Licence | Notes |
|---|---|---|---|
| TTS | Kokoro 82M | Apache-2.0 | Default. 54 preset voices. |
| TTS (fallback) | Piper | MIT | Faster on CPU. Use if Kokoro cannot hold the latency budget. |
| STT | faster-whisper `small.en` int8 | MIT | `small.en` over `base.en`: the accuracy gain on place names is worth the latency on a 4-core Skylake. |
| Wake word | openWakeWord | Apache-2.0 | Custom "Computer" model. |
| LLM | Ollama, 3–7B, tool-calling | MIT (runtime) | Tool-calling is a hard requirement — P3 derives its schema from the action registry. |

**Measure on CPU before making any GPU decision.** The P2 budget is under 3 s
from end-of-speech to first audio, on the NUC's i7-6770HQ. If that holds, a GPU
buys nothing a wall panel can perceive. If it does not, the GPU belongs in a
swarm node, not as an eGPU on the kiosk.

If a distinctive custom voice is wanted later, Chatterbox-Turbo (MIT) does
zero-shot cloning from 5–10 s of a **consenting speaker**. That consent is not
a formality — it is the condition under which this project will use cloning at
all.

---

## Acceptance

- End-of-speech to first audio under 3 s on CPU.
- **Wake word survives the assistant's own TTS playback.** This validates AEC
  and is the single test that decides whether the audio hardware is usable:
  play a long TTS response and say the wake word over the top. Responds = real
  full-duplex AEC. Ignores you until playback ends = ducking, and the device is
  the wrong category (SCOPE.md §8).
- No false wake in 24 h of normal room noise.
