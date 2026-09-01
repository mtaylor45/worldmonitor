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
| `src/voice/` | Voice sidecar client (P2) |
| `src/context/` | Panel state snapshot for the LLM (P3) |
| `deploy/kiosk/` | `cage` + Chromium + systemd kiosk profile |
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

**Chrome must be losslessly removable.** Everything a theme mounts goes inside
one container element, `mount` is idempotent, and `unmount` is its exact
inverse — including dropping a `class` or `style` attribute it emptied, because
an empty attribute is still an attribute. Twenty theme cycles must leave the DOM
identical; there is a test.

**Action strings are `namespace.verb`** (`theme.set`, `voice.ptt`,
`panel.focus`). One registry, and the P3 voice tool schema derives from it.
Rail buttons already carry `data-wm-action` in this form.

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

P0 complete and verified. P1 not started.

P0's LCARS is deliberately a **stub** — a fixed-position rail that reserves its
own width, with inert buttons. It exists to prove chrome mounts and unmounts
losslessly. It does not attempt the 12-column panel mapping, which is P1's real
work, and it does not load fonts or sounds yet.

The kiosk profile in `deploy/kiosk/` is written but **not verified on hardware**;
the panel has not been sourced.
