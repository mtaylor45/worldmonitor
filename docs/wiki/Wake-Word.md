# Wake word — "Computer"

Two facts about this particular word drive the entire design of
`voice-sidecar/wm_voice/wake.py`.

---

## 1. There is no pretrained model for it

openWakeWord ships `alexa`, `hey_jarvis`, `hey_mycroft` and `hey_rhasspy`.
Nothing for "computer".

Until a model exists on disk, `WM_WAKE_MODEL` stays empty, the detector reports
itself unavailable, and the sidecar **says so loudly at startup**. Push-to-talk
carries the whole feature in the meantime. That is deliberate: a wake word that
silently never fires is indistinguishable from a broken panel, and a wall
display is exactly where nobody would notice.

`build_scorer()` never raises. A missing model, an unloadable model and a
model that throws mid-stream all degrade to the same reported state.

### Training one

No recordings of your own voice are needed — openWakeWord's pipeline generates
synthetic speech, mixes it with room noise, and trains against it:

```bash
pip install openwakeword[training]
python -m openwakeword.train \
    --target_word "computer" \
    --model_name computer \
    --n_samples 30000 \
    --output_dir ./wake-models
```

Export ONNX (the default), drop the file into the sidecar's model volume, and
point `WM_WAKE_MODEL` at it. Set `WM_WAKE_FRAMEWORK=tflite` if you exported
that instead.

Two things worth doing at training time, because they cost nothing then and a
retraining run later:

- **Include the negative set.** "Computer" appears in ordinary speech, so
  training against clips that contain it in running sentences is what teaches
  the model the difference between an address and a mention.
- **Record fifty positives in the actual room** and hold them back as a test
  set. Synthetic speech trains well and evaluates badly; the room's
  reverberation is the thing the panel actually hears.

---

## 2. It is a single common word, so false accepts are the problem

Not misses. "Hey Jarvis" essentially never occurs by accident; "computer" turns
up in conversation and on the news, and on a display that listens all day the
failure that matters is the news saying the word and the dashboard starting a
turn.

Three filters, all in `wake.py` where they are testable without a model:

| Control | Default | What it removes |
|---|---|---|
| `WM_WAKE_THRESHOLD` | `0.7` | Low-confidence matches. openWakeWord's own default is 0.5 |
| `WM_WAKE_CONSECUTIVE` | `2` | Single-frame spikes — what most false accepts look like |
| `WM_WAKE_REFRACTORY` | `2.0` | The tail of one word firing a second turn |

### How to tune them

**With the 24-hour test and nothing else.** Leave it running for a day in the
room the panel lives in, count the wakes nobody asked for, and move *one*
number. Raising the threshold because a demo misfired once is how a wake word
ends up at 0.95 and unusable.

---

## Supporting machinery

### One microphone, opened once

The detector listens continuously; capture records on demand. Both want the same
device, and two components independently opening an input stream is the classic
way to get an unhelpful "device busy" on the one machine nobody is sitting in
front of.

`wm_voice/audio.py` opens it once and fans frames out. Subscriber queues are
**bounded**: a consumer that stalls drops frames rather than growing a queue
until the sidecar is killed for memory. On a panel that runs for months, an
unbounded queue behind a wedged consumer is a leak with a very long fuse. The
drop is confined to the stalled subscriber, so one slow consumer cannot stall
the detector.

### Pre-roll

Detection only fires once the whole word has been heard, by which point the
speaker is usually into the command. `WM_PREROLL` (1 s) keeps a ring buffer of
recent audio that is prepended to a wake turn, so "Computer, show the map"
reaches recognition whole rather than as "ow the map".

Its companion is `WM_WAKE_LEAD_IN` (1.2 s), shorter than the 2.5 s
push-to-talk lead-in: after a wake word the user is already talking, because the
word itself was the run-up.

### Listening through playback

The detector keeps scoring while the assistant speaks. That is what makes the
AEC acceptance test mean something:

> Play a long response and say the wake word over the top.
> **Responds** = real full-duplex echo cancellation.
> **Ignores you until playback ends** = the device ducks, and it is the wrong
> category (`SCOPE.md` §8).

`WM_WAKE_DURING_PLAYBACK=0` gates it for hardware that ducks, at the cost of
interruptibility, which is why it is not the default.

A detection during a turn is announced but starts nothing — the turn guard
refuses re-entry, because two pipelines sharing one microphone produce two wrong
answers.

---

## The chirp

The wake chirp fires **on detection**, before recognition has produced anything.
It acknowledges that the computer is listening, and its latency is the only
latency the user actually perceives — everything downstream can take a second.
