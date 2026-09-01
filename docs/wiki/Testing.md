# Testing and verification

Three suites, each protecting something different.

```bash
# 815 tests across 95 files — engine behaviour, cycle stability, chrome
# re-mount, the snapshot, the action boundary, the alert attribute
npx vitest run --config vitest.dom.config.mts

# 36 tests — pixel fidelity, persistence, assets, the 12-column grid, kiosk
# geometry, design-system conformance, voice wiring, the alert repaint
npx playwright test e2e/theme-engine-p0.spec.ts

# 207 tests — phrasing, wake word, alerts, protocol contract, turn guard
cd voice-sidecar && python3 -m unittest discover -s tests -t .
```

The sidecar suite is **standard library only** — no pytest, no fixtures to
install on a kiosk.

---

## What is actually being asserted

Conformance is asserted rather than left to review. The e2e suite checks the
design system directly: the field lift, the elbow ratio and its carve at
2.40 : 1, the type scale and its 13px floor, square status tags, the absence of
transitions inside the frame, and that salmon and red appear nowhere in the
chrome at rest — *and* that they do appear when an alert fires.

Two cross-cutting properties have dedicated tests because they are the ones a
refactor quietly breaks:

- **Twenty theme cycles leave the DOM identical.** Chrome teardown is the exact
  inverse of mount, including dropping a `class` attribute it emptied.
- **Twenty alert raise/clear cycles leave the DOM identical.** Same discipline:
  clearing removes the attribute rather than setting it to `false`.

One test reaches across languages: `voice-sidecar/tests/test_protocol.py`
parses `src/voice/protocol.ts` and asserts the two implementations agree on
every constant. Two implementations of one protocol drift silently, and the
symptom is a dashboard stuck on a stale indicator with nothing in either log.

---

## Two traps when writing tests against this dashboard

Both cost real time during P0.

### 1. The page never stops repainting

Clocks, relative timestamps and feed polling repaint from JS, so
`animations: 'disabled'` is **not enough** for a byte-exact screenshot. Install
and pause Playwright's clock. `pauseAt` only moves forward, so both instants
must come from the same synthetic timeline.

### 2. Do not ship large DOM comparisons across the CDP bridge

Comparing every computed property of every element is ~1.7M values and does not
complete. **Diff in-page and return a bounded summary.**

---

## Running Playwright in a container

The bundled headless shell may not be where Playwright looks. Point at it
explicitly:

```bash
WM_WEBMCP_CHROME_EXECUTABLE_PATH=/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
  npx playwright test e2e/theme-engine-p0.spec.ts
```

The config already threads that variable into `launchOptions.executablePath`.

---

## What no amount of test coverage substitutes for

| | Measured with |
|---|---|
| Sub-3s end-of-speech to first audio | `voice-sidecar/bench_latency.py --runs 20` on the NUC |
| Wake word surviving TTS playback | Your ears, and a long response |
| No false wake in 24 hours | A day in the room |
| Readability at 2.5 m | The panel, and `preview/lcars-preview.html` |
| Alert thresholds | A week of real readings |

`bench_latency.py` reports median, p95, worst and per-stage medians, and exits
non-zero if any turn misses the budget — so it can gate a deploy rather than
merely inform one. Expect the LLM stage to dominate. **If it does not, that
finding is more interesting than the total.**
