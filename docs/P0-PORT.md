# P0 — default theme extraction and verification

How the `default` theme was produced, how its fidelity is proved, and what to
do when upstream moves underneath it.

**Baseline:** `cd91e63` (2026-08-31).

---

## The decision that shapes this document

`src/themes/default/index.ts` declares **no tokens, no stylesheet and no
chrome**. It is an identity theme that contributes nothing to the cascade.

SCOPE.md §5 says "`default` theme extracted from upstream CSS", and the obvious
reading is that the default theme re-declares upstream's `:root` values. That
was rejected, for one reason:

> A transcription passes the screenshot diff on the day it is written, and then
> silently diverges the first time upstream retunes a colour.

Upstream owns roughly 90 custom properties across three `:root` blocks in a
28,482-line stylesheet, and it retunes them — several carry comments recording
a contrast fix (`--text-muted: #838383; /* was #666 (3.2:1 on --surface); AA
4.9:1 */`). A copy in our tree would go stale without failing anything, and the
resulting rendering difference is exactly what P0 exists to rule out.

Declaring nothing makes pixel-fidelity **structural** rather than dependent on
transcription accuracy, and it means upstream token churn flows through to the
default theme automatically, which is the correct behaviour for a theme whose
entire job is to be upstream.

The extraction was still done. It lives in `src/themes/tokens.ts` as a
reference for theme authors — you cannot write a theme without knowing which
properties exist — and it is checked against upstream on every test run.

---

## Extraction procedure

Re-run this when the drift test fails, or before designing a new theme.

1. Find the token blocks. Only top-level `:root { ... }` blocks are part of the
   contract; `[data-theme="light"]`, `[data-variant="..."]` and `[data-font]`
   blocks are upstream's own overrides and legitimately differ.

   ```bash
   grep -n "^:root {" src/styles/main.css
   ```

   At the baseline this yields three blocks:

   | Line | Contents |
   |---|---|
   | `main.css:8` | backgrounds, borders, text ramp, overlays, scrollbar, input, panels, map, font stack |
   | `main.css:82` | semantic / threat / billing / DEFCON / status colours, legacy aliases |
   | `main.css:1580` | dashboard grid metrics |

2. Copy values verbatim into the matching group in `src/themes/tokens.ts`
   (`BASE_TOKENS`, `SIGNAL_TOKENS`, `FONT_TOKENS`, `LAYOUT_TOKENS`). Keys carry
   no leading `--`.

3. **Do not normalise anything.** `#111` stays `#111`, not `#111111`;
   `rgba(255, 255, 255, 0.1)` keeps its spacing. The drift test compares
   strings, and normalising here means editing the test to match, which
   defeats it.

4. Run the drift test.

   ```bash
   npx vitest run --config vitest.dom.config.mts tests/dom/theme-token-contract.test.mts
   ```

**When this test fails, re-run the extraction. Do not edit the expectation to
match.** The test exists to tell you upstream moved.

---

## Which tokens a theme may repaint

Not all of them, and the distinction is not stylistic.

- **`BASE_TOKENS`** — surfaces, borders, text ramp. A theme is expected to
  repaint these. This is what makes unmodified upstream panels inherit a theme
  with no panel-level CSS.

- **`SIGNAL_TOKENS`** — `--threat-*`, `--semantic-*`, `--defcon-*`,
  `--status-*`. **Leave these alone.** They carry meaning, not decoration.
  Repainting `--threat-low` into a warm LCARS orange makes a calm reading look
  like an alarm, which is a correctness bug in a situational-awareness display,
  not a taste difference. `src/themes/lcars/tokens.ts` deliberately does not
  touch them.

- **`FONT_TOKENS`** — `--font-body-base` is the swap point; `--font-body`
  derives from it and is further overridden by upstream for RTL and `zh`.
  Override the base, not the derived value, or you break Arabic and Chinese
  rendering.

- **`LAYOUT_TOKENS`** — grid metrics. Changing these is a layout decision with
  consequences for the panel set; P1's 12-column mapping is where that belongs.

---

## Verification

`e2e/theme-engine-p0.spec.ts`, at the kiosk's fixed 1280x720.

### Criterion 1 — `default` renders unmodified upstream, pixel-for-pixel

Proved three ways, weakest to strongest:

1. **No declarations.** The engine owns exactly one `<style>` element, and
   under `default` its `textContent` is empty.

2. **Byte-exact screenshot.** Screenshot with the engine active, neutralise it
   (drop `data-wm-theme`, empty the style element), screenshot again, assert
   `Buffer.compare(...) === 0`.

3. **Computed-style equality.** Every computed property of every element,
   compared themed vs un-themed. Roughly 1.7M (element, property) pairs. This
   is strictly stronger than a screenshot: it also covers what a screenshot
   cannot see — off-screen colour, scroll behaviour, print styles.

There is no stored golden image, on purpose. `default` emits nothing, so
"unmodified upstream" is reproducible **inside a single page** by neutralising
the engine. That removes the entire class of flake a baseline image would
carry: live feed data, clocks, and deploy-time asset hashes are identical on
both sides because they are literally the same page.

Two things had to be solved to make byte-exactness achievable at all, and both
are worth knowing before editing this spec:

- **The dashboard never stops repainting.** Clocks, relative timestamps and
  feed polling repaint from JS, so disabling CSS animation is not enough and
  there is no naturally stable window to screenshot in. The spec installs
  Playwright's clock at a fixed instant and pauses it. `pauseAt` only moves
  forward, so both instants come from the same synthetic timeline rather than
  from the real clock, which advances underneath the test.

- **Comparing 1.7M values across the CDP bridge does not complete.** The first
  cut hung until the suite timeout. The diff runs entirely in-page and returns
  a bounded summary.

### Criterion 2 — twenty theme cycles leave the DOM structurally identical

Sixty switches across all three registered themes, then `outerHTML` of the
shell compared against the capture from before the loop.

Both captures and all sixty switches happen inside **one synchronous block**.
`setTheme` is synchronous, so upstream cannot interleave a render between them
— which matters, because the dashboard rewrites panel bodies as feeds land and
a before/after pair straddling that would fail for reasons unrelated to theme
chrome.

What makes the criterion satisfiable is a set of rules in the engine, each
paired with its exact inverse:

| Mutation | Inverse |
|---|---|
| token `<style>` element rewritten, never appended to | rewritten to `''` |
| chrome mounted into one container element | that element removed |
| `data-wm-theme` set | removed, not set to a sentinel |
| shell marker class added | removed, and an emptied `class` attribute dropped |
| `--lcars-panel-count` inline property set | removed, and an emptied `style` attribute dropped |

The last two matter more than they look: an empty `class=""` is still an
attribute, and `outerHTML` compares attributes.

### Running it

```bash
npx playwright test e2e/theme-engine-p0.spec.ts
npx vitest run --config vitest.dom.config.mts tests/dom/theme-engine.test.mts
```

---

## Status

| Deliverable | State |
|---|---|
| Fork running locally at 1280x720 | Done |
| Theme engine wired at upstream seams | Done — two seams, not three (see UPSTREAM-DIFF.md) |
| `default` theme | Done, identity by design |
| Theme switching, persisted across reload | Done — `setTheme()` / `cycleTheme()` + `localStorage` |
| Screenshot-diff and cycle-stability acceptance | Done, passing |
| Kiosk profile (`cage` + Chromium + unit) | Written, **not verified on hardware** — the panel has not been sourced |

Switching is currently programmatic (`setTheme`, `cycleTheme`) plus a URL pin.
The rail button that drives it is P1, because the rail is LCARS chrome and P0's
LCARS is deliberately a stub: it proves chrome can be mounted and removed
losslessly, and does not attempt the 12-column panel mapping.
