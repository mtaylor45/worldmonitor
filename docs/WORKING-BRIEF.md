# Working brief — LCARS World Monitor

Fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor).
Full plan in `SCOPE.md`; this file is the short version you need before editing.

> Upstream's `.gitignore` ignores `CLAUDE.md` at the repository root, so this
> brief is tracked here instead. Editing `.gitignore` to un-ignore it would
> spend a third upstream seam on a documentation file, which is not a trade
> worth making (see `docs/UPSTREAM-DIFF.md`). Keep a local `CLAUDE.md` copy if
> your tooling reads one; this file is the source of truth.

**Upstream's own contributor docs still apply.** `AGENTS.md`, `CONTRIBUTING.md`
and `ARCHITECTURE.md` describe the codebase we forked and are not superseded by
anything here. This file adds fork-specific rules on top.

---

## The one rule that matters

**Merge cost is the primary non-functional constraint.** Upstream is 6,000+
commits and actively maintained. Every upstream line we touch is a line that can
conflict, forever.

Current cost: **2 files, 3 insertions, 1 deletion.** Keep it there.

Before editing any upstream file, ask whether a DOM attribute hook plus code in
our own directory would do instead. It usually will — that question saved the
third seam (upstream already marks panels with `data-panel`) and a fourth
(chrome re-mounts via `MutationObserver` instead of a post-render callback).

Never reformat, reorganize, or tidy an upstream file. A whitespace-only change
to a file upstream also touches turns a clean merge into a manual one.

Log every upstream file touched in `docs/UPSTREAM-DIFF.md`.

---

## Layout

| Path | Contents |
|---|---|
| `src/themes/` | Theme engine, token contract, `default` and LCARS themes |
| `src/themes/actions.ts` | Action registry — one source of truth for rail and voice |
| `src/themes/sounds.ts` | Slot-based UI sound playback |
| `public/fonts/`, `public/sounds/` | Self-hosted Antonio and LCARS UI sounds |
| `src/voice/` | Voice sidecar client (P2) |
| `src/context/` | Panel state snapshot for the LLM (P3) |
| `deploy/kiosk/` | `cage` + Chromium + systemd kiosk profile |
| `preview/lcars-preview.html` | Standalone 1280x720 mock, no build step |
| `docs/UPSTREAM-DIFF.md` | Every upstream file touched, and why |
| `docs/P0-PORT.md` | Token extraction procedure and acceptance criteria |

Our code lives in new directories. That is the whole merge strategy.

---

## Upstream seams

Two, both trivial:

| File | Change |
|---|---|
| `src/main.ts` | `import { bootThemes }` + one call before `new App('app')` |
| `index.html` | `data-wm-shell` on `<div id="app">` |

`bootThemes()` is idempotent and never throws. That is not defensive
programming for its own sake — this runs on an unattended wall panel, and an
exception in the theme layer must not cost the dashboard.

---

## Theme conventions

**`default` declares nothing.** It is an identity theme. Do not "complete" it by
copying upstream's `:root` values in — that passes the screenshot diff on the
day it is written and silently diverges the first time upstream retunes a
colour. See `docs/P0-PORT.md` for the full argument.

**Do not repaint the signal ramp.** `--threat-*`, `--semantic-*`, `--defcon-*`
and `--status-*` carry meaning. Recolouring `--threat-low` into a warm LCARS
orange makes a calm reading look like an alarm — a correctness bug in a
situational-awareness display, not a taste difference. Repaint surfaces,
borders and the text ramp instead; unmodified upstream panels inherit those.

**Salmon `#cc6666` is alert-only.** One definition, one rule. If it becomes
decorative the theme stops communicating.

**Chrome must be losslessly removable.** A chrome slot returns its own
teardown, and that teardown is its exact inverse — including dropping a `class`
attribute it emptied, because an empty attribute is still an attribute. Twenty
theme cycles must leave the DOM identical; there is a test.

**Teardown reads the DOM, it does not replay it.** Upstream rebuilds the
dashboard by assigning `innerHTML`, so the nodes present when chrome mounted are
usually not the nodes present when it unmounts. `unwrap()` moves whatever is in
the content well back to the host; restoring a captured node list would
re-attach detached markup and drop everything rendered since.

**Token names are semantic, not literal** — `--wm-color-alert`, not
`--wm-color-red`. A theme that renames red to blue should not have to lie. The
one deliberate exception is LCARS's structural ramp (`tan`, `lilac`,
`periwinkle`, `ice`, `cream`): those are *tone* names the chrome asks for by
role, so a palette variant swaps hexes without touching a single chrome file.
Everything that carries meaning — `alert`, `ok`, `readout`, `voice-*` — is
named semantically.

**A tokens-only theme cannot break the app.** `default` has no chrome, so if the
LCARS frame ever breaks, switching back restores a working dashboard. Preserve
that property: it is the safety net the whole engine rests on, and it is why
chrome failures are caught and logged rather than rethrown.

**Never write `data-theme`.** That attribute is upstream's, set before first
paint by the prepaint script in `index.html` and read across `main.css` for
light/dark. Ours is `data-wm-theme`. Writing the theme id into `data-theme`
would silently clobber upstream's colour scheme.

**Action strings are `namespace.verb`** (`theme.set`, `voice.ptt`,
`panel.focus`), optionally with a colon-suffixed argument: `panel.focus:cii`.
One registry in `src/themes/actions.ts`, and the P3 tool schema is *generated*
from it by `toolSchema()` — never hand-maintained beside it. That is what makes
"every rail button action is also reachable by voice" structural rather than
aspirational.

**A rail button must name a panel upstream actually renders.** `panel.focus`
targets are `data-panel` keys verified against a running dashboard; a button
pointing at a key that does not exist silently does nothing, which on a wall
panel is indistinguishable from a broken display. The refusal tone on an
unhandled action is the other half of that guard.

**Sound callers name a slot, never a file.** `wake`, `accept`, `change`,
`deny`, `alert` — the active theme decides what each sounds like, so a second
theme ships its own set without touching a call site.

**The rail is squared blocks, not pills.** Only the column terminates in a
curve, where it meets the header elbow and the footer.

---

## Conventions

- TypeScript strict. No `any` in our directories.
- Comments explain *why*. The code already says what.
- Vanilla TS, plain DOM factories for chrome. Upstream's stack is not
  negotiable — do not introduce a framework for this.

---

## Verification

```bash
# Engine behaviour, cycle stability, chrome re-mount
npx vitest run --config vitest.dom.config.mts tests/dom/theme-engine.test.mts

# Extraction still matches upstream's main.css
npx vitest run --config vitest.dom.config.mts tests/dom/theme-token-contract.test.mts

# P0 acceptance: pixel fidelity, cycle stability, persistence, kiosk geometry
npx playwright test e2e/theme-engine-p0.spec.ts
```

Run all three after every upstream merge. The token test catches upstream
retuning a value our extraction records; the e2e catches upstream changing the
shell or panel markup the engine depends on.

**When the token drift test fails, re-run the extraction procedure in
`docs/P0-PORT.md`. Do not edit the expectation to match.**

---

## Writing tests against this dashboard

Two traps, both hit during P0:

1. **The page never stops repainting.** Clocks, relative timestamps and feed
   polling repaint from JS, so `animations: 'disabled'` is not enough for a
   byte-exact screenshot. Install and pause Playwright's clock. `pauseAt` only
   moves forward, so both instants must come from the same synthetic timeline.

2. **Do not ship large DOM comparisons across the CDP bridge.** Comparing every
   computed property of every element is ~1.7M values and does not complete.
   Diff in-page and return a bounded summary.

---

## Current state

P0 and P1 are complete and verified. P2 not started.

The LCARS theme is whole: self-hosted Antonio, vendored sounds wired by slot,
rail bound to real panel keys, the 12-column grid with its container-query span
ladder, and both palettes selectable.

Outstanding, and deliberately so:

- **`voice.ptt` reports failure.** P2 owns the sidecar; until it exists the
  rail plays the refusal tone rather than pretending the button works.
- **The cap-height factor (1.36) is a token, not yet applied.** It is
  calibrated for Swiss 911, and Antonio has different vertical metrics.
- **The kiosk profile is unverified on hardware** — the panel is unsourced.
- **The palette choice is unmade.** It is a legibility test at 2.5 m;
  `preview/lcars-preview.html` exists to settle it on the panel.

The kiosk profile in `deploy/kiosk/` is written but **not verified on hardware**;
the panel has not been sourced.
