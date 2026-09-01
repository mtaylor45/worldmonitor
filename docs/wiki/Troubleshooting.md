# Troubleshooting

Symptom first. Everything here is a real failure mode of this system, not a
generic checklist.

---

## The wake word never fires

**Check the startup log first.** With no model configured the sidecar logs:

```
no wake model configured (WM_WAKE_MODEL); wake word disabled, push-to-talk still works
```

That is the expected state on a fresh install — openWakeWord ships no
pretrained "computer" model. See [Wake Word](Wake-Word) for the training run.

If a model *is* configured and it still never fires:

| Check | |
|---|---|
| Did the model load? | A load failure logs the path and the reason, then degrades. It never raises |
| Is the threshold too high? | `WM_WAKE_THRESHOLD` above ~0.85 on a synthetic-only model is usually too tight |
| Is the streak too long? | `WM_WAKE_CONSECUTIVE` of 3+ needs a clearly enunciated word |
| Is the microphone shared? | Only `wm_voice/audio.py` may open the device. Anything else holding it produces "device busy" |

## The wake word fires constantly

Expected, before tuning — "computer" occurs in ordinary speech. Move **one**
number, using the 24-hour test rather than a demo:

1. `WM_WAKE_CONSECUTIVE` from 2 to 3 first. It removes single-frame spikes,
   which is what most false accepts are, and costs the least recall.
2. Then `WM_WAKE_THRESHOLD` up in steps of 0.05.
3. `WM_WAKE_REFRACTORY` only affects double-fires from one utterance.

## The assistant hears itself

Say the wake word over a long response:

- **It responds** → real full-duplex AEC. Leave `WM_WAKE_DURING_PLAYBACK=1`.
- **It ignores you until playback ends** → the device ducks rather than cancels,
  and it is the wrong category (`SCOPE.md` §8). Set
  `WM_WAKE_DURING_PLAYBACK=0`; you lose interruptibility.

---

## "Computer, show the map" is recognised as "ow the map"

Pre-roll is not reaching recognition. `WM_PREROLL` should be ≥ 1.0 s, and the
turn must have started from the wake word rather than push-to-talk — push-to-talk
deliberately does not seed pre-roll, because the second before a button press is
not the command.

## Every turn takes six seconds before anything happens

That was the old fixed-window capture and is fixed. If it recurs, capture is not
endpointing: check `WM_VAD_THRESHOLD` against the room. Too high and speech
never registers, so the turn runs to `WM_MAX_UTTERANCE`.

## Voice answers take 8–12 seconds

**Expected for a question.** At Q4_K_M on this CPU an 8B decodes at ~4–5 tok/s,
so a forty-token reply is ~10 s. The budget is split rather than pretended at:

| Tier | Handles | Target |
|---|---|---|
| 0 · direct | "show the map", "focus markets", "change the theme" | **< 1 s, no model** |
| 1 · fast | short conversational replies (optional) | < 3 s |
| 2 · full | questions, briefings, multi-step | 8–12 s |

If a *command* is slow, it is falling through tier 0 — check that the dashboard
has published a context frame, since nothing is offered that it did not.

---

## Alerts never fire

| Check | |
|---|---|
| Did any rule parse? | `no alert rules parsed from WM_ALERT_RULES` is logged at startup |
| Is the API reachable? | `risk scores unavailable: …` is logged per failed poll, and the loop continues |
| Is the feed degraded? | A `degraded` or `stale` response raises nothing, by design. `alert state held` at debug |
| Did the schema move? | `readings_from_risk_scores()` drops junk entries silently rather than false-alarming. Check it after an upstream merge |
| Is it below the line? | Hysteresis means a region that already fired will not fire again until it drops `WM_ALERT_CLEAR_MARGIN` below |

## Alerts fire too often

That is the failure this feature is designed around, so start with the guards:
raise `WM_ALERT_CLEAR_MARGIN` (flapping), raise `WM_ALERT_MIN_INTERVAL`
(several regions at once), or narrow `WM_ALERT_RULES` from `*` to named regions.

## The panel is red but says nothing

Working as intended, in three cases: quiet hours, inside the spoken-alert
interval, or a turn was in flight when the alert raised. Each is logged at info
with the region name. `WM_ALERT_SPEAK=0` disables speech entirely.

---

## The frame looks wrong

| Symptom | Cause |
|---|---|
| Header controls missing at 1280×720 | Upstream's degradation ladder fires on viewport, the frame narrows the container. `lcars.css` re-runs it at shifted breakpoints — re-derive after an upstream merge |
| Panels overflow horizontally | Grid items default to min-content width. Every grid child holding upstream markup needs `min-width: 0` |
| Chrome vanishes after load | Upstream rebuilds by assigning `innerHTML`. Chrome re-mounts via `MutationObserver`; if it is not re-mounting, that observer is not running |
| Colours look alarmed when nothing is wrong | Something repainted the signal ramp. `--threat-*`, `--semantic-*`, `--defcon-*` and `--status-*` carry meaning and must not be restyled |
| Light/dark broke everywhere | Something wrote `data-theme`. That is upstream's. Ours is `data-wm-theme` |

## Switching to `default` fixes it

That is the safety net working. `default` declares nothing and has no chrome, so
a broken LCARS frame never costs the dashboard. Fix the theme, not the fallback.
