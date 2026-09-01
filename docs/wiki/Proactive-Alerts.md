# Proactive alerts

`SCOPE.md` §6 P4-1. When the Composite Instability Index crosses a threshold the
panel stops being something you have to look at:

> "Alert. Instability index for Sudan has risen to eighty-seven."

The frame goes to alert colours, the alert tone sounds once, and the assistant
speaks unprompted.

---

## The path

```text
GET /api/intelligence/v1/get-risk-scores        one request, every tracked region
      │                                          plus the degraded / stale flags
      ▼
AlertWatcher.evaluate()                          thresholds, hysteresis
      │
      ├──▶ alert frame ──▶ dashboard             data-wm-alert + the alert tone
      │
      └──▶ AlertWatcher.to_announce()            quiet hours, minimum interval
                 │
                 ▼
           templated speech ──▶ phrasing ──▶ TTS
```

**The sidecar decides; the dashboard renders.** Thresholds, hysteresis, quiet
hours and the readings all live in `voice-sidecar/wm_voice/alerts.py`. The
dashboard receives one boolean and sets `data-wm-alert`.

That is deliberately unlike an **action**, which both sides validate. An action
is a language model's claim about what the user wanted, so it is checked twice.
An alert is arithmetic on a number the sidecar fetched, and a second opinion in
the browser would just mean a copy of the thresholds drifting out of step with
the ones that actually fire.

---

## The four guards

**The failure mode is not "it did not fire".** It is "it fires often enough that
you stop looking", and each guard exists for that and nothing else.

### Hysteresis — `WM_ALERT_CLEAR_MARGIN`

A score oscillating around 85 against a threshold of 85 fires, clears, fires and
clears. It has to fall a margin *below* the line before it can fire again, so
one crossing is one alert.

A rise rule clears on the delta rather than the score: a region that rose 14
points and has stopped rising is no longer escalating, whatever its absolute
score happens to be.

### A floor between spoken alerts — `WM_ALERT_MIN_INTERVAL`

Several regions can cross at once. The display carries all of them; the voice
speaks the most severe and stays quiet about the rest. A queue of unprompted
speech is how an always-on assistant becomes something you switch off.

### Quiet hours — `WM_ALERT_QUIET_HOURS`

**Silences the voice, never the display.** The point of a quiet window is not
waking the house, not hiding the situation. An alert raised at 3am is still on
the panel at 3am; it simply does not announce itself. The log records that
someone would otherwise have been told.

Local time, and it may wrap midnight (`22:00-07:00` usually does). Empty
disables it.

### Trustworthiness

`GetRiskScores` reports `degraded` and `stale`. Neither raises an alert — and,
just as important, **neither clears one**. Dropping a live alert because the
upstream cache hiccuped is the failure a monitor exists to prevent, not one it
should introduce.

---

## Rules

```bash
WM_ALERT_RULES="*>85, Sudan>75, Taiwan+12"
```

| Form | Meaning |
|---|---|
| `Region>score` | Fires at or above a level |
| `Region+points` | Fires on a 24-hour rise of at least that much |
| `*` | Catch-all. A **named region beats it** |

Both forms are needed. A jump from 40 to 55 is news even though 55 clears no
level line, and a region parked at 90 is news even though it moved by nothing.

A malformed entry is **logged and skipped**, not fatal. Turning a typo in an
environment variable into a panel that will not start is strictly worse than
running the rules that parsed.

---

## Why no model runs here

The wording is templated. A model would:

- cost eight to twelve seconds on this CPU to produce a sentence that was always
  going to be one of two shapes;
- drift out of register over a long session;
- and eventually read the number back wrong.

Same argument as tier 0 in the router: the most valuable thing this path does is
not use a model. **The phrasing layer still runs**, because it runs on every
spoken line, and an alert is where the register matters most. There is a test
that every alert wording passes the validator.

---

## Two things it will not do

**It never speaks over a turn in flight.** A turn owns the speaker, and cutting
across a spoken answer to announce what the display is already showing would be
the assistant talking over the person who just asked it a question. The display
asserts immediately either way.

**It does not re-assert.** The frame is sent on a *change* of state only. The
sidecar polls every few minutes and a panel can sit in alert for an hour;
sounding the tone on every message would turn the one sound that means "look
now" into a metronome.

---

## The visual half

```css
:root[data-wm-theme^="lcars"][data-wm-alert='true'] .lcars-elbow { … }
```

Hard alternation at ~1 Hz between critical red and the field, on `steps(1)` so
it **cuts rather than fades**. This is the only motion permitted to run
unattended, and only while the condition holds. `prefers-reduced-motion` drops
to a solid critical red.

Clearing **removes** the attribute rather than setting it to `false` — an empty
or false-valued attribute is still an attribute, the same lossless rule the
chrome teardown follows. An e2e test cycles it twenty times and asserts the DOM
is byte-identical.

`default` has no alert styling, so an alert there is a no-op on the display.
That is the safety net the whole engine rests on: if the LCARS frame ever
breaks, switching back restores a working dashboard.

---

## What is not settled

`*>85` is a guess. So are the clear margin, the poll interval and the
spoken-alert floor. They are calibrated against a week of real readings that has
not happened yet — which is exactly the kind of thing this wiki page should be
updated with once it has.
