# Sprint plan — post-P4-1

Written 2026-09-13, against `f2fa481`. Supplements `SCOPE.md`; it does not
replace it. `SCOPE.md` says what the project is, this says what to do next and
in what order.

---

## Where the project actually is

Every phase through P4-1 is built and tested: 207 sidecar tests, 815 DOM tests,
36 end-to-end. Upstream cost is still 2 files, 3 insertions, 1 deletion.

What the counts do not show is that **the fork is a frame around a dashboard it
has not yet organised**. Two numbers explain the whole of this plan:

| | |
|---|---|
| Panels upstream can render | **189**, across **23** categories |
| Panels that fit a 1280×720 panel at the 13px type floor | roughly **9–12** |

The LCARS frame is conformant and tested. The *content well* is untouched
upstream panels wearing LCARS colours, and there are far too many of them for
the display they are on. That is the gap worth closing next, and it happens to
be the one the user's own request names: pagination.

---

## 1 · Faults found

Two are live defects with reproductions. Two are configuration that lies.

### F1 — A reconnecting dashboard never learns a live alert · **high**

`Sidecar.handle()` sends `state("idle")` to a newly connected client and
nothing else. Alert frames are edge-triggered, sent only on a change.

```text
alert live: True | frames a reconnecting dashboard receives: ['state']
```

The kiosk reloads itself. A dashboard that reloads during an alert comes up
calm and **stays calm until the alert clears and re-raises** — potentially
hours. This is a red-alert display silently showing nothing, which is the exact
failure the existing comment on that line describes for voice state; the fix
was simply never extended to alerts.

**Fix:** send the current alert state alongside `state("idle")` on connect.
Roughly four lines, plus a test asserting a reconnect during a live alert
receives an `alert` frame.

### F2 — An alert raised mid-turn is lost permanently · **high**

`_poll_alerts` calls `to_announce()` — which consumes the minimum-interval
budget and stamps `_last_spoke` — and *then* checks whether a turn is in
flight, discarding the alert if one is.

```text
spoken alerts: NONE | interval already consumed: True
```

Because raising is edge-triggered, the next poll finds the region already
firing and raises nothing. The alert is **never spoken at all**, and the
15-minute silence it bought is spent on an utterance nobody heard. Asking the
assistant a question is enough to lose the next alert.

**Fix:** check the turn guard *before* `to_announce()`, and hold the alert for
the next poll rather than dropping it. Test: an alert raised mid-turn is spoken
once the turn ends.

### F3 — `WM_FAST_MODEL` is inert · **medium**

`router.py` returns `Tier.FAST`, but `pipeline.py` branches only on
`Tier.DIRECT`; a FAST decision falls through to the full 8B. Setting
`WM_FAST_MODEL` loads a second resident model into RAM and changes nothing.

**Fix:** either wire a second client, or delete the tier and its config. Given
tier 0's coverage is still growing, **delete it** — a documented knob that does
nothing is worse than an absent one, and it can come back when measurement
justifies it.

### F4 — `WM_TTS_ENGINE` is inert · **medium**

Read into `Config`, consumed nowhere; `__main__` hardcodes `KokoroTTS`.
`WM_TTS_ENGINE=piper` silently does nothing, and Piper is the documented
fallback for exactly the case where Kokoro's CPU latency disappoints — so the
knob is dead in the situation it exists for.

**Fix:** add a Piper adapter and select on the value, or drop the setting.
Recommend adding the adapter: the latency risk it hedges is real on this CPU.

### Also worth clearing while in the area

- `audio.py`'s pump thread can block in `next(stream)` past `stop()`; the task
  is cancelled but the executor thread is not. Leaks one thread on shutdown.
- Nothing verifies at startup that the API, the model server or the audio
  device are actually reachable. Every one of them fails silently. See S1-4.

---

## 2 · The keystone

**Pagination is not a feature request; it is the missing organising principle,
and the design system already specifies it.**

`docs/DESIGN-SYSTEM.md` §"Page archetypes" defines five pages — OPS, LONG RANGE
SCAN, ENGINEERING, COMMS, LIBRARY — each with its own frame colour and block
rhythm, and the rule:

> A page should be identifiable from the doorway before any label resolves.
> Frame colour and block rhythm carry that, not content.

That is a pagination spec written before pagination existed. It also explains
why the theme currently reads flat: there is one page, so the archetype system
has nothing to express.

Three things fall out of building it, which is why it sequences first:

- **It makes 189 panels usable** on a 9-inch display.
- **It gives the LCARS component work somewhere to live.** Of the eight
  components the design system specifies, the theme implements three — rail
  button, interrupt tab, labelled bar. Data row, meter, number dump, status tag
  and pill button do not exist, because the frame never had interior surfaces
  to put them on.
- **It is where a Home Assistant view belongs.** An HA page is just another
  page, with its own archetype, rather than a bolt-on.

**It costs no new upstream seam.** Upstream already hides panels by class —
`.mobile-cat-hidden` on `#panelsGrid [data-panel]`, `main.css:27511` — so ours
does the same with its own class, and `PANEL_CATEGORY_MAP` is imported
read-only from `src/config/panels.ts`. Pages are *derived* from upstream's
category map rather than duplicating it, so a panel upstream adds lands on a
page automatically.

---

## 3 · Priorities, ranked

| # | | Why here |
|---|---|---|
| 1 | Fix F1 and F2 | A monitoring display that loses alerts is not doing its job. Small, bounded, blocks nothing else |
| 2 | Pagination on upstream's category map | The keystone. Unblocks 3, 4 and 6 |
| 3 | Page archetypes | Turns pagination into the design system's own spec rather than a tab bar |
| 4 | LCARS component set | Five of eight components missing. This is what "screen accurate" actually means |
| 5 | One-command deploy + preflight | Everything above ships to a panel that currently takes eight sudo steps and fails silently |
| 6 | Home Assistant as a page | Real value, and cheap once 2–4 exist. Deliberately last |
| 7 | F3, F4 — the inert knobs | Honesty debt. Cheap, do them opportunistically |

---

## Sprint 1 · Correctness and the ground to build on

*Goal: no lost alerts, and a panel that can be brought up in one command and
says why when it cannot.*

**S1-1 — Alert state on connect** *(F1)*
Send current alert state on a new connection. Test: reconnect during a live
alert receives an `alert` frame naming the region.

**S1-2 — Hold an alert raised mid-turn** *(F2)*
Move the turn guard ahead of `to_announce()`; hold rather than drop. Tests: an
alert raised mid-turn is spoken after the turn; the interval is not consumed by
an alert that was never spoken.

**S1-3 — One-command bring-up**
A fork-owned `deploy/Makefile` — **not** upstream's `Makefile`, which is
upstream's proto tooling and must stay untouched:

```
make -C deploy kiosk     # user, packages, unit, enable
make -C deploy models    # fetch llm/wake/tts weights, verify checksums
make -C deploy up        # sidecar + model server
make -C deploy doctor    # preflight
```

`models` matters most: three weight files today are fetched by hand into
volumes with no checksums and no manifest.

**S1-4 — `doctor` preflight**
One command answering, before the panel is trusted: is the audio device
present and readable; is a wake model loaded, or is this push-to-talk only; is
the model server answering; is the dashboard API answering; do the alert rules
parse; is `data-wm-alert` reaching a connected dashboard. Every one of these
fails silently today.

**S1-5 — Drop `WM_FAST_MODEL`, wire `WM_TTS_ENGINE`** *(F3, F4)*
Delete the inert tier; add the Piper adapter and select on the value.

**Exit:** a fresh NUC goes from clean Ubuntu to a running panel with two
commands, and `doctor` names anything missing. No alert can be lost.

---

## Sprint 2 · Pagination and page archetypes

*Goal: 189 panels become five or six pages, each identifiable from the doorway.*

**S2-1 — `src/pages/`, derived from upstream's map**
Page definitions composed from `PANEL_CATEGORY_MAP`, not duplicating it. A
panel upstream adds appears on a page without an edit here. Compile-time
breakage if upstream renames the export — the loud kind.

**S2-2 — Page switching with no new seam**
Toggle our own class on `[data-panel]` hosts, styled in `lcars.css`, following
upstream's `.mobile-cat-hidden` precedent. Panels hidden, never destroyed, so
charts keep their state; dispatch `resize` on switch, as upstream's own filter
does, or charts rendered while hidden come back at zero width.

**S2-3 — Actions, so voice and rail get it free**
`page.next`, `page.set:<id>`. The tool schema is generated from the registry,
so "Computer, show engineering" works the day the action lands, with no
sidecar change.

**S2-4 — `panel.focus` switches pages**
Today it scrolls to a panel that may be on another page — it would silently do
nothing, the exact failure the fork rules call out for rail buttons. Focusing
an off-page panel must switch to its page first.

**S2-5 — Snapshot follows the page**
`buildSnapshot` caps at 12 and sorts visible-first, so it composes correctly
already — but the model should be told which page is showing and what pages
exist, or it cannot answer "what else is there".

**S2-6 — Archetypes**
Frame tone and block rhythm per page, per the design system's table. The frame
re-tones on switch; `default` is unaffected, as ever.

**Exit:** five or six pages, switchable by rail, voice and keyboard; each
visually distinct at a glance; twenty page cycles leave the DOM identical (the
same lossless rule chrome and alert already hold to).

---

## Sprint 3 · Screen accuracy, and the ecosystem

*Goal: the interior stops being upstream panels in LCARS colours.*

**S3-1 — The five missing components**
Data row, meter, number dump, status tag, pill button — built as CSS applied to
upstream panel internals, **not** as replacement markup, so upstream keeps
owning its own DOM. Each asserted in the e2e suite the way the frame already
is: right cap a full pill, meters flat-topped and unrounded, status tags the
only rectangular element.

**S3-2 — The three missing motion kinds**
Only alert pulse exists of the four permitted. Add block blink (channel
activity), sweep (genuine progress only), and sequential reveal — the last is
the boot sequence, and `SCOPE.md` calls it the single best signature moment the
theme affords. All four stay behind `prefers-reduced-motion`.

**S3-3 — Labelled-bar audit**
The signature element: the label *interrupts* the bar, punching a
field-coloured hole through it. The design system notes most reproductions miss
this. Verify the header bar actually does it, and add the e2e assertion.

**S3-4 — Home Assistant, in the sidecar**
HA lives in the sidecar, not the browser — the same argument that put audio
there: the browser adds nothing, and a sidecar survives a dashboard reload.
Read-only first: subscribe to a whitelist of entities, expose them as a page,
and add `get_home_state` to the tool registry so "Computer, is the garage
open?" works through the existing boundary.

**Control comes later and needs the P3 boundary, strictly.** An LLM that can
unlock a door is a different risk class from one that can scroll a panel. When
it comes: an explicit allowlist of entity+service pairs, validated in the
sidecar and again before dispatch, with anything not on the list refused.

**S3-5 — Ecosystem seam**
The protocol is already a clean WebSocket contract with a generated tool
schema. A second dashboard is a second subscriber; the work is naming the
machine in the protocol and letting a page point at a peer. Keep it small —
one panel that works beats a fleet that half does.

**Exit:** a screen that reads as LCARS at the component level, not just the
frame, and one HA page showing live local state.

---

## What I would not do

- **Do not build a bespoke page/category registry.** Deriving from
  `PANEL_CATEGORY_MAP` is the difference between pagination that stays correct
  as upstream adds panels and pagination that rots.
- **Do not put Home Assistant in the browser.** Same reasoning as audio.
- **Do not let an LLM control HA in the first pass.** Read-only first.
- **Do not spend an upstream seam on any of this.** Everything above is
  reachable through attributes, classes and read-only imports. The moment
  something seems to need a third seam, that is the signal to look again.
- **Do not replace upstream panel markup to style it.** CSS onto upstream's own
  DOM keeps merge cost at zero; forked markup would not survive a month.

---

## Open questions

1. **How many pages, and which?** The design system names five archetypes;
   upstream has 23 categories. The mapping is a judgement call about what
   belongs on a wall in this room — worth deciding before S2-1 rather than
   during.
2. **Is the fast tier deleted or fixed?** The plan assumes deleted.
3. **Which HA entities?** A whitelist is needed before S3-4, and it is the kind
   of list only the person who lives there can write.
4. **Does the ecosystem mean this panel showing others, or others showing
   this?** They are different builds. S3-5 assumes the first.
